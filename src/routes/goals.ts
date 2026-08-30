import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { goals } from '../db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { requireProject } from '../middleware/project.js';
import { resolveRange } from '../lib/time.js';
import { parseFilters, sessionConditions } from '../lib/filters.js';
import { invalidateProject } from '../lib/cache.js';
import { requestRebuild } from '../workers/rollup.js';
import type { AppEnv } from '../lib/types.js';

/** Hono types path params as optional on untyped routers; this narrows safely. */
function requiredParam(c: { req: { param(key: string): string | undefined } }, key: string): string {
  return c.req.param(key) ?? '';
}

const router = new Hono<AppEnv>();
router.use('*', authMiddleware);
router.use('/:projectId/*', requireProject('viewer'));
router.use('/:projectId', requireProject('viewer'));

const goalSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['pageview', 'event']),
  matchValue: z.string().min(1).max(512),
  matchType: z.enum(['exact', 'contains', 'starts_with', 'regex']).default('exact'),
  value: z.number().min(0).max(1_000_000).default(0),
});

router.get('/:projectId', async (c) => {
  const project = c.get('project');
  const rows = await db.query.goals.findMany({
    where: eq(goals.projectId, project.id),
    orderBy: (g, { asc }) => [asc(g.createdAt)],
  });
  return c.json({ goals: rows });
});

router.post('/:projectId', requireProject('member'), async (c) => {
  const project = c.get('project');
  const body = goalSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);

  const [goal] = await db.insert(goals).values({
    projectId: project.id,
    name: body.data.name,
    kind: body.data.kind,
    matchValue: body.data.matchValue,
    matchType: body.data.matchType,
    value: body.data.value,
  }).returning();

  // A new goal changes conversion history, so past days must be recomputed.
  await requestRebuild(project.id);
  await invalidateProject(project.id);

  return c.json({ goal, rebuilding: true }, 201);
});

router.delete('/:projectId/:goalId', requireProject('member'), async (c) => {
  const project = c.get('project');
  const deleted = await db.delete(goals)
    .where(and(eq(goals.id, requiredParam(c, 'goalId')), eq(goals.projectId, project.id)))
    .returning();
  if (!deleted.length) return c.json({ error: 'Not found' }, 404);

  await requestRebuild(project.id);
  await invalidateProject(project.id);
  return c.json({ ok: true, rebuilding: true });
});

/** Conversions per goal over the selected range, with the conversion rate. */
router.get('/:projectId/report', async (c) => {
  const project = c.get('project');
  const q = c.req.query.bind(c.req);
  const range = resolveRange(
    { preset: q('preset'), from: q('from'), to: q('to'), compare: q('compare') },
    project.timezone,
  );
  const filters = parseFilters(q);

  const defined = await db.query.goals.findMany({ where: eq(goals.projectId, project.id) });

  const [totals] = (await db.execute(sql`
    SELECT COUNT(*) AS sessions, COUNT(DISTINCT s.visitor_id) AS visitors
    FROM sessions s
    WHERE s.project_id = ${project.id}
      AND s.started_at >= ${range.from} AND s.started_at < ${range.to}
      AND ${sessionConditions(filters)}
  `)) as unknown as Array<Record<string, unknown>>;

  const totalSessions = Number(totals?.sessions ?? 0);

  const rows = (await db.execute(sql`
    SELECT g.id::text AS goal_id,
           COUNT(*) FILTER (WHERE s.goals_hit ? g.id::text) AS conversions,
           COUNT(DISTINCT s.visitor_id) FILTER (WHERE s.goals_hit ? g.id::text) AS converters,
           COALESCE(SUM(g.value) FILTER (WHERE s.goals_hit ? g.id::text), 0) AS value
    FROM goals g
    LEFT JOIN sessions s
      ON s.project_id = ${project.id}
     AND s.started_at >= ${range.from} AND s.started_at < ${range.to}
     AND ${sessionConditions(filters)}
    WHERE g.project_id = ${project.id}
    GROUP BY g.id
  `)) as unknown as Array<Record<string, unknown>>;

  const byGoal = new Map(rows.map((r) => [String(r.goal_id), r]));

  return c.json({
    range: { from: range.fromDate, to: range.toDate, timezone: range.tz },
    totalSessions,
    goals: defined.map((g) => {
      const row = byGoal.get(g.id);
      const conversions = Number(row?.conversions ?? 0);
      return {
        id: g.id,
        name: g.name,
        kind: g.kind,
        matchValue: g.matchValue,
        matchType: g.matchType,
        conversions,
        converters: Number(row?.converters ?? 0),
        value: Number(row?.value ?? 0),
        conversionRate: totalSessions ? Math.round((conversions / totalSessions) * 1000) / 10 : 0,
      };
    }),
  });
});

export default router;
