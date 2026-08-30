import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { funnels } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { requireProject } from '../middleware/project.js';
import { resolveRange } from '../lib/time.js';
import { parseFilters, filterFingerprint } from '../lib/filters.js';
import { cacheKey, cached, invalidateProject } from '../lib/cache.js';
import { computeFunnel, MAX_FUNNEL_STEPS, FUNNEL_BREAKDOWNS } from '../lib/funnel-engine.js';
import type { AppEnv } from '../lib/types.js';

/** Hono types path params as optional on untyped routers; this narrows safely. */
function requiredParam(c: { req: { param(key: string): string | undefined } }, key: string): string {
  return c.req.param(key) ?? '';
}

const router = new Hono<AppEnv>();
router.use('*', authMiddleware);
router.use('/:projectId', requireProject('viewer'));
router.use('/:projectId/*', requireProject('viewer'));

const stepSchema = z.object({
  kind: z.enum(['pageview', 'event']),
  value: z.string().min(1).max(512),
  matchType: z.enum(['exact', 'contains', 'starts_with', 'regex']).optional(),
  label: z.string().max(120).optional(),
});

const funnelSchema = z.object({
  name: z.string().min(1).max(120),
  steps: z.array(stepSchema).min(2).max(MAX_FUNNEL_STEPS),
  windowHours: z.number().int().min(1).max(24 * 90).default(168),
  strictOrder: z.boolean().default(false),
});

router.get('/:projectId', async (c) => {
  const project = c.get('project');
  const rows = await db.query.funnels.findMany({
    where: eq(funnels.projectId, project.id),
    orderBy: (f, { asc }) => [asc(f.createdAt)],
  });
  return c.json({ funnels: rows, maxSteps: MAX_FUNNEL_STEPS, breakdowns: FUNNEL_BREAKDOWNS });
});

router.post('/:projectId', requireProject('member'), async (c) => {
  const project = c.get('project');
  const body = funnelSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);

  const [funnel] = await db.insert(funnels).values({
    projectId: project.id,
    name: body.data.name,
    steps: body.data.steps,
    windowHours: body.data.windowHours,
    strictOrder: body.data.strictOrder,
  }).returning();

  await invalidateProject(project.id);
  return c.json({ funnel }, 201);
});

router.patch('/:projectId/:funnelId', requireProject('member'), async (c) => {
  const project = c.get('project');
  const body = funnelSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);

  const [updated] = await db.update(funnels)
    .set(body.data)
    .where(and(eq(funnels.id, requiredParam(c, 'funnelId')), eq(funnels.projectId, project.id)))
    .returning();

  if (!updated) return c.json({ error: 'Not found' }, 404);
  await invalidateProject(project.id);
  return c.json({ funnel: updated });
});

router.delete('/:projectId/:funnelId', requireProject('member'), async (c) => {
  const project = c.get('project');
  const deleted = await db.delete(funnels)
    .where(and(eq(funnels.id, requiredParam(c, 'funnelId')), eq(funnels.projectId, project.id)))
    .returning();
  if (!deleted.length) return c.json({ error: 'Not found' }, 404);
  await invalidateProject(project.id);
  return c.json({ ok: true });
});

/** Ad-hoc funnel — build and run without saving it first. */
router.post('/:projectId/preview', async (c) => {
  const project = c.get('project');
  const body = funnelSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);

  const q = c.req.query.bind(c.req);
  const range = resolveRange({ preset: q('preset'), from: q('from'), to: q('to') }, project.timezone);
  const filters = parseFilters(q);
  const breakdownBy = q('breakdown');

  try {
    const result = await computeFunnel(project.id, range, filters, body.data, breakdownBy);
    return c.json({ range: { from: range.fromDate, to: range.toDate, timezone: range.tz }, ...result });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Funnel computation failed' }, 400);
  }
});

router.get('/:projectId/:funnelId/report', async (c) => {
  const project = c.get('project');
  const funnel = await db.query.funnels.findFirst({
    where: and(eq(funnels.id, requiredParam(c, 'funnelId')), eq(funnels.projectId, project.id)),
  });
  if (!funnel) return c.json({ error: 'Not found' }, 404);

  const q = c.req.query.bind(c.req);
  const range = resolveRange({ preset: q('preset'), from: q('from'), to: q('to') }, project.timezone);
  const filters = parseFilters(q);
  const breakdownBy = q('breakdown');

  const key = cacheKey(project.id, `funnel:${funnel.id}`, {
    from: range.fromDate, to: range.toDate, tz: range.tz, breakdownBy: breakdownBy ?? '',
    ...filterFingerprint(filters),
  });

  try {
    const result = await cached(key, range.isOpen, () =>
      computeFunnel(project.id, range, filters, funnel, breakdownBy));
    return c.json({
      funnel: { id: funnel.id, name: funnel.name, windowHours: funnel.windowHours },
      range: { from: range.fromDate, to: range.toDate, timezone: range.tz },
      ...result,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Funnel computation failed' }, 400);
  }
});

export default router;
