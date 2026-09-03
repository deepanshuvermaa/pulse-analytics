import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { projects, dailyStats } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { resolveRange } from '../lib/time.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireProject } from '../middleware/project.js';
import { enqueue } from '../lib/queue.js';
import type { AppEnv } from '../lib/types.js';

const router = new Hono<AppEnv>();

/** Ingest webhook from a payment provider. Authenticated with the project's write key. */
const ingestSchema = z.object({
  event: z.string().min(1).max(120).default('payment_succeeded'),
  userId: z.string().min(1).max(120).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().max(8).optional(),
  properties: z.record(z.unknown()).optional(),
  timestamp: z.string().max(40).optional(),
  path: z.string().max(2048).optional(),
});

router.post('/ingest', async (c) => {
  const authHeader = c.req.header('authorization') || '';
  const writeKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!writeKey) return c.json({ error: 'Missing write key' }, 401);

  const project = await db.query.projects.findFirst({ where: eq(projects.writeKey, writeKey) });
  if (!project || !project.isActive) return c.json({ error: 'Invalid write key' }, 401);

  const parsed = ingestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const body = parsed.data;

  // Enqueue a durable custom event for downstream workers to attribute.
  try {
    await enqueue({
      projectId: project.id,
      type: 'custom',
      name: body.event.slice(0, 120),
      path: body.path ?? null,
      referrerHost: null,
      source: 'Payment',
      channel: 'Payment',
      visitorId: body.userId ?? 'server',
      sessionId: `srv-${Date.now()}`,
      userId: body.userId ?? null,
      country: null,
      region: null,
      city: null,
      device: 'server',
      browser: 'server',
      os: 'server',
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
      payload: { amount: body.amount ?? null, currency: body.currency ?? null, properties: body.properties ?? null },
      timestamp: body.timestamp ?? new Date().toISOString(),
    });
  } catch (e) {
    console.error('[payments] enqueue failed:', e instanceof Error ? e.message : e);
    return c.json({ error: 'Enqueue failed' }, 503);
  }

  return c.json({ ok: true }, 202);
});

// Read endpoints — require normal auth and project access.
router.use('*', authMiddleware);
router.use('/:projectId', requireProject('viewer'));
router.use('/:projectId/*', requireProject('viewer'));

function requiredParam(c: { req: { param(key: string): string | undefined } }, key: string): string {
  return c.req.param(key) ?? '';
}

router.get('/:projectId/overview', async (c) => {
  const project = c.get('project');
  const q = c.req.query.bind(c.req);
  const range = resolveRange({ preset: q('preset'), from: q('from'), to: q('to') }, project.timezone);

  const rows = (await db.execute(sql`
    SELECT COALESCE(SUM(conversion_value), 0)::double precision AS revenue, COALESCE(SUM(conversions),0)::bigint AS conversions
    FROM daily_stats
    WHERE project_id = ${project.id} AND day >= ${range.fromDate}::date AND day <= ${range.toDate}::date
  `)) as unknown as Array<{ revenue: number; conversions: string }> ;

  const revenue = rows?.[0]?.revenue ?? 0;
  const conversions = Number(rows?.[0]?.conversions ?? 0);
  return c.json({ range: { from: range.fromDate, to: range.toDate }, revenue, conversions });
});

router.get('/:projectId/timeseries', async (c) => {
  const project = c.get('project');
  const q = c.req.query.bind(c.req);
  const range = resolveRange({ preset: q('preset'), from: q('from'), to: q('to') }, project.timezone);

  const rows = (await db.execute(sql`
    SELECT day, conversion_value::double precision AS revenue, conversions
    FROM daily_stats
    WHERE project_id = ${project.id} AND day >= ${range.fromDate}::date AND day <= ${range.toDate}::date
    ORDER BY day ASC
  `)) as unknown as Array<{ day: string; revenue: number; conversions: string }>;

  return c.json({ range: { from: range.fromDate, to: range.toDate }, series: rows.map(r => ({ day: r.day, revenue: r.revenue, conversions: Number(r.conversions) })) });
});

router.get('/:projectId/channels', async (c) => {
  const project = c.get('project');
  const q = c.req.query.bind(c.req);
  const range = resolveRange({ preset: q('preset'), from: q('from'), to: q('to') }, project.timezone);

  const rows = (await db.execute(sql`
    SELECT COALESCE(channel, 'Unknown') AS channel, SUM(conversion_value)::double precision AS revenue, COUNT(*)::int AS sessions
    FROM sessions
    WHERE project_id = ${project.id} AND started_at >= ${range.fromIso}::timestamptz AND started_at < ${range.toIso}::timestamptz
    GROUP BY COALESCE(channel, 'Unknown') ORDER BY revenue DESC LIMIT 100
  `)) as unknown as Array<{ channel: string; revenue: number; sessions: number }>;

  return c.json({ range: { from: range.fromDate, to: range.toDate }, channels: rows });
});

export default router;
