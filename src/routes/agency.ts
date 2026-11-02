import { Hono } from 'hono';
import { z } from 'zod';
import { db, sql as pg } from '../db/index.js';
import { projects } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { requireProject } from '../middleware/project.js';
import type { AppEnv } from '../lib/types.js';

/**
 * Jobs for the agency PC. Voice calls, Maps scraping and hunts must run on the
 * owner's machine (home IP, WhatsApp session, phone credentials), which the hub
 * cannot reach — so the dashboard queues a job here and a local runner polls,
 * claims, runs and reports it back.
 */
const router = new Hono<AppEnv>();

export const JOB_KINDS = ['voice_test_call', 'voice_call', 'voice_check', 'harvey_hunt', 'scraper_sync', 'intent_search', 'geo_probe'] as const;
const LOG_LIMIT = 20_000;

async function projectByWriteKey(authorization: string | undefined) {
  const key = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!key) return null;
  const project = await db.query.projects.findFirst({ where: eq(projects.writeKey, key) });
  return project && project.isActive ? project : null;
}

// ── Runner (write key) ─────────────────────────────────────────

router.post('/runner/claim', async (c) => {
  const project = await projectByWriteKey(c.req.header('authorization'));
  if (!project) return c.json({ error: 'Invalid write key' }, 401);
  const body = z.object({ runner: z.string().min(1).max(80), kinds: z.array(z.string().max(40)).max(20) })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
  // SKIP LOCKED: two runners never take the same job.
  const [job] = await pg`
    UPDATE agency_jobs SET status = 'running', runner = ${body.data.runner}, started_at = NOW()
    WHERE id = (
      SELECT id FROM agency_jobs
      WHERE project_id = ${project.id} AND status = 'queued' AND kind = ANY(${pg.array(body.data.kinds)})
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, params`;
  return job ? c.json({ job }) : c.body(null, 204);
});

router.post('/runner/jobs/:id/finish', async (c) => {
  const project = await projectByWriteKey(c.req.header('authorization'));
  if (!project) return c.json({ error: 'Invalid write key' }, 401);
  const body = z.object({
    status: z.enum(['done', 'failed']),
    result: z.unknown().optional(),
    log: z.string().optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
  const id = c.req.param('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'Job not found' }, 404);
  const log = (body.data.log ?? '').slice(-LOG_LIMIT);
  const updated = await pg`
    UPDATE agency_jobs SET status = ${body.data.status}, result = ${pg.json((body.data.result ?? null) as never)},
      log = ${log}, finished_at = NOW()
    WHERE id = ${id} AND project_id = ${project.id} AND status = 'running'
    RETURNING id`;
  return updated.length ? c.json({ ok: true }) : c.json({ error: 'Job not found or not running' }, 404);
});

// ── Dashboard ───────────────────────────────────────────────

router.use('*', authMiddleware);
router.use('/:projectId', requireProject('viewer'));
router.use('/:projectId/*', requireProject('viewer'));

const createSchema = z.object({
  kind: z.enum(JOB_KINDS),
  params: z.record(z.unknown()).default({}),
});

router.post('/:projectId/jobs', requireProject('member'), async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const { kind, params } = parsed.data;
  if (kind === 'voice_call' && !/^\+?\d{10,15}$/.test(String(params.phone ?? '').replace(/[\s-]/g, ''))) {
    return c.json({ error: 'voice_call needs a phone number' }, 400);
  }
  const [job] = await pg`
    INSERT INTO agency_jobs (project_id, kind, params, requested_by)
    VALUES (${c.get('project').id}, ${kind}, ${pg.json(params as never)}, ${c.get('userId')})
    RETURNING id, kind, params, status, created_at`;
  return c.json({ job }, 201);
});

router.get('/:projectId/jobs', async (c) => {
  const kind = c.req.query('kind');
  const leadId = c.req.query('leadId');
  const jobs = await pg`
    SELECT id, kind, params, status, runner, result, created_at, started_at, finished_at
    FROM agency_jobs
    WHERE project_id = ${c.get('project').id}
      ${kind ? pg`AND kind = ${kind}` : pg``}
      ${leadId ? pg`AND params->>'leadId' = ${leadId}` : pg``}
    ORDER BY created_at DESC LIMIT 50`;
  return c.json({ jobs });
});

router.get('/:projectId/jobs/:jobId', async (c) => {
  const id = c.req.param('jobId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'Job not found' }, 404);
  const [job] = await pg`SELECT * FROM agency_jobs WHERE id = ${id} AND project_id = ${c.get('project').id}`;
  return job ? c.json({ job }) : c.json({ error: 'Job not found' }, 404);
});

router.post('/:projectId/jobs/:jobId/cancel', requireProject('member'), async (c) => {
  const id = c.req.param('jobId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'Job not found' }, 404);
  const updated = await pg`
    UPDATE agency_jobs SET status = 'cancelled', finished_at = NOW()
    WHERE id = ${id} AND project_id = ${c.get('project').id} AND status = 'queued' RETURNING id`;
  return updated.length ? c.json({ ok: true }) : c.json({ error: 'Only queued jobs can be cancelled' }, 409);
});

export default router;
