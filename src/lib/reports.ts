/**
 * Report query layer.
 *
 * Single source of truth for every metric. The `sessions` table is the
 * authoritative aggregate — it is built once by the rollup worker, and both the
 * fast rollup path (`daily_stats`, `daily_pages`) and the filtered path derive
 * from it, so the two can never disagree.
 *
 * Routing rule: unfiltered queries use the daily rollups (cheap, index-only);
 * any active segment filter drops to the session table, which is still one row
 * per session rather than the raw event firehose.
 */

import { db } from '../db/index.js';
import { sql, type SQL } from 'drizzle-orm';
import { canUseRollups, sessionConditions, eventConditions, type Filters } from './filters.js';
import { densify, pctChange, type DayRange, type Granularity, type ResolvedRange } from './time.js';

type Row = Record<string, unknown>;

async function query(statement: SQL): Promise<Row[]> {
  return (await db.execute(statement)) as unknown as Row[];
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round(v: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

// ─────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────

export interface Summary {
  pageviews: number;
  visitors: number;
  newVisitors: number;
  sessions: number;
  bounces: number;
  engagedSessions: number;
  conversions: number;
  conversionValue: number;
  rageClicks: number;
  deadClicks: number;
  errors: number;
  /** Derived */
  bounceRate: number;
  engagementRate: number;
  avgSessionSec: number;
  pagesPerSession: number;
  conversionRate: number;
  returningVisitors: number;
}

const EMPTY_SUMMARY: Summary = {
  pageviews: 0, visitors: 0, newVisitors: 0, sessions: 0, bounces: 0,
  engagedSessions: 0, conversions: 0, conversionValue: 0, rageClicks: 0,
  deadClicks: 0, errors: 0, bounceRate: 0, engagementRate: 0,
  avgSessionSec: 0, pagesPerSession: 0, conversionRate: 0, returningVisitors: 0,
};

function derive(raw: Omit<Summary, 'bounceRate' | 'engagementRate' | 'avgSessionSec' | 'pagesPerSession' | 'conversionRate' | 'returningVisitors'>, totalDuration: number): Summary {
  const s = raw.sessions;
  return {
    ...raw,
    bounceRate: s ? round((raw.bounces / s) * 100) : 0,
    engagementRate: s ? round((raw.engagedSessions / s) * 100) : 0,
    avgSessionSec: s ? Math.round(totalDuration / s) : 0,
    pagesPerSession: s ? round(raw.pageviews / s, 2) : 0,
    conversionRate: s ? round((raw.conversions / s) * 100) : 0,
    returningVisitors: Math.max(raw.visitors - raw.newVisitors, 0),
  };
}

export async function summary(projectId: string, range: DayRange, filters: Filters): Promise<Summary> {
  if (canUseRollups(filters)) {
    const [totals] = await query(sql`
      SELECT
        COALESCE(SUM(pageviews), 0)          AS pageviews,
        COALESCE(SUM(sessions), 0)           AS sessions,
        COALESCE(SUM(bounces), 0)            AS bounces,
        COALESCE(SUM(engaged_sessions), 0)   AS engaged_sessions,
        COALESCE(SUM(total_duration_sec), 0) AS total_duration,
        COALESCE(SUM(conversions), 0)        AS conversions,
        COALESCE(SUM(conversion_value), 0)   AS conversion_value,
        COALESCE(SUM(rage_clicks), 0)        AS rage_clicks,
        COALESCE(SUM(dead_clicks), 0)        AS dead_clicks,
        COALESCE(SUM(errors), 0)             AS errors
      FROM daily_stats
      WHERE project_id = ${projectId} AND day >= ${range.fromDate}::date AND day <= ${range.toDate}::date
    `);

    // Visitors must be distinct across the whole range, not a sum of daily counts.
    const [people] = await query(sql`
      SELECT COUNT(DISTINCT visitor_id) AS visitors,
             COUNT(DISTINCT visitor_id) FILTER (WHERE is_new) AS new_visitors
      FROM daily_visitors
      WHERE project_id = ${projectId} AND day >= ${range.fromDate}::date AND day <= ${range.toDate}::date
    `);

    if (!totals) return EMPTY_SUMMARY;

    return derive({
      pageviews: num(totals.pageviews),
      visitors: num(people?.visitors),
      newVisitors: num(people?.new_visitors),
      sessions: num(totals.sessions),
      bounces: num(totals.bounces),
      engagedSessions: num(totals.engaged_sessions),
      conversions: num(totals.conversions),
      conversionValue: num(totals.conversion_value),
      rageClicks: num(totals.rage_clicks),
      deadClicks: num(totals.dead_clicks),
      errors: num(totals.errors),
    }, num(totals.total_duration));
  }

  const [row] = await query(sql`
    SELECT
      COALESCE(SUM(s.pageview_count), 0)              AS pageviews,
      COUNT(DISTINCT s.visitor_id)                    AS visitors,
      COUNT(DISTINCT s.visitor_id) FILTER (WHERE s.is_new_visitor) AS new_visitors,
      COUNT(*)                                        AS sessions,
      COUNT(*) FILTER (WHERE s.is_bounce)             AS bounces,
      COUNT(*) FILTER (WHERE s.is_engaged)            AS engaged_sessions,
      COALESCE(SUM(s.duration_sec), 0)                AS total_duration,
      COUNT(*) FILTER (WHERE s.converted)             AS conversions,
      COALESCE(SUM(s.conversion_value), 0)            AS conversion_value,
      COALESCE(SUM(s.rage_clicks), 0)                 AS rage_clicks,
      COALESCE(SUM(s.dead_clicks), 0)                 AS dead_clicks,
      COALESCE(SUM(s.error_count), 0)                 AS errors
    FROM sessions s
    WHERE s.project_id = ${projectId}
      AND s.started_at >= ${range.from} AND s.started_at < ${range.to}
      AND ${sessionConditions(filters)}
  `);

  if (!row) return EMPTY_SUMMARY;

  return derive({
    pageviews: num(row.pageviews),
    visitors: num(row.visitors),
    newVisitors: num(row.new_visitors),
    sessions: num(row.sessions),
    bounces: num(row.bounces),
    engagedSessions: num(row.engaged_sessions),
    conversions: num(row.conversions),
    conversionValue: num(row.conversion_value),
    rageClicks: num(row.rage_clicks),
    deadClicks: num(row.dead_clicks),
    errors: num(row.errors),
  }, num(row.total_duration));
}

/** Summary plus the comparison period and per-metric percentage deltas. */
export async function summaryWithComparison(projectId: string, range: ResolvedRange, filters: Filters) {
  const current = await summary(projectId, range, filters);
  if (!range.compare) return { current, previous: null, change: null };

  const previous = await summary(projectId, range.compare, filters);
  const change: Record<string, number | null> = {};
  for (const key of Object.keys(current) as Array<keyof Summary>) {
    change[key] = pctChange(current[key], previous[key]);
  }
  return { current, previous, change };
}

// ─────────────────────────────────────────────────────────────
// Time series
// ─────────────────────────────────────────────────────────────

const TRUNC: Record<Granularity, string> = { hour: 'hour', day: 'day', week: 'week', month: 'month' };

export interface SeriesPoint {
  bucket: string;
  pageviews: number;
  visitors: number;
  sessions: number;
  bounces: number;
  conversions: number;
}

const SERIES_ZERO: Omit<SeriesPoint, 'bucket'> = {
  pageviews: 0, visitors: 0, sessions: 0, bounces: 0, conversions: 0,
};

export async function timeseries(
  projectId: string,
  range: ResolvedRange,
  filters: Filters,
): Promise<SeriesPoint[]> {
  const unit = sql.raw(`'${TRUNC[range.granularity]}'`);
  const tz = range.tz;

  // Bucket in the project's zone, then hand back a UTC instant so the dense
  // series and the aggregate agree on keys.
  const bucketExpr = sql`(date_trunc(${unit}, s.started_at AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;

  const rows = await query(sql`
    SELECT ${bucketExpr} AS bucket,
           COALESCE(SUM(s.pageview_count), 0)  AS pageviews,
           COUNT(DISTINCT s.visitor_id)        AS visitors,
           COUNT(*)                            AS sessions,
           COUNT(*) FILTER (WHERE s.is_bounce) AS bounces,
           COUNT(*) FILTER (WHERE s.converted) AS conversions
    FROM sessions s
    WHERE s.project_id = ${projectId}
      AND s.started_at >= ${range.from} AND s.started_at < ${range.to}
      AND ${sessionConditions(filters)}
    GROUP BY 1 ORDER BY 1
  `);

  return densify(rows, range, range.granularity, tz, SERIES_ZERO) as SeriesPoint[];
}

// ─────────────────────────────────────────────────────────────
// Pages
// ─────────────────────────────────────────────────────────────

export interface PageRow {
  path: string;
  views: number;
  visitors: number;
  entrances: number;
  exits: number;
  bounces: number;
  avgTimeSec: number;
  bounceRate: number;
  exitRate: number;
  avgScroll: number;
}

export async function pages(
  projectId: string,
  range: DayRange,
  filters: Filters,
  limit = 100,
): Promise<PageRow[]> {
  if (canUseRollups(filters)) {
    const rows = await query(sql`
      SELECT path,
             SUM(views) AS views,
             SUM(entrances) AS entrances,
             SUM(exits) AS exits,
             SUM(bounces) AS bounces,
             SUM(total_time_sec) AS total_time,
             SUM(time_samples) AS time_samples,
             SUM(scroll_sum) AS scroll_sum,
             SUM(scroll_samples) AS scroll_samples
      FROM daily_pages
      WHERE project_id = ${projectId} AND day >= ${range.fromDate}::date AND day <= ${range.toDate}::date
      GROUP BY path
      ORDER BY views DESC
      LIMIT ${limit}
    `);

    // Distinct visitors per page cannot be summed across days — one extra pass.
    const visitorRows = await query(sql`
      SELECT e.path, COUNT(DISTINCT e.visitor_id) AS visitors
      FROM events e
      WHERE e.project_id = ${projectId} AND e.type = 'pageview'
        AND e.timestamp >= ${range.from} AND e.timestamp < ${range.to}
        AND e.path IS NOT NULL
      GROUP BY e.path
    `);
    const visitorsByPath = new Map(visitorRows.map((r) => [String(r.path), num(r.visitors)]));

    return rows.map((r) => shapePage(r, visitorsByPath.get(String(r.path)) ?? 0));
  }

  const rows = await query(sql`
    WITH pv AS (
      SELECT e.path, e.visitor_id, e.session_id,
             LEAD(e.timestamp) OVER (PARTITION BY e.session_id ORDER BY e.timestamp, e.id) - e.timestamp AS gap
      FROM events e
      WHERE e.project_id = ${projectId} AND e.type = 'pageview' AND e.path IS NOT NULL
        AND e.timestamp >= ${range.from} AND e.timestamp < ${range.to}
        AND ${eventConditions(filters, projectId)}
    ),
    page_agg AS (
      SELECT path,
             COUNT(*) AS views,
             COUNT(DISTINCT visitor_id) AS visitors,
             COALESCE(SUM(LEAST(EXTRACT(EPOCH FROM gap), 1800)) FILTER (WHERE gap IS NOT NULL), 0) AS total_time,
             COUNT(*) FILTER (WHERE gap IS NOT NULL) AS time_samples
      FROM pv GROUP BY path
    ),
    entry_agg AS (
      SELECT s.entry_path AS path, COUNT(*) AS entrances,
             COUNT(*) FILTER (WHERE s.is_bounce) AS bounces,
             COALESCE(SUM(s.max_scroll_depth), 0) AS scroll_sum,
             COUNT(*) AS scroll_samples
      FROM sessions s
      WHERE s.project_id = ${projectId}
        AND s.started_at >= ${range.from} AND s.started_at < ${range.to}
        AND s.entry_path IS NOT NULL AND ${sessionConditions(filters)}
      GROUP BY s.entry_path
    ),
    exit_agg AS (
      SELECT s.exit_path AS path, COUNT(*) AS exits
      FROM sessions s
      WHERE s.project_id = ${projectId}
        AND s.started_at >= ${range.from} AND s.started_at < ${range.to}
        AND s.exit_path IS NOT NULL AND ${sessionConditions(filters)}
      GROUP BY s.exit_path
    )
    SELECT COALESCE(p.path, en.path, ex.path) AS path,
           COALESCE(p.views, 0) AS views, COALESCE(p.visitors, 0) AS visitors,
           COALESCE(en.entrances, 0) AS entrances, COALESCE(ex.exits, 0) AS exits,
           COALESCE(en.bounces, 0) AS bounces,
           COALESCE(p.total_time, 0) AS total_time, COALESCE(p.time_samples, 0) AS time_samples,
           COALESCE(en.scroll_sum, 0) AS scroll_sum, COALESCE(en.scroll_samples, 0) AS scroll_samples
    FROM page_agg p
    FULL OUTER JOIN entry_agg en ON en.path = p.path
    FULL OUTER JOIN exit_agg ex ON ex.path = COALESCE(p.path, en.path)
    WHERE COALESCE(p.path, en.path, ex.path) IS NOT NULL
    ORDER BY views DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => shapePage(r, num(r.visitors)));
}

function shapePage(r: Row, visitors: number): PageRow {
  const views = num(r.views);
  const entrances = num(r.entrances);
  const timeSamples = num(r.time_samples);
  const scrollSamples = num(r.scroll_samples);
  return {
    path: String(r.path),
    views,
    visitors,
    entrances,
    exits: num(r.exits),
    bounces: num(r.bounces),
    avgTimeSec: timeSamples ? Math.round(num(r.total_time) / timeSamples) : 0,
    bounceRate: entrances ? round((num(r.bounces) / entrances) * 100) : 0,
    exitRate: views ? round((num(r.exits) / views) * 100) : 0,
    avgScroll: scrollSamples ? Math.round(num(r.scroll_sum) / scrollSamples) : 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Dimension breakdowns
// ─────────────────────────────────────────────────────────────

/** Whitelist of breakdown dimensions → session columns. Never interpolate user input. */
const BREAKDOWNS: Record<string, string> = {
  source: 's.source',
  channel: 's.channel',
  referrer: 's.referrer_host',
  country: 's.country',
  device: 's.device',
  browser: 's.browser',
  os: 's.os',
  utm_source: 's.utm_source',
  utm_medium: 's.utm_medium',
  utm_campaign: 's.utm_campaign',
  entry_page: 's.entry_path',
  exit_page: 's.exit_path',
};

export const BREAKDOWN_DIMENSIONS = Object.keys(BREAKDOWNS);

export interface BreakdownRow {
  value: string;
  visitors: number;
  sessions: number;
  pageviews: number;
  bounceRate: number;
  avgSessionSec: number;
  conversions: number;
  conversionRate: number;
}

export async function breakdown(
  projectId: string,
  range: DayRange,
  filters: Filters,
  dimension: string,
  limit = 50,
): Promise<BreakdownRow[]> {
  const column = BREAKDOWNS[dimension];
  if (!column) throw new Error(`Unsupported dimension: ${dimension}`);
  const col = sql.raw(column);

  const rows = await query(sql`
    SELECT ${col} AS value,
           COUNT(DISTINCT s.visitor_id)        AS visitors,
           COUNT(*)                            AS sessions,
           COALESCE(SUM(s.pageview_count), 0)  AS pageviews,
           COUNT(*) FILTER (WHERE s.is_bounce) AS bounces,
           COALESCE(SUM(s.duration_sec), 0)    AS total_duration,
           COUNT(*) FILTER (WHERE s.converted) AS conversions
    FROM sessions s
    WHERE s.project_id = ${projectId}
      AND s.started_at >= ${range.from} AND s.started_at < ${range.to}
      AND ${col} IS NOT NULL AND ${col} <> ''
      AND ${sessionConditions(filters)}
    GROUP BY ${col}
    ORDER BY visitors DESC, sessions DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => {
    const s = num(r.sessions);
    return {
      value: String(r.value),
      visitors: num(r.visitors),
      sessions: s,
      pageviews: num(r.pageviews),
      bounceRate: s ? round((num(r.bounces) / s) * 100) : 0,
      avgSessionSec: s ? Math.round(num(r.total_duration) / s) : 0,
      conversions: num(r.conversions),
      conversionRate: s ? round((num(r.conversions) / s) * 100) : 0,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// Custom events
// ─────────────────────────────────────────────────────────────

export async function customEvents(projectId: string, range: DayRange, filters: Filters, limit = 50) {
  const rows = await query(sql`
    SELECT e.name AS name,
           COUNT(*) AS count,
           COUNT(DISTINCT e.visitor_id) AS visitors,
           COUNT(DISTINCT e.session_id) AS sessions
    FROM events e
    WHERE e.project_id = ${projectId} AND e.type = 'custom' AND e.name IS NOT NULL
      AND e.timestamp >= ${range.from} AND e.timestamp < ${range.to}
      AND ${eventConditions(filters, projectId)}
    GROUP BY e.name
    ORDER BY count DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    name: String(r.name),
    count: num(r.count),
    visitors: num(r.visitors),
    sessions: num(r.sessions),
  }));
}

// ─────────────────────────────────────────────────────────────
// Performance — percentiles, not means
// ─────────────────────────────────────────────────────────────

const VITALS = ['lcp', 'cls', 'inp', 'ttfb', 'fcp', 'load_time', 'dom_ready'] as const;
export type Vital = (typeof VITALS)[number];

export async function performance(projectId: string, range: DayRange, filters: Filters) {
  const metricExpr = (key: Vital) => sql.raw(`(e.payload->>'${key}')::numeric`);

  const results: Record<string, { p50: number; p75: number; p90: number; p99: number; samples: number }> = {};

  for (const vital of VITALS) {
    const [row] = await query(sql`
      SELECT
        COUNT(*) AS samples,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ${metricExpr(vital)}) AS p50,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${metricExpr(vital)}) AS p75,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY ${metricExpr(vital)}) AS p90,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ${metricExpr(vital)}) AS p99
      FROM events e
      WHERE e.project_id = ${projectId} AND e.type = 'performance'
        AND e.timestamp >= ${range.from} AND e.timestamp < ${range.to}
        AND e.payload ? ${vital}
        AND ${eventConditions(filters, projectId)}
    `);
    results[vital] = {
      samples: num(row?.samples),
      p50: round(num(row?.p50), 3),
      p75: round(num(row?.p75), 3),
      p90: round(num(row?.p90), 3),
      p99: round(num(row?.p99), 3),
    };
  }

  // Slowest pages by p75 LCP — the ranking Google actually grades on.
  const byPage = await query(sql`
    SELECT e.path,
           COUNT(*) AS samples,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY (e.payload->>'lcp')::numeric) AS p75_lcp,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY (e.payload->>'ttfb')::numeric) AS p75_ttfb
    FROM events e
    WHERE e.project_id = ${projectId} AND e.type = 'performance' AND e.path IS NOT NULL
      AND e.timestamp >= ${range.from} AND e.timestamp < ${range.to}
      AND e.payload ? 'lcp'
      AND ${eventConditions(filters, projectId)}
    GROUP BY e.path
    HAVING COUNT(*) >= 3
    ORDER BY p75_lcp DESC NULLS LAST
    LIMIT 20
  `);

  return {
    vitals: results,
    slowestPages: byPage.map((r) => ({
      path: String(r.path),
      samples: num(r.samples),
      p75Lcp: Math.round(num(r.p75_lcp)),
      p75Ttfb: Math.round(num(r.p75_ttfb)),
    })),
  };
}
