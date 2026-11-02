import { Hono } from 'hono';
import { z } from 'zod';
import { db, sql as pg } from '../db/index.js';
import { projects } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { requireProject } from '../middleware/project.js';
import {
  HUNTERS, DISCOVERY_PROVIDERS, INTENT_CHANNELS, BUILT_IN_OFFERS,
  normalizePlan, searchPlaces, searchCount, intentSearches, type HuntPlanFields,
} from '../lib/hunts.js';
import { expandRegion } from '../lib/regions.js';
import type { AppEnv } from '../lib/types.js';

const router = new Hono<AppEnv>();

const planSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  hunters: z.array(z.enum(HUNTERS)).min(1),
  terms: z.array(z.string().max(120)).max(50).default([]),
  regions: z.array(z.string().max(160)).max(50).default([]),
  places: z.array(z.string().max(200)).max(500).default([]),
  country: z.string().regex(/^[a-zA-Z]{2}$/).nullish(),
  provider: z.enum(DISCOVERY_PROVIDERS).default('osm'),
  limitPerQuery: z.number().int().min(1).max(500).default(60),
  maxSpend: z.number().min(0).max(1000).default(1),
  intentQueries: z.array(z.string().max(200)).max(50).default([]),
  intentChannels: z.array(z.enum(INTENT_CHANNELS)).default(['reddit', 'web']),
  offers: z.array(z.string().max(60)).max(20).default([]),
  notes: z.string().max(4000).nullish(),
}).superRefine((plan, ctx) => {
  const searchesPlaces = plan.hunters.includes('harvey') || plan.hunters.includes('maps_scraper');
  if (searchesPlaces && !plan.terms.some((t) => t.trim())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['terms'], message: 'Add at least one kind of business to look for' });
  }
  if (searchesPlaces && !plan.regions.some((r) => r.trim()) && !plan.places.some((p) => p.trim())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['regions'], message: 'Add at least one region or city' });
  }
  if (plan.hunters.includes('intent') && !plan.intentQueries.some((q) => q.trim())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['intentQueries'], message: 'Add at least one search for buyer posts' });
  }
});

type PlanRow = {
  id: string; name: string; enabled: boolean; hunters: string[]; terms: string[]; regions: string[];
  places: string[]; country: string | null; provider: string; limit_per_query: number; max_spend: string;
  intent_queries: string[]; intent_channels: string[]; offers: string[]; notes: string | null;
  last_run_at: Date | null; last_run: unknown; updated_at: Date;
};

function present(row: PlanRow) {
  const plan: HuntPlanFields = {
    name: row.name, enabled: row.enabled, hunters: row.hunters as HuntPlanFields['hunters'],
    terms: row.terms, regions: row.regions, places: row.places, country: row.country,
    provider: row.provider, limitPerQuery: row.limit_per_query, maxSpend: Number(row.max_spend),
    intentQueries: row.intent_queries, intentChannels: row.intent_channels, offers: row.offers, notes: row.notes,
  };
  return {
    id: row.id,
    ...plan,
    searchPlaces: searchPlaces(plan),
    searches: searchCount(plan),
    intentSearches: plan.hunters.includes('intent') ? intentSearches(plan) : [],
    lastRunAt: row.last_run_at,
    lastRun: row.last_run,
    updatedAt: row.updated_at,
  };
}

function columns(plan: HuntPlanFields) {
  return {
    name: plan.name,
    enabled: plan.enabled,
    hunters: pg.array(plan.hunters),
    terms: pg.array(plan.terms),
    regions: pg.array(plan.regions),
    places: pg.array(plan.places),
    country: plan.country,
    provider: plan.provider,
    limit_per_query: plan.limitPerQuery,
    max_spend: plan.maxSpend,
    intent_queries: pg.array(plan.intentQueries),
    intent_channels: pg.array(plan.intentChannels),
    offers: pg.array(plan.offers),
    notes: plan.notes,
  };
}

async function projectByWriteKey(authorization: string | undefined) {
  const writeKey = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!writeKey) return null;
  const project = await db.query.projects.findFirst({ where: eq(projects.writeKey, writeKey) });
  return project && project.isActive ? project : null;
}

// ─────────────────────────────────────────────────────────────
// Hunter feed — write key, so Harvey and the scripts need no user login
// ─────────────────────────────────────────────────────────────

router.get('/feed', async (c) => {
  const project = await projectByWriteKey(c.req.header('authorization'));
  if (!project) return c.json({ error: 'Invalid write key' }, 401);
  const hunter = c.req.query('hunter');
  const rows = await pg<PlanRow[]>`
    SELECT * FROM hunt_plans
    WHERE project_id = ${project.id} AND enabled
      ${hunter ? pg`AND ${hunter} = ANY(hunters)` : pg``}
    ORDER BY updated_at DESC`;
  return c.json({ plans: rows.map(present) });
});

const reportSchema = z.object({
  hunter: z.enum(HUNTERS),
  searches: z.number().int().min(0).optional(),
  found: z.number().int().min(0).optional(),
  leads: z.number().int().min(0).optional(),
  cost: z.number().min(0).optional(),
  errors: z.array(z.string().max(300)).max(20).optional(),
});

router.post('/feed/:planId/report', async (c) => {
  const project = await projectByWriteKey(c.req.header('authorization'));
  if (!project) return c.json({ error: 'Invalid write key' }, 401);
  const parsed = reportSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const planId = c.req.param('planId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return c.json({ error: 'Plan not found' }, 404);
  const report = { ...parsed.data, at: new Date().toISOString() };
  // Keep the last report per hunter so the dashboard shows each one's latest result.
  const updated = await pg`
    UPDATE hunt_plans
    SET last_run_at = NOW(),
        last_run = COALESCE(last_run, '{}'::jsonb) || ${pg.json({ [parsed.data.hunter]: report } as never)}
    WHERE id = ${planId} AND project_id = ${project.id}
    RETURNING id`;
  return updated.length ? c.json({ ok: true }) : c.json({ error: 'Plan not found' }, 404);
});

// ─────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────

router.use('*', authMiddleware);
router.use('/:projectId', requireProject('viewer'));
router.use('/:projectId/*', requireProject('viewer'));

router.get('/:projectId', async (c) => {
  const project = c.get('project');
  const rows = await pg<PlanRow[]>`SELECT * FROM hunt_plans WHERE project_id = ${project.id} ORDER BY created_at DESC`;
  return c.json({
    plans: rows.map(present),
    options: { hunters: HUNTERS, providers: DISCOVERY_PROVIDERS, intentChannels: INTENT_CHANNELS, offers: BUILT_IN_OFFERS },
  });
});

/** Expand regions into the cities a run will search, for review before saving. */
router.post('/:projectId/preview-places', requireProject('member'), async (c) => {
  const body = z.object({
    regions: z.array(z.string().max(160)).min(1).max(20),
    maxPerRegion: z.number().int().min(1).max(200).default(25),
    includeTowns: z.boolean().default(false),
  }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
  const results = [];
  for (const region of body.data.regions) {
    results.push({ region, ...(await expandRegion(region, body.data.maxPerRegion, body.data.includeTowns)) });
  }
  return c.json({ results });
});

router.post('/:projectId', requireProject('member'), async (c) => {
  const project = c.get('project');
  const parsed = planSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const plan = normalizePlan({ ...parsed.data, country: parsed.data.country ?? null, notes: parsed.data.notes ?? null });
  const [row] = await pg<PlanRow[]>`
    INSERT INTO hunt_plans ${pg({ project_id: project.id, created_by: c.get('userId'), ...columns(plan) })}
    RETURNING *`;
  return c.json({ plan: present(row) }, 201);
});

router.put('/:projectId/:planId', requireProject('member'), async (c) => {
  const project = c.get('project');
  const planId = c.req.param('planId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return c.json({ error: 'Plan not found' }, 404);
  const parsed = planSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const plan = normalizePlan({ ...parsed.data, country: parsed.data.country ?? null, notes: parsed.data.notes ?? null });
  const [row] = await pg<PlanRow[]>`
    UPDATE hunt_plans SET ${pg({ ...columns(plan), updated_at: new Date().toISOString() })}
    WHERE id = ${planId} AND project_id = ${project.id}
    RETURNING *`;
  return row ? c.json({ plan: present(row) }) : c.json({ error: 'Plan not found' }, 404);
});

router.delete('/:projectId/:planId', requireProject('member'), async (c) => {
  const project = c.get('project');
  const planId = c.req.param('planId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return c.json({ error: 'Plan not found' }, 404);
  const deleted = await pg`DELETE FROM hunt_plans WHERE id = ${planId} AND project_id = ${project.id} RETURNING id`;
  return deleted.length ? c.json({ ok: true }) : c.json({ error: 'Plan not found' }, 404);
});

export default router;
