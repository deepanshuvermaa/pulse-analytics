import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { alerts } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { requireProject } from '../middleware/project.js';
import type { AppEnv } from '../lib/types.js';

/** Hono types path params as optional on untyped routers; this narrows safely. */
function requiredParam(c: { req: { param(key: string): string | undefined } }, key: string): string {
  return c.req.param(key) ?? '';
}

const router = new Hono<AppEnv>();
router.use('*', authMiddleware);
router.use('/:projectId', requireProject('viewer'));
router.use('/:projectId/*', requireProject('viewer'));

export const ALERT_KINDS = ['traffic_spike', 'traffic_drop', 'error_spike', 'conversion_drop', 'no_data'] as const;

const alertSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(ALERT_KINDS),
  /** Percent change for spike/drop rules; hours without data for `no_data`. */
  threshold: z.number().min(1).max(10000).default(50),
  webhookUrl: z.string().url().max(2048).nullable().optional(),
  email: z.string().email().max(255).nullable().optional(),
  enabled: z.boolean().default(true),
});

router.get('/:projectId', async (c) => {
  const project = c.get('project');
  const rows = await db.query.alerts.findMany({
    where: eq(alerts.projectId, project.id),
    orderBy: (a, { asc }) => [asc(a.createdAt)],
  });
  return c.json({ alerts: rows, kinds: ALERT_KINDS });
});

router.post('/:projectId', requireProject('admin'), async (c) => {
  const project = c.get('project');
  const body = alertSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);

  if (!body.data.webhookUrl && !body.data.email) {
    return c.json({ error: 'An alert needs a webhook URL or an email address.' }, 400);
  }

  const [alert] = await db.insert(alerts).values({
    projectId: project.id,
    name: body.data.name,
    kind: body.data.kind,
    threshold: body.data.threshold,
    webhookUrl: body.data.webhookUrl ?? null,
    email: body.data.email ?? null,
    enabled: body.data.enabled,
  }).returning();

  return c.json({ alert }, 201);
});

router.patch('/:projectId/:alertId', requireProject('admin'), async (c) => {
  const project = c.get('project');
  const body = alertSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);

  const [updated] = await db.update(alerts)
    .set(body.data)
    .where(and(eq(alerts.id, requiredParam(c, 'alertId')), eq(alerts.projectId, project.id)))
    .returning();

  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json({ alert: updated });
});

router.delete('/:projectId/:alertId', requireProject('admin'), async (c) => {
  const project = c.get('project');
  const deleted = await db.delete(alerts)
    .where(and(eq(alerts.id, requiredParam(c, 'alertId')), eq(alerts.projectId, project.id)))
    .returning();
  if (!deleted.length) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export default router;
