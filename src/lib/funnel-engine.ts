/**
 * Funnel computation.
 *
 * Visitor-scoped with a conversion window: a visitor enters at step 1, and each
 * later step must occur *after* the previous one and within `windowHours` of
 * entering. That is the same semantics PostHog and Amplitude use, and it is the
 * only one that gives an honest drop-off — counting each step independently
 * would happily report step 3 completing more often than step 2.
 *
 * Implemented as a chain of CTEs so the whole funnel is one round trip.
 */

import { db } from '../db/index.js';
import { sql, type SQL } from 'drizzle-orm';
import { sessionConditions, type Filters } from './filters.js';
import type { DayRange } from './time.js';
import type { FunnelStep } from '../db/schema.js';

type Row = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round = (v: number, p = 1): number => Math.round(v * 10 ** p) / 10 ** p;

export const MAX_FUNNEL_STEPS = 8;

/** Predicate for one funnel step, fully parameterised. */
function stepPredicate(step: FunnelStep): SQL {
  if (step.kind === 'event') {
    return sql`(e.type = 'custom' AND e.name = ${step.value})`;
  }
  const v = step.value;
  switch (step.matchType) {
    case 'contains':
      return sql`(e.type = 'pageview' AND POSITION(${v} IN COALESCE(e.path, '')) > 0)`;
    case 'starts_with':
      return sql`(e.type = 'pageview' AND LEFT(COALESCE(e.path, ''), ${v.length}) = ${v})`;
    case 'regex':
      return sql`(e.type = 'pageview' AND COALESCE(e.path, '') ~ ${v})`;
    default:
      if (v.endsWith('*')) {
        const prefix = v.slice(0, -1);
        return sql`(e.type = 'pageview' AND LEFT(COALESCE(e.path, ''), ${prefix.length}) = ${prefix})`;
      }
      return sql`(e.type = 'pageview' AND e.path = ${v})`;
  }
}

/** Breakdown dimensions carried from the visitor's entry session. */
const BREAKDOWN_COLUMNS: Record<string, string> = {
  device: 'device',
  browser: 'browser',
  os: 'os',
  country: 'country',
  source: 'source',
  channel: 'channel',
  utm_campaign: 'utm_campaign',
};

export const FUNNEL_BREAKDOWNS = Object.keys(BREAKDOWN_COLUMNS);

export interface FunnelStepResult {
  index: number;
  label: string;
  kind: string;
  value: string;
  entered: number;
  droppedOff: number;
  dropOffRate: number;
  conversionFromStart: number;
  conversionFromPrevious: number;
  medianSecondsFromPrevious: number | null;
}

export interface FunnelResult {
  steps: FunnelStepResult[];
  totalEntered: number;
  totalCompleted: number;
  overallConversion: number;
  medianCompletionSeconds: number | null;
  breakdown?: Array<{ value: string; entered: number; completed: number; conversion: number; stepCounts: number[] }>;
}

/**
 * Build the chained CTE. `s0` is every visitor who performed step 1 in range;
 * `sN` requires `sN-1` to have happened first and the whole thing to fit in the
 * conversion window.
 */
function buildChain(projectId: string, range: DayRange, filters: Filters, steps: FunnelStep[], windowHours: number) {
  const windowExpr = sql.raw(`interval '${Math.max(1, Math.min(windowHours, 24 * 90))} hours'`);
  const segment = sessionConditions(filters);

  // Step 1 also anchors the segment filter, via the session the visitor was in.
  let chain = sql`
    s0 AS (
      SELECT e.visitor_id, MIN(e.timestamp) AS t
      FROM events e
      JOIN sessions s ON s.project_id = ${projectId} AND s.session_id = e.session_id
      WHERE e.project_id = ${projectId}
        AND e.timestamp >= ${range.from} AND e.timestamp < ${range.to}
        AND ${stepPredicate(steps[0])}
        AND ${segment}
      GROUP BY e.visitor_id
    )`;

  for (let i = 1; i < steps.length; i++) {
    const prev = sql.raw(`s${i - 1}`);
    const curr = sql.raw(`s${i}`);
    chain = sql`${chain},
    ${curr} AS (
      SELECT e.visitor_id, MIN(e.timestamp) AS t
      FROM events e
      JOIN ${prev} p ON p.visitor_id = e.visitor_id
      WHERE e.project_id = ${projectId}
        AND e.timestamp >= p.t
        AND e.timestamp <= (SELECT t FROM s0 WHERE s0.visitor_id = e.visitor_id) + ${windowExpr}
        AND ${stepPredicate(steps[i])}
      GROUP BY e.visitor_id
    )`;
  }

  return chain;
}

export async function computeFunnel(
  projectId: string,
  range: DayRange,
  filters: Filters,
  definition: { steps: FunnelStep[]; windowHours: number },
  breakdownBy?: string,
): Promise<FunnelResult> {
  const steps = definition.steps.slice(0, MAX_FUNNEL_STEPS);
  if (steps.length < 2) throw new Error('A funnel needs at least two steps');

  const chain = buildChain(projectId, range, filters, steps, definition.windowHours);

  // Counts and median time-between for every step in one query.
  const selects: SQL[] = [];
  for (let i = 0; i < steps.length; i++) {
    const t = sql.raw(`s${i}`);
    selects.push(sql`(SELECT COUNT(*) FROM ${t}) AS ${sql.raw(`c${i}`)}`);
    if (i > 0) {
      const prev = sql.raw(`s${i - 1}`);
      selects.push(sql`(
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (cur.t - pr.t)))
        FROM ${t} cur JOIN ${prev} pr ON pr.visitor_id = cur.visitor_id
      ) AS ${sql.raw(`m${i}`)}`);
    }
  }
  const last = sql.raw(`s${steps.length - 1}`);
  selects.push(sql`(
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (fin.t - st.t)))
    FROM ${last} fin JOIN s0 st ON st.visitor_id = fin.visitor_id
  ) AS total_median`);

  const selectList = selects.reduce((acc, s, i) => (i === 0 ? s : sql`${acc}, ${s}`));

  const rows = (await db.execute(sql`WITH ${chain} SELECT ${selectList}`)) as unknown as Row[];
  const row = rows[0] ?? {};

  const counts = steps.map((_, i) => num(row[`c${i}`]));
  const entered = counts[0];
  const completed = counts[counts.length - 1];

  const stepResults: FunnelStepResult[] = steps.map((step, i) => {
    const count = counts[i];
    const previous = i === 0 ? count : counts[i - 1];
    // The last step has nowhere left to fall out of.
    const next = i === steps.length - 1 ? count : counts[i + 1];
    const dropped = Math.max(count - next, 0);
    return {
      index: i,
      label: step.label || step.value,
      kind: step.kind,
      value: step.value,
      entered: count,
      droppedOff: dropped,
      dropOffRate: count ? round((dropped / count) * 100) : 0,
      conversionFromStart: entered ? round((count / entered) * 100) : 0,
      conversionFromPrevious: previous ? round((count / previous) * 100) : 0,
      medianSecondsFromPrevious: i === 0 ? null : row[`m${i}`] === null || row[`m${i}`] === undefined ? null : Math.round(num(row[`m${i}`])),
    };
  });

  const result: FunnelResult = {
    steps: stepResults,
    totalEntered: entered,
    totalCompleted: completed,
    overallConversion: entered ? round((completed / entered) * 100) : 0,
    medianCompletionSeconds: row.total_median === null || row.total_median === undefined ? null : Math.round(num(row.total_median)),
  };

  if (breakdownBy && BREAKDOWN_COLUMNS[breakdownBy]) {
    result.breakdown = await funnelBreakdown(projectId, range, filters, definition, breakdownBy);
  }

  return result;
}

/**
 * Same funnel, split by an audience dimension taken from the visitor's entry
 * session. This is what turns "62% drop at step 3" into "mobile drops 62%,
 * desktop drops 11%".
 */
async function funnelBreakdown(
  projectId: string,
  range: DayRange,
  filters: Filters,
  definition: { steps: FunnelStep[]; windowHours: number },
  breakdownBy: string,
) {
  const steps = definition.steps.slice(0, MAX_FUNNEL_STEPS);
  const column = sql.raw(BREAKDOWN_COLUMNS[breakdownBy]);
  const chain = buildChain(projectId, range, filters, steps, definition.windowHours);

  // Attribute each visitor to the dimension value of their earliest session in range.
  const dims = sql`
    dims AS (
      SELECT DISTINCT ON (s.visitor_id) s.visitor_id, ${column} AS value
      FROM sessions s
      WHERE s.project_id = ${projectId}
        AND s.started_at >= ${range.from} AND s.started_at < ${range.to}
      ORDER BY s.visitor_id, s.started_at ASC
    )`;

  const parts: SQL[] = steps.map((_, i) => {
    const t = sql.raw(`s${i}`);
    return sql`SELECT ${i} AS step, d.value, COUNT(*) AS n
               FROM ${t} JOIN dims d ON d.visitor_id = ${t}.visitor_id
               GROUP BY d.value`;
  });
  const unioned = parts.reduce((acc, p, i) => (i === 0 ? p : sql`${acc} UNION ALL ${p}`));

  const rows = (await db.execute(sql`WITH ${chain}, ${dims} ${unioned}`)) as unknown as Row[];

  const byValue = new Map<string, number[]>();
  for (const r of rows) {
    const value = r.value === null || r.value === undefined ? '(none)' : String(r.value);
    if (!byValue.has(value)) byValue.set(value, new Array(steps.length).fill(0));
    byValue.get(value)![num(r.step)] = num(r.n);
  }

  return [...byValue.entries()]
    .map(([value, stepCounts]) => {
      const entered = stepCounts[0];
      const completed = stepCounts[stepCounts.length - 1];
      return {
        value,
        entered,
        completed,
        conversion: entered ? round((completed / entered) * 100) : 0,
        stepCounts,
      };
    })
    .filter((r) => r.entered > 0)
    .sort((a, b) => b.entered - a.entered)
    .slice(0, 12);
}
