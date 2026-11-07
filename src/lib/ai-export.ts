/**
 * Everything Pulse knows about one project for one period, in a single bundle:
 * a JSON document for tools, and a Markdown report an AI assistant (or a person)
 * can read top to bottom. Shared by the dashboard download, /api/v1/export and
 * the MCP `pulse_export` tool, so all three always agree.
 *
 * Sections are built independently: one failing report is recorded under
 * `errors` instead of sinking the whole export.
 */
import { db, sql as pg } from '../db/index.js';
import { sql, eq } from 'drizzle-orm';
import { funnels as funnelsTable, goals as goalsTable } from '../db/schema.js';
import type { ResolvedRange } from './time.js';
import type { Filters } from './filters.js';
import type { Project } from './types.js';
import { summaryWithComparison, timeseries, pages, breakdown, customEvents, performance } from './reports.js';
import { exitPages, frustrationByPage, formAbandonment, retention } from './insights.js';
import { buildDigest } from './digest.js';
import { computeFunnel } from './funnel-engine.js';

const NO_FILTERS: Filters = {};

export interface ExportOptions {
  /** Lead names, phones, emails and messages. Off for API keys unless asked for. */
  includeLeadContacts: boolean;
}

export type ExportBundle = Record<string, unknown> & {
  generatedAt: string;
  project: { id: string; name: string; domain: string; timezone: string };
  period: { from: string; to: string; timezone: string; comparedTo: { from: string; to: string } | null };
  errors: Record<string, string>;
};

async function section<T>(errors: Record<string, string>, name: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    errors[name] = e instanceof Error ? e.message : String(e);
    return null;
  }
}

export async function revenueReport(project: Project, range: ResolvedRange) {
  const [totals] = (await db.execute(sql`
    SELECT COALESCE(SUM(conversion_value), 0)::double precision AS revenue,
           COALESCE(SUM(conversions), 0)::bigint AS conversions
    FROM daily_stats
    WHERE project_id = ${project.id} AND day >= ${range.fromDate}::date AND day <= ${range.toDate}::date
  `)) as unknown as Array<{ revenue: number; conversions: string }>;
  const channels = (await db.execute(sql`
    SELECT COALESCE(channel, 'Unknown') AS channel, SUM(conversion_value)::double precision AS revenue, COUNT(*)::int AS sessions
    FROM sessions
    WHERE project_id = ${project.id} AND started_at >= ${range.fromIso}::timestamptz AND started_at < ${range.toIso}::timestamptz
    GROUP BY 1 ORDER BY revenue DESC NULLS LAST LIMIT 50
  `)) as unknown as Array<{ channel: string; revenue: number; sessions: number }>;
  return { revenue: Number(totals?.revenue ?? 0), conversions: Number(totals?.conversions ?? 0), channels };
}

/** Lead inbox: totals for any key; contact details only when allowed. */
export async function leadsReport(project: Project, range: ResolvedRange, opts: ExportOptions, limit = 500) {
  const [totals] = await pg<Array<Record<string, number>>>`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE first_seen_at >= ${range.fromIso}::timestamptz AND first_seen_at < ${range.toIso}::timestamptz)::int AS in_period,
           COUNT(*) FILTER (WHERE status = 'won')::int AS won
    FROM leads WHERE project_id = ${project.id}`;
  const [bySource, byChannel, byStatus] = await Promise.all([
    pg`SELECT s AS source, COUNT(*)::int AS leads FROM leads, unnest(sources) AS s WHERE project_id = ${project.id} GROUP BY s ORDER BY leads DESC`,
    pg`SELECT COALESCE(channel, 'Unattributed') AS channel, COUNT(*)::int AS leads FROM leads WHERE project_id = ${project.id} GROUP BY 1 ORDER BY leads DESC`,
    pg`SELECT status, COUNT(*)::int AS leads FROM leads WHERE project_id = ${project.id} GROUP BY status ORDER BY leads DESC`,
  ]);
  const rows = opts.includeLeadContacts
    ? await pg`
        SELECT name, business_name, phone, email, city, business_type, source, status, score, touches,
               channel, landing_path, utm_source, utm_campaign, message, first_seen_at, last_seen_at
        FROM leads WHERE project_id = ${project.id}
        ORDER BY last_seen_at DESC LIMIT ${limit}`
    : await pg`
        SELECT business_type, city, source, status, score, touches, channel, landing_path, utm_source,
               utm_campaign, first_seen_at, last_seen_at
        FROM leads WHERE project_id = ${project.id}
        ORDER BY last_seen_at DESC LIMIT ${limit}`;
  return { ...totals, contactsIncluded: opts.includeLeadContacts, bySource, byChannel, byStatus, recent: rows };
}

export async function buildExport(project: Project, range: ResolvedRange, opts: ExportOptions): Promise<ExportBundle> {
  const errors: Record<string, string> = {};
  const pid = project.id;
  const f = NO_FILTERS;
  const s = <T>(name: string, run: () => Promise<T>) => section(errors, name, run);

  const [
    summary, insights, series, topPages, exits, channels, sources, referrers, campaigns,
    utmSources, utmMediums, entryPages, countries, devices, browsers, oses, events, vitals, frustration, forms, cohorts,
    goals, funnels, revenue, leads,
  ] = await Promise.all([
    s('summary', () => summaryWithComparison(pid, range, f)),
    s('insights', () => buildDigest(project, range)),
    s('timeseries', () => timeseries(pid, range, f)),
    s('pages', () => pages(pid, range, f, 100)),
    s('exits', () => exitPages(pid, range, f, 25)),
    s('channels', () => breakdown(pid, range, f, 'channel', 20)),
    s('sources', () => breakdown(pid, range, f, 'source', 30)),
    s('referrers', () => breakdown(pid, range, f, 'referrer', 30)),
    s('campaigns', () => breakdown(pid, range, f, 'utm_campaign', 30)),
    s('utmSources', () => breakdown(pid, range, f, 'utm_source', 30)),
    s('utmMediums', () => breakdown(pid, range, f, 'utm_medium', 30)),
    s('entryPages', () => breakdown(pid, range, f, 'entry_page', 30)),
    s('countries', () => breakdown(pid, range, f, 'country', 30)),
    s('devices', () => breakdown(pid, range, f, 'device', 5)),
    s('browsers', () => breakdown(pid, range, f, 'browser', 12)),
    s('operatingSystems', () => breakdown(pid, range, f, 'os', 12)),
    s('customEvents', () => customEvents(pid, range, f, 100)),
    s('performance', () => performance(pid, range, f)),
    s('frustration', () => frustrationByPage(pid, range, f, 20)),
    s('formAbandonment', () => formAbandonment(pid, range, 20)),
    s('retention', () => retention(pid, range, project.identityMode, 'week')),
    s('goals', () => db.query.goals.findMany({ where: eq(goalsTable.projectId, pid) })),
    s('funnels', async () => {
      const defs = await db.query.funnels.findMany({ where: eq(funnelsTable.projectId, pid) });
      return Promise.all(defs.map(async (d) => ({
        name: d.name,
        ...(await computeFunnel(pid, range, f, d).catch((e: unknown) => ({ error: e instanceof Error ? e.message : 'failed' }))),
      })));
    }),
    s('revenue', () => revenueReport(project, range)),
    s('leads', () => leadsReport(project, range, opts)),
  ]);

  const errorGroups = await s('errors', async () => (await db.execute(sql`
    SELECT message, source, line, sample_path, count, affected_sessions, last_seen_at
    FROM error_groups
    WHERE project_id = ${pid} AND resolved = FALSE
      AND last_seen_at >= ${range.fromIso}::timestamptz AND last_seen_at < ${range.toIso}::timestamptz
    ORDER BY affected_sessions DESC, count DESC LIMIT 30
  `)) as unknown as Array<Record<string, unknown>>);

  return {
    generatedAt: new Date().toISOString(),
    project: { id: pid, name: project.name, domain: project.domain, timezone: project.timezone },
    period: {
      from: range.fromDate, to: range.toDate, timezone: range.tz,
      comparedTo: range.compare ? { from: range.compare.fromDate, to: range.compare.toDate } : null,
    },
    summary, insights, timeseries: series, pages: topPages, exits,
    audience: { channels, sources, referrers, campaigns, utmSources, utmMediums, entryPages, countries, devices, browsers, operatingSystems: oses },
    customEvents: events, performance: vitals, frustration, formAbandonment: forms, retention: cohorts,
    javascriptErrors: errorGroups,
    goals: goals?.map((g) => ({ name: g.name, kind: g.kind, matchType: g.matchType, matchValue: g.matchValue, value: g.value })) ?? null,
    funnels, revenue, leads,
    errors,
  };
}

// ─────────────────────────────────────────────────────────────
// Markdown rendering
// ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace('T', ' ');
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(2);
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').slice(0, 160);
}

function table(rows: Row[] | null | undefined, columns: Array<[key: string, label: string]>): string {
  if (!rows?.length) return '_No data in this period._\n';
  const head = `| ${columns.map(([, l]) => l).join(' | ')} |\n|${columns.map(() => '---').join('|')}|`;
  return `${head}\n${rows.map((r) => `| ${columns.map(([k]) => cell(r[k])).join(' | ')} |`).join('\n')}\n`;
}

const fmtSec = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
const pct = (v: unknown) => (typeof v === 'number' ? `${v.toFixed(1)}%` : '');
const BREAKDOWN_COLS: Array<[string, string]> = [
  ['value', 'Value'], ['visitors', 'Visitors'], ['sessions', 'Sessions'], ['pageviews', 'Pageviews'],
  ['bounceRate', 'Bounce %'], ['conversions', 'Conversions'],
];

export function exportToMarkdown(b: ExportBundle): string {
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);
  const get = <T>(k: string) => b[k] as T | null;

  push(`# ${b.project.name} — analytics export`, '');
  push(`- Site: ${b.project.domain}`);
  push(`- Period: ${b.period.from} to ${b.period.to} (${b.period.timezone})${b.period.comparedTo ? `, compared with ${b.period.comparedTo.from} to ${b.period.comparedTo.to}` : ''}`);
  push(`- Generated: ${b.generatedAt}`, '- Source: Pulse Analytics. Percentages are 0–100. Durations are seconds unless shown as m/s.', '');

  const sum = get<{ current: Row; previous: Row | null; change: Row | null }>('summary');
  if (sum) {
    const c = sum.current;
    const ch = (k: string) => (sum.change && typeof sum.change[k] === 'number' ? ` (${(sum.change[k] as number) > 0 ? '+' : ''}${(sum.change[k] as number).toFixed(1)}%)` : '');
    push('## Headline numbers', '');
    push(`- Visitors: ${cell(c.visitors)}${ch('visitors')} — new ${cell(c.newVisitors)}, returning ${cell(c.returningVisitors)}`);
    push(`- Sessions: ${cell(c.sessions)}${ch('sessions')}; pageviews ${cell(c.pageviews)}${ch('pageviews')}; pages/session ${cell(c.pagesPerSession)}`);
    push(`- Bounce rate: ${pct(c.bounceRate)}${ch('bounceRate')}; engagement rate ${pct(c.engagementRate)}; avg session ${fmtSec(Number(c.avgSessionSec) || 0)}`);
    push(`- Conversions: ${cell(c.conversions)} (${pct(c.conversionRate)}), value ${cell(c.conversionValue)}`);
    push(`- Rage clicks ${cell(c.rageClicks)}, dead clicks ${cell(c.deadClicks)}, JS errors ${cell(c.errors)}`, '');
  }

  const ins = get<{ narrative: string; findings: Row[] }>('insights');
  if (ins) {
    push('## What Pulse noticed', '', ins.narrative, '');
    if (ins.findings?.length) push(table(ins.findings, [['kind', 'Kind'], ['severity', 'Severity'], ['headline', 'Finding'], ['detail', 'Why']]));
  }

  const leads = get<Row & { bySource: Row[]; byChannel: Row[]; byStatus: Row[]; recent: Row[]; contactsIncluded: boolean }>('leads');
  if (leads) {
    push('## Leads', '', `- Total ${cell(leads.total)}, new in this period ${cell(leads.in_period)}, won ${cell(leads.won)}`, '');
    push('### By source', '', table(leads.bySource, [['source', 'Source'], ['leads', 'Leads']]));
    push('### By channel (first visit)', '', table(leads.byChannel, [['channel', 'Channel'], ['leads', 'Leads']]));
    push('### By status', '', table(leads.byStatus, [['status', 'Status'], ['leads', 'Leads']]));
    push(`### Recent leads${leads.contactsIncluded ? '' : ' (contact details withheld)'}`, '');
    push(table(leads.recent, leads.contactsIncluded
      ? [['last_seen_at', 'Last seen'], ['name', 'Name'], ['business_name', 'Business'], ['phone', 'Phone'], ['email', 'Email'], ['city', 'City'], ['source', 'Source'], ['channel', 'Channel'], ['status', 'Status'], ['score', 'Score'], ['message', 'Message']]
      : [['last_seen_at', 'Last seen'], ['business_type', 'Type'], ['city', 'City'], ['source', 'Source'], ['channel', 'Channel'], ['status', 'Status'], ['score', 'Score']]));
  }

  push('## Traffic over time', '', table(get<Row[]>('timeseries'), [['bucket', 'Period'], ['visitors', 'Visitors'], ['sessions', 'Sessions'], ['pageviews', 'Pageviews'], ['bounces', 'Bounces'], ['conversions', 'Conversions']]));
  push('## Pages', '', table(get<Row[]>('pages'), [['path', 'Path'], ['views', 'Views'], ['visitors', 'Visitors'], ['entrances', 'Entrances'], ['exits', 'Exits'], ['avgTimeSec', 'Avg time (s)'], ['bounceRate', 'Bounce %'], ['exitRate', 'Exit %'], ['avgScroll', 'Scroll %']]));
  push('## Where visitors leave', '', table(get<Row[]>('exits'), [['path', 'Path'], ['exits', 'Exits'], ['views', 'Views'], ['exitRate', 'Exit %'], ['avgScrollAtExit', 'Scroll at exit %'], ['frustrationRate', 'Frustration %']]));

  const aud = get<Record<string, Row[] | null>>('audience');
  if (aud) {
    const parts: Array<[string, string]> = [
      ['channels', 'Channels'], ['sources', 'Sources'], ['referrers', 'Referrers'], ['campaigns', 'UTM campaigns'],
      ['utmSources', 'UTM sources'], ['utmMediums', 'UTM mediums'], ['entryPages', 'Landing pages'], ['countries', 'Countries'], ['devices', 'Devices'], ['browsers', 'Browsers'], ['operatingSystems', 'Operating systems'],
    ];
    push('## Audience', '');
    for (const [k, label] of parts) push(`### ${label}`, '', table(aud[k], BREAKDOWN_COLS));
  }

  push('## Custom events', '', table(get<Row[]>('customEvents'), [['name', 'Event'], ['count', 'Count'], ['visitors', 'Visitors'], ['sessions', 'Sessions']]));

  const perf = get<Row & { slowestPages?: Row[] }>('performance');
  if (perf) {
    const vitals = Object.entries(perf).filter(([k, v]) => k !== 'slowestPages' && v && typeof v === 'object' && 'p75' in (v as Row))
      .map(([k, v]) => ({ vital: k, ...(v as Row) }));
    push('## Performance (Core Web Vitals)', '', table(vitals, [['vital', 'Metric'], ['p50', 'p50'], ['p75', 'p75'], ['p90', 'p90'], ['samples', 'Samples']]));
    if (perf.slowestPages?.length) push('### Slowest pages', '', table(perf.slowestPages, Object.keys(perf.slowestPages[0]).map((k) => [k, k] as [string, string])));
  }

  const frus = get<Row[]>('frustration');
  if (frus?.length) push('## Frustration by page', '', table(frus, Object.keys(frus[0]).map((k) => [k, k] as [string, string])));
  const forms = get<Row[]>('formAbandonment');
  if (forms?.length) push('## Form abandonment', '', table(forms, Object.keys(forms[0]).map((k) => [k, k] as [string, string])));

  const ret = get<{ reliable: boolean; cohorts: Array<Row & { rates: number[] }> }>('retention');
  if (ret) {
    push('## Retention (weekly cohorts)', '');
    if (!ret.reliable) push('_Cookieless identity cannot follow visitors across days, so retention is understated._', '');
    push(table(ret.cohorts.map((c) => ({ ...c, rates: c.rates.map((r) => `${r.toFixed(0)}%`) })), [['cohort', 'Cohort'], ['size', 'Visitors'], ['rates', 'Retained by week']]));
  }

  const errs = get<Row[]>('javascriptErrors');
  push('## JavaScript errors (unresolved)', '', table(errs, [['message', 'Message'], ['sample_path', 'Page'], ['count', 'Count'], ['affected_sessions', 'Sessions'], ['last_seen_at', 'Last seen']]));

  const goals = get<Row[]>('goals');
  if (goals?.length) push('## Goals', '', table(goals, [['name', 'Goal'], ['kind', 'Kind'], ['matchType', 'Match'], ['matchValue', 'Value'], ['value', 'Worth']]));
  const funnels = get<Array<Row & { steps?: Row[] }>>('funnels');
  if (funnels?.length) {
    push('## Funnels', '');
    for (const fn of funnels) {
      push(`### ${cell(fn.name)}`, '', `Entered ${cell(fn.totalEntered)}, completed ${cell(fn.totalCompleted)}, conversion ${pct(fn.overallConversion)}`, '');
      if (fn.steps?.length) push(table(fn.steps, Object.keys(fn.steps[0]).map((k) => [k, k] as [string, string])));
    }
  }

  const rev = get<{ revenue: number; conversions: number; channels: Row[] }>('revenue');
  if (rev && (rev.revenue || rev.conversions)) {
    push('## Revenue', '', `- Revenue ${cell(rev.revenue)} from ${cell(rev.conversions)} conversions`, '', table(rev.channels, [['channel', 'Channel'], ['revenue', 'Revenue'], ['sessions', 'Sessions']]));
  }

  const failed = Object.entries(b.errors);
  if (failed.length) push('## Sections that could not be built', '', ...failed.map(([k, v]) => `- ${k}: ${v}`), '');
  return out.join('\n');
}
