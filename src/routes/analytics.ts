import { Hono } from 'hono';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { requireProject } from '../middleware/project.js';
import { resolveRange, type ResolvedRange } from '../lib/time.js';
import { parseFilters, filterFingerprint, type Filters } from '../lib/filters.js';
import { cacheKey, cached } from '../lib/cache.js';
import { liveCount, livePages } from '../lib/redis.js';
import {
  summaryWithComparison, timeseries, pages, breakdown, customEvents,
  performance, BREAKDOWN_DIMENSIONS,
} from '../lib/reports.js';
import {
  exitPages, flow, exitReasons, segmentLift, retention,
  frustrationByPage, formAbandonment,
} from '../lib/insights.js';
import type { AppEnv, Project } from '../lib/types.js';

const analytics = new Hono<AppEnv>();
analytics.use('*', authMiddleware);
analytics.use('/:projectId/*', requireProject('viewer'));

/** Parse range + filters once per request and derive a cache key from both. */
function context(c: { req: { query(k: string): string | undefined } }, project: Project) {
  const q = c.req.query.bind(c.req);
  const range = resolveRange(
    { preset: q('preset'), from: q('from'), to: q('to'), granularity: q('granularity'), compare: q('compare') },
    project.timezone,
  );
  const filters = parseFilters(q);
  const keyFor = (report: string, extra: Record<string, unknown> = {}) =>
    cacheKey(project.id, report, {
      from: range.fromDate,
      to: range.toDate,
      tz: range.tz,
      granularity: range.granularity,
      compare: range.compare?.mode ?? 'none',
      ...filterFingerprint(filters),
      ...extra,
    });
  return { range, filters, keyFor };
}

/** Every response echoes the resolved range so the UI can render exactly what was queried. */
function meta(range: ResolvedRange, filters: Filters) {
  return {
    range: {
      from: range.fromDate,
      to: range.toDate,
      preset: range.preset,
      granularity: range.granularity,
      timezone: range.tz,
      days: range.days,
      compare: range.compare
        ? { from: range.compare.fromDate, to: range.compare.toDate, mode: range.compare.mode }
        : null,
    },
    filters: filterFingerprint(filters),
  };
}

// ─────────────────────────────────────────────────────────────
// Core reports
// ─────────────────────────────────────────────────────────────

analytics.get('/:projectId/overview', async (c) => {
  const project = c.get('project');
  const { range, filters, keyFor } = context(c, project);

  const data = await cached(keyFor('overview'), range.isOpen, async () => {
    const [stats, series] = await Promise.all([
      summaryWithComparison(project.id, range, filters),
      timeseries(project.id, range, filters),
    ]);
    return { stats, series };
  });

  return c.json({ ...meta(range, filters), ...data, liveVisitors: await liveCount(project.id) });
});

analytics.get('/:projectId/timeseries', async (c) => {
  const project = c.get('project');
  const { range, filters, keyFor } = context(c, project);
  const series = await cached(keyFor('timeseries'), range.isOpen, () =>
    timeseries(project.id, range, filters));
  return c.json({ ...meta(range, filters), series });
});

analytics.get('/:projectId/pages', async (c) => {
  const project = c.get('project');
  const { range, filters, keyFor } = context(c, project);
  const limit = Math.min(Number(c.req.query('limit')) || 100, 500);
  const data = await cached(keyFor('pages', { limit }), range.isOpen, () =>
    pages(project.id, range, filters, limit));
  return c.json({ ...meta(range, filters), data });
});

analytics.get('/:projectId/breakdown/:dimension', async (c) => {
  const project = c.get('project');
  const dimension = c.req.param('dimension');
  if (!BREAKDOWN_DIMENSIONS.includes(dimension)) {
    return c.json({ error: `Unknown dimension. Supported: ${BREAKDOWN_DIMENSIONS.join(', ')}` }, 400);
  }
  const { range, filters, keyFor } = context(c, project);
  const limit = Math.min(Number(c.req.query('limit')) || 50, 250);
  const data = await cached(keyFor(`breakdown:${dimension}`, { limit }), range.isOpen, () =>
    breakdown(project.id, range, filters, dimension, limit));
  return c.json({ ...meta(range, filters), dimension, data });
});

/** Sources, devices and geography in one round trip — the tabs that always load together. */
analytics.get('/:projectId/audience', async (c) => {
  const project = c.get('project');
  const { range, filters, keyFor } = context(c, project);

  const data = await cached(keyFor('audience'), range.isOpen, async () => {
    const [channels, sources, referrers, devices, browsers, operatingSystems, countries] = await Promise.all([
      breakdown(project.id, range, filters, 'channel', 12),
      breakdown(project.id, range, filters, 'source', 25),
      breakdown(project.id, range, filters, 'referrer', 25),
      breakdown(project.id, range, filters, 'device', 5),
      breakdown(project.id, range, filters, 'browser', 12),
      breakdown(project.id, range, filters, 'os', 12),
      breakdown(project.id, range, filters, 'country', 30),
    ]);
    return { channels, sources, referrers, devices, browsers, operatingSystems, countries };
  });

  return c.json({ ...meta(range, filters), ...data });
});

analytics.get('/:projectId/campaigns', async (c) => {
  const project = c.get('project');
  const { range, filters, keyFor } = context(c, project);
  const data = await cached(keyFor('campaigns'), range.isOpen, async () => {
    const [sources, mediums, campaigns] = await Promise.all([
      breakdown(project.id, range, filters, 'utm_source', 25),
      breakdown(project.id, range, filters, 'utm_medium', 25),
      breakdown(project.id, range, filters, 'utm_campaign', 25),
    ]);
    return { sources, mediums, campaigns };
  });
  return c.json({ ...meta(range, filters), ...data });
});

analytics.get('/:projectId/events', async (c) => {
  const project = c.get('project');
  const { range, filters, keyFor } = context(c, project);
  const data = await cached(keyFor('events'), range.isOpen, () =>
    customEvents(project.id, range, filters));
  return c.json({ ...meta(range, filters), data });
});

analytics.get('/:projectId/performance', async (c) => {
  const project = c.get('project');
  const { range, filters, keyFor } = context(c, project);
  const data = await cached(keyFor('performance'), range.isOpen, () =>
    performance(project.id, range, filters));
  return c.json({ ...meta(range, filters), ...data });
});

// ─────────────────────────────────────────────────────────────
// Behaviour / drop-off
// ─────────────────────────────────────────────────────────────

analytics.get('/:projectId/exits', async (c) => {
  const project = c.get('project');
  const { range, filters, keyFor } = context(c, project);
  const limit = Math.min(Number(c.req.query('limit')) || 25, 100);
  const data = await cached(keyFor('exits', { limit }), range.isOpen, () =>
    exitPages(project.id, range, filters, limit));
  return c.json({ ...meta(range, filters), data });
});

analytics.get('/:projectId/flow', async (c) => {
  const project = c.get('project');
  const { range, filters, keyFor } = context(c, project);
  const startPath = c.req.query('startPath') || undefined;
  const depth = Math.min(Math.max(Number(c.req.query('depth')) || 4, 2), 8);
  const direction = c.req.query('direction') === 'reverse' ? 'reverse' : 'forward';
  const minCount = Math.max(Number(c.req.query('minCount')) || 1, 1);

  const data = await cached(keyFor('flow', { startPath, depth, direction, minCount }), range.isOpen, () =>
    flow(project.id, range, filters, { startPath, depth, direction, minCount }));

  return c.json({ ...meta(range, filters), startPath: startPath ?? null, direction, depth, ...data });
});

analytics.get('/:projectId/exit-reasons', async (c) => {
  const project = c.get('project');
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'path query parameter is required' }, 400);

  const { range, filters, keyFor } = context(c, project);
  const data = await cached(keyFor('exit-reasons', { path }), range.isOpen, async () => {
    const [report, lift] = await Promise.all([
      exitReasons(project.id, range, filters, path),
      segmentLift(project.id, range, filters, { exitPath: path }),
    ]);
    return { ...report, segmentLift: lift };
  });

  return c.json({ ...meta(range, filters), ...data });
});

analytics.get('/:projectId/frustration', async (c) => {
  const project = c.get('project');
  const { range, filters, keyFor } = context(c, project);
  const data = await cached(keyFor('frustration'), range.isOpen, async () => {
    const [byPage, forms] = await Promise.all([
      frustrationByPage(project.id, range, filters),
      formAbandonment(project.id, range),
    ]);
    return { byPage, forms };
  });
  return c.json({ ...meta(range, filters), ...data });
});

analytics.get('/:projectId/retention', async (c) => {
  const project = c.get('project');
  const { range, filters, keyFor } = context(c, project);
  const period = c.req.query('period') === 'day' ? 'day' : 'week';
  const data = await cached(keyFor('retention', { period }), range.isOpen, () =>
    retention(project.id, range, project.identityMode, period));
  return c.json({ ...meta(range, filters), ...data });
});

/** Why a cohort fails to convert, without picking a specific exit page first. */
analytics.get('/:projectId/lift', async (c) => {
  const project = c.get('project');
  const { range, filters, keyFor } = context(c, project);
  const exitPath = c.req.query('exitPath') || undefined;
  const data = await cached(keyFor('lift', { exitPath }), range.isOpen, () =>
    segmentLift(project.id, range, filters, exitPath ? { exitPath } : { notConverted: true }));
  return c.json({ ...meta(range, filters), target: exitPath ?? 'non-converting sessions', data });
});

// ─────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────

analytics.get('/:projectId/errors', async (c) => {
  const project = c.get('project');
  const { range, filters, keyFor } = context(c, project);
  const includeResolved = c.req.query('includeResolved') === 'true';

  const data = await cached(keyFor('errors', { includeResolved }), range.isOpen, async () => {
    const rows = (await db.execute(sql`
      SELECT fingerprint, message, source, line, "column", stack, sample_path,
             count, affected_sessions, first_seen_at, last_seen_at, resolved
      FROM error_groups
      WHERE project_id = ${project.id}
        AND last_seen_at >= ${range.from} AND last_seen_at < ${range.to}
        ${includeResolved ? sql`` : sql`AND resolved = FALSE`}
      ORDER BY count DESC
      LIMIT 100
    `)) as unknown as Array<Record<string, unknown>>;

    const [totals] = (await db.execute(sql`
      SELECT COALESCE(SUM(count), 0) AS total, COUNT(*) AS groups
      FROM error_groups
      WHERE project_id = ${project.id}
        AND last_seen_at >= ${range.from} AND last_seen_at < ${range.to}
    `)) as unknown as Array<Record<string, unknown>>;

    return {
      total: Number(totals?.total ?? 0),
      groups: Number(totals?.groups ?? 0),
      errors: rows.map((r) => ({
        fingerprint: r.fingerprint,
        message: r.message,
        source: r.source,
        line: r.line,
        column: r.column,
        stack: r.stack,
        samplePath: r.sample_path,
        count: Number(r.count ?? 0),
        affectedSessions: Number(r.affected_sessions ?? 0),
        firstSeenAt: r.first_seen_at,
        lastSeenAt: r.last_seen_at,
        resolved: r.resolved,
      })),
    };
  });

  return c.json({ ...meta(range, filters), ...data });
});

analytics.post('/:projectId/errors/:fingerprint/resolve', requireProject('member'), async (c) => {
  const project = c.get('project');
  const resolved = c.req.query('resolved') !== 'false';
  await db.execute(sql`
    UPDATE error_groups SET resolved = ${resolved}
    WHERE project_id = ${project.id} AND fingerprint = ${c.req.param('fingerprint')}
  `);
  return c.json({ ok: true, resolved });
});

// ─────────────────────────────────────────────────────────────
// Realtime
// ─────────────────────────────────────────────────────────────

analytics.get('/:projectId/live', async (c) => {
  const project = c.get('project');
  const [visitors, pathRows] = await Promise.all([liveCount(project.id), livePages(project.id)]);

  // Last 30 minutes of pageviews, minute by minute.
  const minutes = (await db.execute(sql`
    SELECT date_trunc('minute', timestamp) AS bucket, COUNT(*) AS pageviews
    FROM events
    WHERE project_id = ${project.id} AND type = 'pageview'
      AND timestamp >= NOW() - interval '30 minutes'
    GROUP BY 1 ORDER BY 1
  `)) as unknown as Array<Record<string, unknown>>;

  return c.json({
    liveVisitors: visitors,
    pages: pathRows,
    lastThirtyMinutes: minutes.map((m) => ({
      bucket: m.bucket,
      pageviews: Number(m.pageviews ?? 0),
    })),
  });
});

// ─────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────

/** Serialise rows to RFC-4180 CSV. */
function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  // Quote when the value contains a comma, a quote, or a line break.
  const needsQuoting = (s: string): boolean => {
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code === 34 || code === 44 || code === 10 || code === 13) return true;
    }
    return false;
  };
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return needsQuoting(s) ? `"${s.split('"').join('""')}"` : s;
  };
  const CRLF = String.fromCharCode(13, 10);
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => escape(row[h])).join(','));
  return lines.join(CRLF);
}

const EXPORTABLE = ['pages', 'exits', 'events', 'timeseries', 'source', 'channel', 'referrer',
  'country', 'device', 'browser', 'os', 'utm_source', 'utm_medium', 'utm_campaign',
  'entry_page', 'exit_page'] as const;

analytics.get('/:projectId/export', async (c) => {
  const project = c.get('project');
  const report = c.req.query('report') || 'pages';
  const format = c.req.query('format') === 'json' ? 'json' : 'csv';

  if (!EXPORTABLE.includes(report as (typeof EXPORTABLE)[number])) {
    return c.json({ error: `Unknown report. Supported: ${EXPORTABLE.join(', ')}` }, 400);
  }

  const { range, filters } = context(c, project);
  let rows: Array<Record<string, unknown>>;

  if (report === 'pages') rows = await pages(project.id, range, filters, 5000) as unknown as Array<Record<string, unknown>>;
  else if (report === 'exits') rows = await exitPages(project.id, range, filters, 5000) as unknown as Array<Record<string, unknown>>;
  else if (report === 'events') rows = await customEvents(project.id, range, filters, 5000) as unknown as Array<Record<string, unknown>>;
  else if (report === 'timeseries') rows = await timeseries(project.id, range, filters) as unknown as Array<Record<string, unknown>>;
  else rows = await breakdown(project.id, range, filters, report, 5000) as unknown as Array<Record<string, unknown>>;

  const filename = `${project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${report}-${range.fromDate}-to-${range.toDate}`;

  if (format === 'json') {
    return c.json({ ...meta(range, filters), report, rows });
  }

  return new Response(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
    },
  });
});

export default analytics;
