import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { db } from '../db/index.js';
import { sql, eq, and } from 'drizzle-orm';
import { resolveApiKey } from '../lib/api-keys.js';
import { rateLimit } from '../lib/redis.js';
import { resolveRange } from '../lib/time.js';
import { parseFilters } from '../lib/filters.js';
import {
  summaryWithComparison, timeseries, pages, breakdown, customEvents,
  performance, BREAKDOWN_DIMENSIONS,
} from '../lib/reports.js';
import { exitPages, exitReasons, flow, segmentLift, frustrationByPage, formAbandonment, retention } from '../lib/insights.js';
import { buildDigest } from '../lib/digest.js';
import { computeFunnel } from '../lib/funnel-engine.js';
import { funnels, goals, alerts } from '../db/schema.js';
import type { Project } from '../lib/types.js';

/**
 * Public read-only API, authenticated with a project API key.
 *
 * Exists so a customer can wire their own tooling — or an AI agent over MCP —
 * directly at their analytics, instead of opening the dashboard to answer
 * "is anything broken?". Strictly read-only: a key can never write, mutate
 * settings, or reach another project.
 */
type V1Env = { Variables: { project: Project; keyId: string } };

const v1 = new Hono<V1Env>();

v1.use('*', async (c: Context<V1Env>, next: Next) => {
  const header = c.req.header('authorization') || '';
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : c.req.query('api_key') || '';

  if (!key) {
    return c.json({ error: 'Missing API key. Send it as: Authorization: Bearer pk_…' }, 401);
  }

  const resolved = await resolveApiKey(key);
  if (!resolved) return c.json({ error: 'Invalid or revoked API key.' }, 401);

  // 600 reads/minute per key is generous for an agent and still bounds abuse.
  const allowed = await rateLimit(`v1:${resolved.keyId}`, 600, 60).catch(() => true);
  if (!allowed) return c.json({ error: 'Rate limit exceeded (600 requests/minute).' }, 429);

  c.set('project', resolved.project);
  c.set('keyId', resolved.keyId);
  return next();
});

/** Shared range + filter parsing, identical semantics to the dashboard. */
function ctx(c: Context<V1Env>) {
  const project = c.get('project');
  const q = c.req.query.bind(c.req);
  const range = resolveRange(
    { preset: q('preset'), from: q('from'), to: q('to'), granularity: q('granularity'), compare: q('compare') },
    project.timezone,
  );
  return { project, range, filters: parseFilters(q) };
}

function rangeMeta(range: ReturnType<typeof resolveRange>) {
  return {
    from: range.fromDate,
    to: range.toDate,
    preset: range.preset,
    timezone: range.tz,
    granularity: range.granularity,
  };
}

// ─────────────────────────────────────────────────────────────

/** Self-describing root, so an agent can discover the surface without docs. */
v1.get('/', (c) => {
  const project = c.get('project');
  return c.json({
    project: { id: project.id, name: project.name, domain: project.domain, timezone: project.timezone },
    endpoints: {
      '/v1/insights': 'Start here. One call: what is working, what is not, with evidence and a plain-text narrative.',
      '/v1/summary': 'Headline metrics with optional period comparison.',
      '/v1/timeseries': 'Visitors/pageviews/sessions over time.',
      '/v1/pages': 'Per-page views, time, bounce and exit rates.',
      '/v1/exits': 'Where visitors leave, ranked by exit count.',
      '/v1/exit-reasons?path=/x': 'Why they left that page, with segment lift.',
      '/v1/flow': 'Journey graph (nodes + links), optionally anchored to a page.',
      '/v1/breakdown/:dimension': `One of: ${BREAKDOWN_DIMENSIONS.join(', ')}`,
      '/v1/events': 'Custom event counts.',
      '/v1/errors': 'Grouped JavaScript errors.',
      '/v1/performance': 'Core Web Vitals percentiles and slowest pages.',
      '/v1/frustration': 'Rage clicks, dead clicks, errors and form abandonment by page.',
      '/v1/retention': 'Cohort retention matrix.',
      '/v1/funnels': 'Saved funnels, and /v1/funnels/:id for a computed report.',
    },
    parameters: {
      preset: 'today | yesterday | last_7d | last_30d | last_90d | month_to_date | last_month | year_to_date | last_12mo | all_time | custom',
      from: 'YYYY-MM-DD (with preset=custom)',
      to: 'YYYY-MM-DD (with preset=custom)',
      compare: 'previous | year_over_year',
      granularity: 'hour | day | week | month',
      filters: 'path, entryPath, exitPath, source, channel, referrerHost, country, device, browser, os, utmSource, utmMedium, utmCampaign, visitorType, conversion',
    },
    note: 'All dates are calendar days in the project timezone shown above.',
  });
});

/** The headline endpoint: a conclusion, not a table. */
v1.get('/insights', async (c) => {
  const project = c.get('project');
  const q = c.req.query.bind(c.req);
  // Default to a comparison — "what changed" is the usual question.
  const range = resolveRange(
    { preset: q('preset') || 'last_7d', from: q('from'), to: q('to'), compare: q('compare') || 'previous' },
    project.timezone,
  );
  return c.json(await buildDigest(project, range));
});

v1.get('/summary', async (c) => {
  const { project, range, filters } = ctx(c);
  const stats = await summaryWithComparison(project.id, range, filters);
  return c.json({ range: rangeMeta(range), ...stats });
});

v1.get('/timeseries', async (c) => {
  const { project, range, filters } = ctx(c);
  return c.json({ range: rangeMeta(range), series: await timeseries(project.id, range, filters) });
});

v1.get('/pages', async (c) => {
  const { project, range, filters } = ctx(c);
  const limit = Math.min(Number(c.req.query('limit')) || 50, 500);
  return c.json({ range: rangeMeta(range), pages: await pages(project.id, range, filters, limit) });
});

v1.get('/exits', async (c) => {
  const { project, range, filters } = ctx(c);
  const limit = Math.min(Number(c.req.query('limit')) || 25, 100);
  return c.json({ range: rangeMeta(range), exits: await exitPages(project.id, range, filters, limit) });
});

v1.get('/exit-reasons', async (c) => {
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'path query parameter is required' }, 400);
  const { project, range, filters } = ctx(c);
  const [report, lift] = await Promise.all([
    exitReasons(project.id, range, filters, path),
    segmentLift(project.id, range, filters, { exitPath: path }),
  ]);
  return c.json({ range: rangeMeta(range), ...report, segmentLift: lift });
});

v1.get('/flow', async (c) => {
  const { project, range, filters } = ctx(c);
  const startPath = c.req.query('startPath') || undefined;
  const depth = Math.min(Math.max(Number(c.req.query('depth')) || 4, 2), 8);
  const direction = c.req.query('direction') === 'reverse' ? 'reverse' : 'forward';
  const graph = await flow(project.id, range, filters, { startPath, depth, direction, minCount: 2 });
  return c.json({ range: rangeMeta(range), startPath: startPath ?? null, direction, ...graph });
});

v1.get('/breakdown/:dimension', async (c) => {
  const dimension = c.req.param('dimension') ?? '';
  if (!BREAKDOWN_DIMENSIONS.includes(dimension)) {
    return c.json({ error: `Unknown dimension. Supported: ${BREAKDOWN_DIMENSIONS.join(', ')}` }, 400);
  }
  const { project, range, filters } = ctx(c);
  const limit = Math.min(Number(c.req.query('limit')) || 25, 250);
  return c.json({
    range: rangeMeta(range),
    dimension,
    rows: await breakdown(project.id, range, filters, dimension, limit),
  });
});

v1.get('/events', async (c) => {
  const { project, range, filters } = ctx(c);
  return c.json({ range: rangeMeta(range), events: await customEvents(project.id, range, filters) });
});

v1.get('/performance', async (c) => {
  const { project, range, filters } = ctx(c);
  return c.json({ range: rangeMeta(range), ...(await performance(project.id, range, filters)) });
});

v1.get('/frustration', async (c) => {
  const { project, range, filters } = ctx(c);
  const [byPage, forms] = await Promise.all([
    frustrationByPage(project.id, range, filters),
    formAbandonment(project.id, range),
  ]);
  return c.json({ range: rangeMeta(range), byPage, forms });
});

v1.get('/retention', async (c) => {
  const { project, range } = ctx(c);
  const period = c.req.query('period') === 'day' ? 'day' : 'week';
  return c.json({
    range: rangeMeta(range),
    ...(await retention(project.id, range, project.identityMode, period)),
  });
});

v1.get('/errors', async (c) => {
  const { project, range } = ctx(c);
  const rows = (await db.execute(sql`
    SELECT fingerprint, message, source, line, sample_path, count,
           affected_sessions, first_seen_at, last_seen_at, resolved
    FROM error_groups
    WHERE project_id = ${project.id}
      AND last_seen_at >= ${range.fromIso}::timestamptz AND last_seen_at < ${range.toIso}::timestamptz
      AND resolved = FALSE
    ORDER BY affected_sessions DESC, count DESC
    LIMIT 50
  `)) as unknown as Array<Record<string, unknown>>;
  return c.json({ range: rangeMeta(range), errors: rows });
});

v1.get('/funnels', async (c) => {
  const project = c.get('project');
  const rows = await db.query.funnels.findMany({ where: eq(funnels.projectId, project.id) });
  return c.json({
    funnels: rows.map((f) => ({ id: f.id, name: f.name, steps: f.steps, windowHours: f.windowHours })),
  });
});

v1.get('/funnels/:funnelId', async (c) => {
  const { project, range, filters } = ctx(c);
  const funnel = await db.query.funnels.findFirst({
    where: and(eq(funnels.id, c.req.param('funnelId') ?? ''), eq(funnels.projectId, project.id)),
  });
  if (!funnel) return c.json({ error: 'Not found' }, 404);

  try {
    const result = await computeFunnel(project.id, range, filters, funnel, c.req.query('breakdown'));
    return c.json({ range: rangeMeta(range), funnel: { id: funnel.id, name: funnel.name }, ...result });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Funnel computation failed' }, 400);
  }
});

// ─────────────────────────────────────────────────────────────
// Goals / alerts / live — short reads for the AI-agent surface.
// ─────────────────────────────────────────────────────────────

v1.get('/goals', async (c) => {
  const project = c.get('project');
  const rows = await db.query.goals.findMany({ where: eq(goals.projectId, project.id) });
  return c.json({
    goals: rows.map((g) => ({
      id: g.id, name: g.name, kind: g.kind, matchValue: g.matchValue,
      matchType: g.matchType, value: g.value, createdAt: g.createdAt,
    })),
  });
});

v1.get('/alerts', async (c) => {
  const project = c.get('project');
  const rows = await db.query.alerts.findMany({ where: eq(alerts.projectId, project.id) });
  return c.json({
    alerts: rows.map((a) => ({
      id: a.id, name: a.name, kind: a.kind, threshold: a.threshold,
      enabled: a.enabled, lastFiredAt: a.lastFiredAt, createdAt: a.createdAt,
    })),
  });
});

v1.get('/live', async (c) => {
  const project = c.get('project');
  const { liveCount, livePages: pages } = await import('../lib/redis.js');
  const [visitors, pathRows] = await Promise.all([liveCount(project.id), pages(project.id)]);
  return c.json({ liveVisitors: visitors, pages: pathRows, fetchedAt: new Date().toISOString() });
});

/** The "show me everything I might want on the audience tab" composite. */
v1.get('/audience', async (c) => {
  const { project, range, filters } = ctx(c);
  const [channels, sources, referrers, devices, browsers, oses, countries] = await Promise.all([
    breakdown(project.id, range, filters, 'channel', 12),
    breakdown(project.id, range, filters, 'source', 25),
    breakdown(project.id, range, filters, 'referrer', 25),
    breakdown(project.id, range, filters, 'device', 5),
    breakdown(project.id, range, filters, 'browser', 12),
    breakdown(project.id, range, filters, 'os', 12),
    breakdown(project.id, range, filters, 'country', 30),
  ]);
  return c.json({
    range: rangeMeta(range),
    channels, sources, referrers, devices, browsers, operatingSystems: oses, countries,
  });
});

v1.get('/heatmap', async (c) => {
  const project = c.get('project');
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'path query parameter is required' }, 400);
  const q = c.req.query.bind(c.req);
  const range = resolveRange({ preset: q('preset'), from: q('from'), to: q('to') }, project.timezone);
  const sample = Math.min(Number(q('sample')) || 5000, 20_000);

  const rows = (await db.execute(sql`
    SELECT (payload->>'dx')::float AS dx, (payload->>'dy')::float AS dy,
           (payload->>'vw')::float AS vw, (payload->>'vh')::float AS vh
    FROM events
    WHERE project_id = ${project.id} AND type = 'click' AND path = ${path}
      AND timestamp >= ${range.fromIso}::timestamptz AND timestamp < ${range.toIso}::timestamptz
    ORDER BY RANDOM() LIMIT ${sample}
  `)) as unknown as Array<Record<string, unknown>>;

  const points = rows.map((r) => {
    const dx = Number(r.dx ?? 0);
    const dy = Number(r.dy ?? 0);
    const vw = Math.max(Number(r.vw ?? 0), 1);
    const vh = Math.max(Number(r.vh ?? 0), 1);
    return { x: Math.max(0, Math.min(1, dx / vw)), y: Math.max(0, Math.min(1, dy / vh)) };
  }).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  return c.json({ range: rangeMeta(range), path, sample: points.length, points });
});

export default v1;
