/**
 * The "what is working, what is not" digest.
 *
 * Built for consumption by an AI agent or a glanceable status view. The point is
 * that one request returns a conclusion, not raw tables — an agent should not
 * have to issue ten calls and re-derive the analysis every time someone asks
 * "how is my site doing?".
 *
 * Every finding carries the numbers it was derived from, so the caller can cite
 * evidence rather than paraphrase a score it cannot check.
 */

import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { summary, pages, breakdown, performance, type Summary } from './reports.js';
import { exitPages, frustrationByPage } from './insights.js';
import { pctChange, type ResolvedRange } from './time.js';
import type { Filters } from './filters.js';
import type { Project } from './types.js';

export type FindingKind = 'win' | 'problem' | 'watch';

export interface Finding {
  kind: FindingKind;
  /** Stable machine-readable id, e.g. "traffic_down", "high_exit_rate". */
  code: string;
  /** One sentence, already phrased as a conclusion. */
  headline: string;
  /** Why it was flagged, including the comparison it is based on. */
  detail: string;
  /** Rough ordering weight, 1 (minor) to 5 (urgent). */
  severity: number;
  evidence: Record<string, unknown>;
}

export interface Digest {
  project: { id: string; name: string; domain: string; timezone: string };
  period: { from: string; to: string; comparedTo: { from: string; to: string } | null };
  headline: {
    visitors: number;
    visitorsChangePct: number | null;
    pageviews: number;
    bounceRate: number;
    avgSessionSec: number;
    conversions: number;
    conversionRate: number;
  };
  findings: Finding[];
  /** Plain-text rendering, so a caller can quote it directly. */
  narrative: string;
  dataQuality: { hasData: boolean; sessions: number; notes: string[] };
}

const EMPTY_FILTERS: Filters = {};

/** Thresholds are deliberately explicit rather than hidden in the prose. */
const T = {
  trafficMovePct: 15,
  highBounceRate: 70,
  highExitRate: 65,
  minExitSessions: 20,
  slowLcpMs: 2500,
  minErrorSessions: 5,
  frustrationRate: 20,
};

export async function buildDigest(
  project: Project,
  range: ResolvedRange,
): Promise<Digest> {
  const [current, topPages, exits, sources, perf, frustration] = await Promise.all([
    summary(project.id, range, EMPTY_FILTERS),
    pages(project.id, range, EMPTY_FILTERS, 10),
    exitPages(project.id, range, EMPTY_FILTERS, 10),
    breakdown(project.id, range, EMPTY_FILTERS, 'source', 8),
    performance(project.id, range, EMPTY_FILTERS),
    frustrationByPage(project.id, range, EMPTY_FILTERS, 10),
  ]);

  const previous: Summary | null = range.compare
    ? await summary(project.id, range.compare, EMPTY_FILTERS)
    : null;

  const errors = (await db.execute(sql`
    SELECT message, count, affected_sessions, sample_path
    FROM error_groups
    WHERE project_id = ${project.id} AND resolved = FALSE
      AND last_seen_at >= ${range.fromIso}::timestamptz AND last_seen_at < ${range.toIso}::timestamptz
    ORDER BY affected_sessions DESC, count DESC
    LIMIT 5
  `)) as unknown as Array<Record<string, unknown>>;

  const findings: Finding[] = [];
  const visitorsChange = previous ? pctChange(current.visitors, previous.visitors) : null;

  // ── Traffic direction ─────────────────────────────────────
  if (previous && visitorsChange !== null) {
    if (visitorsChange >= T.trafficMovePct) {
      findings.push({
        kind: 'win',
        code: 'traffic_up',
        headline: `Visitors are up ${visitorsChange}% versus the previous period.`,
        detail: `${current.visitors} visitors this period against ${previous.visitors} in the ${range.compare!.fromDate} to ${range.compare!.toDate} window.`,
        severity: 2,
        evidence: { current: current.visitors, previous: previous.visitors, changePct: visitorsChange },
      });
    } else if (visitorsChange <= -T.trafficMovePct) {
      findings.push({
        kind: 'problem',
        code: 'traffic_down',
        headline: `Visitors are down ${Math.abs(visitorsChange)}% versus the previous period.`,
        detail: `${current.visitors} visitors this period against ${previous.visitors} previously. Check whether a top source dropped off.`,
        severity: 4,
        evidence: { current: current.visitors, previous: previous.visitors, changePct: visitorsChange },
      });
    }
  }

  // ── Conversion ────────────────────────────────────────────
  if (previous && previous.conversionRate > 0) {
    const change = pctChange(current.conversionRate, previous.conversionRate);
    if (change !== null && change <= -T.trafficMovePct) {
      findings.push({
        kind: 'problem',
        code: 'conversion_down',
        headline: `Conversion rate fell ${Math.abs(change)}%, from ${previous.conversionRate}% to ${current.conversionRate}%.`,
        detail: `${current.conversions} conversions from ${current.sessions} sessions.`,
        severity: 5,
        evidence: { current: current.conversionRate, previous: previous.conversionRate, changePct: change },
      });
    }
  }

  // ── Engagement ────────────────────────────────────────────
  if (current.sessions >= T.minExitSessions && current.bounceRate >= T.highBounceRate) {
    findings.push({
      kind: 'problem',
      code: 'high_bounce_rate',
      headline: `Bounce rate is ${current.bounceRate}% — most visitors leave without engaging.`,
      detail: `A bounce is a single pageview with no interaction, under 10 seconds. Across ${current.sessions} sessions.`,
      severity: 3,
      evidence: { bounceRate: current.bounceRate, sessions: current.sessions },
    });
  }

  // ── Drop-off ──────────────────────────────────────────────
  const worstExit = exits.find((e) => e.exits >= T.minExitSessions && e.exitRate >= T.highExitRate);
  if (worstExit) {
    findings.push({
      kind: 'problem',
      code: 'high_exit_rate',
      headline: `${worstExit.path} loses ${worstExit.exitRate}% of the visitors who reach it.`,
      detail:
        `${worstExit.exits} sessions ended there` +
        (worstExit.frustrationRate > 0
          ? `, and ${worstExit.frustrationRate}% of those showed a frustration signal (rage click, dead click, error, or a slow load).`
          : '.') +
        ` Average scroll depth before leaving was ${worstExit.avgScrollAtExit}%.`,
      severity: 4,
      evidence: worstExit as unknown as Record<string, unknown>,
    });
  }

  const frustrated = frustration.find(
    (f) => f.sessions >= T.minErrorSessions && f.rageClicks + f.deadClicks + f.errors > 0,
  );
  if (frustrated) {
    findings.push({
      kind: 'problem',
      code: 'frustration_signals',
      headline: `${frustrated.path} is producing frustration signals.`,
      detail: `${frustrated.rageClicks} rage clicks, ${frustrated.deadClicks} dead clicks and ${frustrated.errors} JS errors across ${frustrated.sessions} sessions.`,
      severity: 3,
      evidence: frustrated as unknown as Record<string, unknown>,
    });
  }

  // ── Errors ────────────────────────────────────────────────
  const topError = errors[0];
  if (topError && Number(topError.affected_sessions ?? 0) >= T.minErrorSessions) {
    findings.push({
      kind: 'problem',
      code: 'javascript_errors',
      headline: `A JavaScript error is affecting ${topError.affected_sessions} sessions.`,
      detail: `"${String(topError.message).slice(0, 200)}" seen ${topError.count} times${topError.sample_path ? `, for example on ${topError.sample_path}` : ''}.`,
      severity: 5,
      evidence: {
        message: topError.message,
        count: Number(topError.count ?? 0),
        affectedSessions: Number(topError.affected_sessions ?? 0),
        samplePath: topError.sample_path,
      },
    });
  }

  // ── Performance ───────────────────────────────────────────
  const lcp = perf.vitals.lcp;
  if (lcp?.samples >= 10 && lcp.p75 > T.slowLcpMs) {
    findings.push({
      kind: 'problem',
      code: 'slow_pages',
      headline: `Largest Contentful Paint is ${Math.round(lcp.p75)}ms at p75 — above Google's 2500ms threshold.`,
      detail: perf.slowestPages.length
        ? `Slowest page is ${perf.slowestPages[0].path} at ${perf.slowestPages[0].p75Lcp}ms.`
        : `Measured across ${lcp.samples} samples.`,
      severity: 3,
      evidence: { p75Lcp: lcp.p75, samples: lcp.samples, slowest: perf.slowestPages.slice(0, 3) },
    });
  } else if (lcp?.samples >= 10 && lcp.p75 <= 2000) {
    findings.push({
      kind: 'win',
      code: 'fast_pages',
      headline: `Pages are fast — ${Math.round(lcp.p75)}ms LCP at p75.`,
      detail: `Comfortably inside Google's 2500ms "good" threshold, across ${lcp.samples} samples.`,
      severity: 1,
      evidence: { p75Lcp: lcp.p75, samples: lcp.samples },
    });
  }

  // ── Acquisition ───────────────────────────────────────────
  const bestSource = sources[0];
  if (bestSource && bestSource.visitors > 0) {
    const share = current.visitors ? Math.round((bestSource.visitors / current.visitors) * 100) : 0;
    findings.push({
      kind: share >= 70 ? 'watch' : 'win',
      code: share >= 70 ? 'source_concentration' : 'top_source',
      headline:
        share >= 70
          ? `${share}% of visitors come from a single source (${bestSource.value}).`
          : `${bestSource.value} is the strongest source with ${bestSource.visitors} visitors.`,
      detail:
        share >= 70
          ? 'Heavy concentration in one channel is a risk — a ranking or algorithm change would take most of the traffic with it.'
          : `${bestSource.bounceRate}% bounce rate and ${bestSource.conversionRate}% conversion rate from this source.`,
      severity: share >= 70 ? 2 : 1,
      evidence: { source: bestSource.value, visitors: bestSource.visitors, sharePct: share },
    });
  }

  const bestPage = topPages[0];
  if (bestPage) {
    findings.push({
      kind: 'win',
      code: 'top_page',
      headline: `${bestPage.path} is the most visited page with ${bestPage.views} views.`,
      detail: `${bestPage.visitors} unique visitors, ${bestPage.avgTimeSec}s average time on page.`,
      severity: 1,
      evidence: bestPage as unknown as Record<string, unknown>,
    });
  }

  findings.sort((a, b) => b.severity - a.severity);

  // ── Data quality ──────────────────────────────────────────
  const notes: string[] = [];
  if (current.sessions === 0) notes.push('No sessions in this period — the tracking snippet may not be installed, or the range may be too narrow.');
  if (current.sessions > 0 && current.sessions < T.minExitSessions) notes.push(`Only ${current.sessions} sessions in this period; findings are directional rather than conclusive.`);
  if (project.identityMode === 'cookieless') notes.push('Project uses cookieless identity, so returning-visitor and retention figures are not meaningful across days.');
  if (!previous) notes.push('No comparison period requested, so no trend direction is available. Pass compare=previous to get one.');

  return {
    project: { id: project.id, name: project.name, domain: project.domain, timezone: range.tz },
    period: {
      from: range.fromDate,
      to: range.toDate,
      comparedTo: range.compare ? { from: range.compare.fromDate, to: range.compare.toDate } : null,
    },
    headline: {
      visitors: current.visitors,
      visitorsChangePct: visitorsChange,
      pageviews: current.pageviews,
      bounceRate: current.bounceRate,
      avgSessionSec: current.avgSessionSec,
      conversions: current.conversions,
      conversionRate: current.conversionRate,
    },
    findings,
    narrative: renderNarrative(project, range, current, visitorsChange, findings, notes),
    dataQuality: { hasData: current.sessions > 0, sessions: current.sessions, notes },
  };
}

function renderNarrative(
  project: Project,
  range: ResolvedRange,
  current: Summary,
  visitorsChange: number | null,
  findings: Finding[],
  notes: string[],
): string {
  const lines: string[] = [];

  lines.push(`${project.name} (${project.domain}) — ${range.fromDate} to ${range.toDate}, ${range.tz}.`);

  if (current.sessions === 0) {
    lines.push('No traffic recorded in this period.');
    if (notes.length) lines.push(...notes.map((n) => `Note: ${n}`));
    return lines.join('\n');
  }

  const trend =
    visitorsChange === null ? '' :
    visitorsChange > 0 ? ` (up ${visitorsChange}%)` :
    visitorsChange < 0 ? ` (down ${Math.abs(visitorsChange)}%)` : ' (flat)';

  lines.push(
    `${current.visitors} visitors${trend}, ${current.pageviews} pageviews across ${current.sessions} sessions. ` +
      `Bounce rate ${current.bounceRate}%, average session ${current.avgSessionSec}s, ` +
      `${current.conversions} conversions (${current.conversionRate}%).`,
  );

  const problems = findings.filter((f) => f.kind === 'problem');
  const wins = findings.filter((f) => f.kind === 'win');
  const watch = findings.filter((f) => f.kind === 'watch');

  if (problems.length) {
    lines.push('', 'Not working:');
    for (const f of problems) lines.push(`- ${f.headline} ${f.detail}`);
  } else {
    lines.push('', 'Not working: nothing above threshold this period.');
  }

  if (wins.length) {
    lines.push('', 'Working:');
    for (const f of wins) lines.push(`- ${f.headline} ${f.detail}`);
  }

  if (watch.length) {
    lines.push('', 'Worth watching:');
    for (const f of watch) lines.push(`- ${f.headline} ${f.detail}`);
  }

  if (notes.length) {
    lines.push('', 'Caveats:');
    for (const n of notes) lines.push(`- ${n}`);
  }

  return lines.join('\n');
}
