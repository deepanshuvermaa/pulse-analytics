/**
 * Rollup worker: materialises sessions and daily aggregates from raw events.
 *
 * Everything is rebuilt per (project, day) as an idempotent set-based recompute,
 * so a replayed ingest batch, a late-arriving event, or a crashed run can never
 * leave a half-written day. Closed days are built once and sealed; the current
 * day in the project's timezone is rebuilt on every pass.
 *
 * Days are project-timezone days — `date_trunc(… AT TIME ZONE tz)` throughout —
 * so a customer in Asia/Kolkata sees their own midnight, not UTC's.
 */

import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { acquireLock, releaseLock } from '../lib/redis.js';
import { addDays, todayIn, normalizeTimezone } from '../lib/time.js';
import { env } from '../config.js';

/** A session is a bounce if it had one pageview, no interaction and < 10s. */
const BOUNCE_MAX_SEC = 10;
/** Gap after which we stop attributing time to the previous pageview. */
const MAX_TIME_ON_PAGE_SEC = 1800;
/** LCP above this marks the session as slow. */
const SLOW_LCP_MS = 2500;

interface ProjectRow {
  id: string;
  timezone: string;
  retention_days: number;
}

interface GoalRow {
  id: string;
  kind: 'pageview' | 'event';
  match_value: string;
  match_type: 'exact' | 'contains' | 'starts_with' | 'regex';
  value: number;
}

// ─────────────────────────────────────────────────────────────
// Per-day rebuild
// ─────────────────────────────────────────────────────────────

/**
 * Rebuild every derived table for one project-day.
 * `day` is YYYY-MM-DD in the project's timezone.
 */
export async function rebuildDay(project: ProjectRow, day: string): Promise<void> {
  const tz = normalizeTimezone(project.timezone);
  const pid = project.id;
  const nextDay = addDays(day, 1);

  // Day boundaries as absolute instants, computed by Postgres in the project zone
  // so DST transitions are handled by the database's own tz database.
  const d0 = sql`(${day}::date::timestamp AT TIME ZONE ${tz})`;
  const d1 = sql`(${nextDay}::date::timestamp AT TIME ZONE ${tz})`;
  // Sessions may run past midnight; include a tail so their final events count.
  const tail = sql`(${nextDay}::date::timestamp AT TIME ZONE ${tz}) + interval '4 hours'`;

  const goals = (await db.execute(sql`
    SELECT id::text, kind, match_value, match_type, value FROM goals WHERE project_id = ${pid}
  `)) as unknown as GoalRow[];

  await db.transaction(async (tx) => {
    // 1. Visitor profiles first — sessions need the global first-seen instant to
    //    decide new vs. returning.
    await tx.execute(sql`
      INSERT INTO visitor_profiles (project_id, visitor_id, first_seen_at, last_seen_at, session_count, pageview_count, user_id)
      SELECT ${pid}, visitor_id, MIN(timestamp), MAX(timestamp),
             COUNT(DISTINCT session_id),
             COUNT(*) FILTER (WHERE type = 'pageview'),
             MAX(user_id)
      FROM events
      WHERE project_id = ${pid} AND timestamp >= ${d0} AND timestamp < ${d1}
      GROUP BY visitor_id
      ON CONFLICT (project_id, visitor_id) DO UPDATE SET
        first_seen_at = LEAST(visitor_profiles.first_seen_at, EXCLUDED.first_seen_at),
        last_seen_at  = GREATEST(visitor_profiles.last_seen_at, EXCLUDED.last_seen_at),
        user_id = COALESCE(EXCLUDED.user_id, visitor_profiles.user_id)
    `);

    // 2. Sessions for this day. A session belongs to the day its first event fell in.
    await tx.execute(sql`DELETE FROM sessions WHERE project_id = ${pid}
                          AND started_at >= ${d0} AND started_at < ${d1}`);

    await tx.execute(sql`
      WITH day_sessions AS (
        SELECT session_id
        FROM events
        WHERE project_id = ${pid} AND timestamp >= ${d0} AND timestamp < ${d1}
        GROUP BY session_id
        HAVING MIN(timestamp) >= ${d0} AND MIN(timestamp) < ${d1}
      ),
      ev AS (
        SELECT e.*
        FROM events e
        JOIN day_sessions ds ON ds.session_id = e.session_id
        WHERE e.project_id = ${pid} AND e.timestamp >= ${d0} AND e.timestamp < ${tail}
      ),
      agg AS (
        SELECT
          session_id,
          MIN(visitor_id) AS visitor_id,
          MAX(user_id) AS user_id,
          MIN(timestamp) AS started_at,
          MAX(timestamp) AS ended_at,
          COUNT(*) FILTER (WHERE type = 'pageview') AS pageview_count,
          COUNT(*) AS event_count,
          (ARRAY_AGG(path ORDER BY timestamp, id) FILTER (WHERE type = 'pageview'))[1] AS entry_path,
          (ARRAY_AGG(path ORDER BY timestamp DESC, id DESC) FILTER (WHERE type = 'pageview'))[1] AS exit_path,
          (ARRAY_AGG(referrer_host ORDER BY timestamp, id) FILTER (WHERE type = 'pageview'))[1] AS referrer_host,
          (ARRAY_AGG(source ORDER BY timestamp, id) FILTER (WHERE type = 'pageview'))[1] AS source,
          (ARRAY_AGG(channel ORDER BY timestamp, id) FILTER (WHERE type = 'pageview'))[1] AS channel,
          (ARRAY_AGG(utm_source ORDER BY timestamp, id) FILTER (WHERE utm_source IS NOT NULL))[1] AS utm_source,
          (ARRAY_AGG(utm_medium ORDER BY timestamp, id) FILTER (WHERE utm_medium IS NOT NULL))[1] AS utm_medium,
          (ARRAY_AGG(utm_campaign ORDER BY timestamp, id) FILTER (WHERE utm_campaign IS NOT NULL))[1] AS utm_campaign,
          (ARRAY_AGG(country ORDER BY timestamp, id) FILTER (WHERE country IS NOT NULL))[1] AS country,
          (ARRAY_AGG(device ORDER BY timestamp, id))[1] AS device,
          (ARRAY_AGG(browser ORDER BY timestamp, id))[1] AS browser,
          (ARRAY_AGG(os ORDER BY timestamp, id))[1] AS os,
          COALESCE(MAX((payload->>'scroll_depth')::numeric), 0) AS max_scroll,
          COUNT(*) FILTER (WHERE type = 'rage_click') AS rage_clicks,
          COUNT(*) FILTER (WHERE type = 'dead_click') AS dead_clicks,
          COUNT(*) FILTER (WHERE type = 'js_error') AS error_count,
          COUNT(*) FILTER (WHERE type = 'quick_back') AS quick_backs,
          COUNT(*) FILTER (WHERE type = 'form_abandon') AS form_abandons,
          COUNT(*) FILTER (WHERE type IN ('click','rage_click','dead_click','form_start','form_submit','scroll','custom')) AS interactions,
          MAX((payload->>'lcp')::numeric) FILTER (WHERE type = 'performance') AS worst_lcp,
          COALESCE(MAX((payload->>'duration')::numeric) FILTER (WHERE type = 'session_end'), 0) AS reported_duration
        FROM ev
        GROUP BY session_id
      )
      INSERT INTO sessions (
        project_id, session_id, visitor_id, user_id, started_at, ended_at, duration_sec,
        pageview_count, event_count, entry_path, exit_path, is_bounce, is_engaged, is_new_visitor,
        referrer_host, source, channel, utm_source, utm_medium, utm_campaign,
        country, device, browser, os, max_scroll_depth,
        rage_clicks, dead_clicks, error_count, quick_backs, form_abandons, worst_lcp_ms, was_slow
      )
      SELECT
        ${pid}, a.session_id, a.visitor_id, a.user_id, a.started_at, a.ended_at,
        GREATEST(
          FLOOR(EXTRACT(EPOCH FROM (a.ended_at - a.started_at)))::int,
          LEAST(a.reported_duration, 86400)::int
        ) AS duration_sec,
        a.pageview_count, a.event_count, a.entry_path, a.exit_path,
        (a.pageview_count <= 1 AND a.interactions = 0
          AND EXTRACT(EPOCH FROM (a.ended_at - a.started_at)) < ${BOUNCE_MAX_SEC}) AS is_bounce,
        (a.pageview_count > 1 OR a.interactions > 0
          OR EXTRACT(EPOCH FROM (a.ended_at - a.started_at)) >= ${BOUNCE_MAX_SEC}) AS is_engaged,
        (vp.first_seen_at >= a.started_at) AS is_new_visitor,
        a.referrer_host, a.source, a.channel, a.utm_source, a.utm_medium, a.utm_campaign,
        a.country, a.device, a.browser, a.os,
        LEAST(GREATEST(a.max_scroll, 0), 100)::int,
        a.rage_clicks, a.dead_clicks, a.error_count, a.quick_backs, a.form_abandons,
        a.worst_lcp::int,
        (a.worst_lcp IS NOT NULL AND a.worst_lcp > ${SLOW_LCP_MS}) AS was_slow
      FROM agg a
      LEFT JOIN visitor_profiles vp
        ON vp.project_id = ${pid} AND vp.visitor_id = a.visitor_id
      ON CONFLICT (project_id, session_id) DO NOTHING
    `);

    // 3. Goal attribution. Each goal's predicate is parameterised — user patterns
    //    never reach the query as raw SQL text.
    if (goals.length) {
      for (const goal of goals) {
        const predicate = goalPredicate(goal);
        await tx.execute(sql`
          WITH hits AS (
            SELECT DISTINCT e.session_id
            FROM events e
            WHERE e.project_id = ${pid}
              AND e.timestamp >= ${d0} AND e.timestamp < ${tail}
              AND ${predicate}
          )
          UPDATE sessions s
             SET converted = TRUE,
                 conversion_value = s.conversion_value + ${goal.value},
                 goals_hit = CASE WHEN s.goals_hit ? ${goal.id}
                                  THEN s.goals_hit
                                  ELSE s.goals_hit || to_jsonb(${goal.id}::text) END
            FROM hits
           WHERE s.project_id = ${pid}
             AND s.session_id = hits.session_id
             AND s.started_at >= ${d0} AND s.started_at < ${d1}
             AND NOT (s.goals_hit ? ${goal.id})
        `);
      }
    }

    // 4. Daily visitor index — makes distinct counts over any range cheap.
    await tx.execute(sql`DELETE FROM daily_visitors WHERE project_id = ${pid} AND day = ${day}`);
    await tx.execute(sql`
      INSERT INTO daily_visitors (project_id, day, visitor_id, is_new)
      SELECT ${pid}, ${day}::date, visitor_id, BOOL_OR(is_new_visitor)
      FROM sessions
      WHERE project_id = ${pid} AND started_at >= ${d0} AND started_at < ${d1}
      GROUP BY visitor_id
      ON CONFLICT (project_id, day, visitor_id) DO UPDATE SET is_new = EXCLUDED.is_new
    `);

    // 5. Headline daily stats.
    await tx.execute(sql`
      INSERT INTO daily_stats (
        project_id, day, pageviews, visitors, new_visitors, sessions, bounces,
        engaged_sessions, total_duration_sec, conversions, conversion_value,
        rage_clicks, dead_clicks, errors
      )
      SELECT ${pid}, ${day}::date,
        COALESCE(SUM(pageview_count), 0),
        COUNT(DISTINCT visitor_id),
        COUNT(DISTINCT visitor_id) FILTER (WHERE is_new_visitor),
        COUNT(*),
        COUNT(*) FILTER (WHERE is_bounce),
        COUNT(*) FILTER (WHERE is_engaged),
        COALESCE(SUM(duration_sec), 0),
        COUNT(*) FILTER (WHERE converted),
        COALESCE(SUM(conversion_value), 0),
        COALESCE(SUM(rage_clicks), 0),
        COALESCE(SUM(dead_clicks), 0),
        COALESCE(SUM(error_count), 0)
      FROM sessions
      WHERE project_id = ${pid} AND started_at >= ${d0} AND started_at < ${d1}
      ON CONFLICT (project_id, day) DO UPDATE SET
        pageviews = EXCLUDED.pageviews, visitors = EXCLUDED.visitors,
        new_visitors = EXCLUDED.new_visitors, sessions = EXCLUDED.sessions,
        bounces = EXCLUDED.bounces, engaged_sessions = EXCLUDED.engaged_sessions,
        total_duration_sec = EXCLUDED.total_duration_sec,
        conversions = EXCLUDED.conversions, conversion_value = EXCLUDED.conversion_value,
        rage_clicks = EXCLUDED.rage_clicks, dead_clicks = EXCLUDED.dead_clicks,
        errors = EXCLUDED.errors
    `);

    // 6. Per-page rollup, including time-on-page and entry/exit/bounce counts.
    await tx.execute(sql`DELETE FROM daily_pages WHERE project_id = ${pid} AND day = ${day}`);
    await tx.execute(sql`
      WITH pv AS (
        SELECT e.session_id, e.visitor_id, e.path, e.timestamp,
               LEAD(e.timestamp) OVER (PARTITION BY e.session_id ORDER BY e.timestamp, e.id) AS next_ts
        FROM events e
        JOIN sessions s ON s.project_id = ${pid} AND s.session_id = e.session_id
        WHERE e.project_id = ${pid}
          AND e.type = 'pageview' AND e.path IS NOT NULL
          AND s.started_at >= ${d0} AND s.started_at < ${d1}
          AND e.timestamp >= ${d0} AND e.timestamp < ${tail}
      ),
      timed AS (
        SELECT path, session_id, visitor_id,
               CASE WHEN next_ts IS NULL THEN NULL
                    ELSE LEAST(EXTRACT(EPOCH FROM (next_ts - timestamp)), ${MAX_TIME_ON_PAGE_SEC})
               END AS seconds
        FROM pv
      ),
      page_agg AS (
        SELECT path,
               COUNT(*) AS views,
               COUNT(DISTINCT visitor_id) AS visitors,
               COALESCE(SUM(seconds) FILTER (WHERE seconds IS NOT NULL), 0) AS total_time,
               COUNT(*) FILTER (WHERE seconds IS NOT NULL) AS time_samples
        FROM timed GROUP BY path
      ),
      entry_agg AS (
        SELECT entry_path AS path,
               COUNT(*) AS entrances,
               COUNT(*) FILTER (WHERE is_bounce) AS bounces,
               COALESCE(SUM(max_scroll_depth), 0) AS scroll_sum,
               COUNT(*) AS scroll_samples
        FROM sessions
        WHERE project_id = ${pid} AND started_at >= ${d0} AND started_at < ${d1} AND entry_path IS NOT NULL
        GROUP BY entry_path
      ),
      exit_agg AS (
        SELECT exit_path AS path, COUNT(*) AS exits
        FROM sessions
        WHERE project_id = ${pid} AND started_at >= ${d0} AND started_at < ${d1} AND exit_path IS NOT NULL
        GROUP BY exit_path
      )
      INSERT INTO daily_pages (
        project_id, day, path, views, visitors, entrances, exits, bounces,
        total_time_sec, time_samples, scroll_sum, scroll_samples
      )
      SELECT ${pid}, ${day}::date,
             COALESCE(p.path, en.path, ex.path),
             COALESCE(p.views, 0), COALESCE(p.visitors, 0),
             COALESCE(en.entrances, 0), COALESCE(ex.exits, 0), COALESCE(en.bounces, 0),
             COALESCE(p.total_time, 0)::bigint, COALESCE(p.time_samples, 0),
             COALESCE(en.scroll_sum, 0), COALESCE(en.scroll_samples, 0)
      FROM page_agg p
      FULL OUTER JOIN entry_agg en ON en.path = p.path
      FULL OUTER JOIN exit_agg ex ON ex.path = COALESCE(p.path, en.path)
      WHERE COALESCE(p.path, en.path, ex.path) IS NOT NULL
      ON CONFLICT (project_id, day, path) DO UPDATE SET
        views = EXCLUDED.views, visitors = EXCLUDED.visitors,
        entrances = EXCLUDED.entrances, exits = EXCLUDED.exits, bounces = EXCLUDED.bounces,
        total_time_sec = EXCLUDED.total_time_sec, time_samples = EXCLUDED.time_samples,
        scroll_sum = EXCLUDED.scroll_sum, scroll_samples = EXCLUDED.scroll_samples
    `);

    // 7. Flow graph edges. `(exit)` is a synthetic terminal node so the Sankey
    //    shows exactly where people leave, not just where they go.
    await tx.execute(sql`DELETE FROM page_transitions WHERE project_id = ${pid} AND day = ${day}`);
    await tx.execute(sql`
      WITH pv AS (
        SELECT e.session_id, e.path, e.timestamp,
               ROW_NUMBER() OVER (PARTITION BY e.session_id ORDER BY e.timestamp, e.id) AS step,
               LEAD(e.path) OVER (PARTITION BY e.session_id ORDER BY e.timestamp, e.id) AS next_path
        FROM events e
        JOIN sessions s ON s.project_id = ${pid} AND s.session_id = e.session_id
        WHERE e.project_id = ${pid}
          AND e.type = 'pageview' AND e.path IS NOT NULL
          AND s.started_at >= ${d0} AND s.started_at < ${d1}
          AND e.timestamp >= ${d0} AND e.timestamp < ${tail}
      )
      INSERT INTO page_transitions (project_id, day, step_index, from_path, to_path, count)
      SELECT ${pid}, ${day}::date, step::int, path, COALESCE(next_path, '(exit)'), COUNT(*)
      FROM pv
      WHERE step <= 10
      GROUP BY step, path, COALESCE(next_path, '(exit)')
      ON CONFLICT (project_id, day, step_index, from_path, to_path)
        DO UPDATE SET count = EXCLUDED.count
    `);

    // 8. Mark the day built. Only past days seal.
    const today = todayIn(tz);
    await tx.execute(sql`
      INSERT INTO rollup_state (project_id, day, built_at, sealed)
      VALUES (${pid}, ${day}::date, NOW(), ${day < today})
      ON CONFLICT (project_id, day) DO UPDATE SET built_at = NOW(), sealed = EXCLUDED.sealed
    `);
  });
}

function goalPredicate(goal: GoalRow) {
  if (goal.kind === 'event') {
    return sql`(e.type = 'custom' AND e.name = ${goal.match_value})`;
  }
  const v = goal.match_value;
  switch (goal.match_type) {
    case 'contains':
      return sql`(e.type = 'pageview' AND POSITION(${v} IN COALESCE(e.path, '')) > 0)`;
    case 'starts_with':
      return sql`(e.type = 'pageview' AND LEFT(COALESCE(e.path, ''), LENGTH(${v})) = ${v})`;
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

// ─────────────────────────────────────────────────────────────
// Scheduling
// ─────────────────────────────────────────────────────────────

/**
 * Unseal a project's days so the next rollup pass recomputes them.
 * Used when a definition that affects history changes — a new goal changes past
 * conversions, so the old numbers are no longer correct.
 */
export async function requestRebuild(projectId: string, sinceDay?: string): Promise<void> {
  if (sinceDay) {
    await db.execute(sql`UPDATE rollup_state SET sealed = FALSE
                          WHERE project_id = ${projectId} AND day >= ${sinceDay}::date`);
  } else {
    await db.execute(sql`UPDATE rollup_state SET sealed = FALSE WHERE project_id = ${projectId}`);
  }
}

/** Days that have raw events but no sealed rollup, oldest first. */
async function pendingDays(project: ProjectRow, limit: number): Promise<string[]> {
  const tz = normalizeTimezone(project.timezone);
  const rows = (await db.execute(sql`
    SELECT DISTINCT (e.timestamp AT TIME ZONE ${tz})::date::text AS day
    FROM events e
    LEFT JOIN rollup_state rs ON rs.project_id = e.project_id
      AND rs.day = (e.timestamp AT TIME ZONE ${tz})::date
    WHERE e.project_id = ${project.id} AND (rs.sealed IS NULL OR rs.sealed = FALSE)
    ORDER BY day ASC
    LIMIT ${limit}
  `)) as unknown as Array<{ day: string }>;

  const days = rows.map((r) => r.day);
  const today = todayIn(tz);
  if (!days.includes(today)) days.push(today);
  return days;
}

/** Enforce per-project retention by deleting events past the window. */
async function applyRetention(project: ProjectRow): Promise<void> {
  if (!project.retention_days || project.retention_days <= 0) return;
  const cutoff = addDays(todayIn(normalizeTimezone(project.timezone)), -project.retention_days);
  await db.execute(sql`DELETE FROM events WHERE project_id = ${project.id} AND timestamp < ${cutoff}::date`);
  await db.execute(sql`DELETE FROM sessions WHERE project_id = ${project.id} AND started_at < ${cutoff}::date`);
  await db.execute(sql`DELETE FROM daily_visitors WHERE project_id = ${project.id} AND day < ${cutoff}::date`);
  await db.execute(sql`DELETE FROM daily_stats WHERE project_id = ${project.id} AND day < ${cutoff}::date`);
  await db.execute(sql`DELETE FROM daily_pages WHERE project_id = ${project.id} AND day < ${cutoff}::date`);
  await db.execute(sql`DELETE FROM page_transitions WHERE project_id = ${project.id} AND day < ${cutoff}::date`);
}

/** One full pass over every active project. */
export async function runRollupPass(maxDaysPerProject = 40): Promise<void> {
  const projectRows = (await db.execute(sql`
    SELECT id, timezone, retention_days FROM projects WHERE is_active = TRUE
  `)) as unknown as ProjectRow[];

  for (const project of projectRows) {
    try {
      const days = await pendingDays(project, maxDaysPerProject);
      for (const day of days) await rebuildDay(project, day);
      await applyRetention(project);
    } catch (e) {
      console.error(`[rollup] project ${project.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
}

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

export function startRollupWorker(): void {
  if (timer || !env.RUN_ROLLUP_WORKER) return;

  const pass = async () => {
    if (inFlight) return;
    inFlight = true;
    // Only one instance rolls up at a time; the rest skip this tick.
    const token = await acquireLock('rollup', 900);
    if (!token) {
      inFlight = false;
      return;
    }
    try {
      const started = Date.now();
      await runRollupPass();
      console.log(`[rollup] pass complete in ${Date.now() - started}ms`);
    } catch (e) {
      console.error('[rollup] pass failed:', e instanceof Error ? e.message : e);
    } finally {
      await releaseLock('rollup', token);
      inFlight = false;
    }
  };

  // Give ingest a moment to drain before the first pass.
  setTimeout(() => void pass(), 10_000);
  timer = setInterval(() => void pass(), env.ROLLUP_HOT_INTERVAL_MS);
  console.log('[rollup] worker scheduled');
}

export function stopRollupWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
