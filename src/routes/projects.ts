import { Hono } from 'hono';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { db } from '../db/index.js';
import { projects, projectMembers, users } from '../db/schema.js';
import { and, count, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { authMiddleware } from '../middleware/auth.js';
import { requireProject } from '../middleware/project.js';
import { isValidTimezone } from '../lib/time.js';
import { liveCounts } from '../lib/redis.js';
import { invalidateProject } from '../lib/cache.js';
import { invalidateProjectConfig } from './collect.js';
import { env } from '../config.js';
import type { AppEnv, Project } from '../lib/types.js';

const router = new Hono<AppEnv>();
router.use('*', authMiddleware);
router.use('/:id/*', requireProject('viewer'));

const createSchema = z.object({
  name: z.string().min(1).max(100),
  domain: z.string().min(1).max(255),
  timezone: z.string().max(64).optional(),
  identityMode: z.enum(['cookieless', 'persistent']).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  domain: z.string().min(1).max(255).optional(),
  timezone: z.string().max(64).optional(),
  identityMode: z.enum(['cookieless', 'persistent']).optional(),
  retentionDays: z.number().int().min(0).max(3650).optional(),
  excludedPaths: z.array(z.string().max(512)).max(50).optional(),
  excludedIps: z.array(z.string().max(64)).max(100).optional(),
  clarityId: z.string().max(32).nullable().optional(),
  isActive: z.boolean().optional(),
});

function newWriteKey(): string {
  return `wk_${randomBytes(24).toString('hex')}`;
}

function snippetFor(origin: string, project: Project): string {
  const identity = project.identityMode === 'persistent' ? ' data-identity="persistent"' : '';
  return `<script defer src="${origin}/t.js" data-id="${project.id}"${identity}></script>`;
}

function baseOrigin(url: string): string {
  return new URL(url).origin.replace(/^http:/, 'https:');
}

/** Never leak the write key or share password hash to a non-admin viewer. */
function present(project: Project, role: string) {
  const canSeeSecrets = role === 'owner' || role === 'admin';
  return {
    id: project.id,
    name: project.name,
    domain: project.domain,
    timezone: project.timezone,
    identityMode: project.identityMode,
    retentionDays: project.retentionDays,
    excludedPaths: project.excludedPaths,
    excludedIps: project.excludedIps,
    clarityId: project.clarityId,
    shareSlug: project.shareSlug,
    shareProtected: !!project.sharePasswordHash,
    isActive: project.isActive,
    firstEventAt: project.firstEventAt,
    lastEventAt: project.lastEventAt,
    createdAt: project.createdAt,
    writeKey: canSeeSecrets ? project.writeKey : undefined,
  };
}

// ─────────────────────────────────────────────────────────────

router.get('/', async (c) => {
  const userId = c.get('userId');

  const owned = await db.query.projects.findMany({
    where: eq(projects.userId, userId),
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  });

  const shared = (await db.execute(sql`
    SELECT p.* FROM projects p
    JOIN project_members m ON m.project_id = p.id
    WHERE m.user_id = ${userId}
    ORDER BY p.created_at DESC
  `)) as unknown as Project[];

  const all = [...owned, ...shared];
  const live = await liveCounts(all.map((p) => p.id));

  return c.json({
    projects: all.map((p) => ({
      ...present(p, owned.includes(p) ? 'owner' : 'viewer'),
      liveVisitors: live[p.id] ?? 0,
    })),
  });
});

router.post('/', async (c) => {
  const body = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);

  const userId = c.get('userId');
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });

  if (user?.role !== 'admin') {
    const [{ value: owned }] = await db.select({ value: count() }).from(projects).where(eq(projects.userId, userId));
    if (owned >= env.MAX_PROJECTS_FREE) {
      return c.json({ error: `Free plan is limited to ${env.MAX_PROJECTS_FREE} projects.` }, 403);
    }
  }

  const timezone = body.data.timezone && isValidTimezone(body.data.timezone) ? body.data.timezone : 'UTC';

  const [project] = await db.insert(projects).values({
    id: nanoid(12),
    userId,
    name: body.data.name,
    domain: body.data.domain,
    timezone,
    identityMode: body.data.identityMode ?? 'cookieless',
    writeKey: newWriteKey(),
  }).returning();

  return c.json({
    project: present(project, 'owner'),
    snippet: snippetFor(baseOrigin(c.req.url), project),
  }, 201);
});

router.get('/:id', async (c) => {
  const project = c.get('project');
  const role = c.get('projectRole');
  const origin = baseOrigin(c.req.url);

  return c.json({
    project: present(project, role),
    role,
    snippet: snippetFor(origin, project),
    npmSnippet: `import { pulse } from '@pulse/js';\n\npulse.init({ projectId: '${project.id}', host: '${origin}' });`,
    serverExample:
      `curl -X POST ${origin}/api/collect/server \\\n` +
      `  -H "Authorization: Bearer ${role === 'owner' || role === 'admin' ? project.writeKey : '<write key>'}" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -d '{"event":"payment_succeeded","userId":"user_123","properties":{"plan":"pro"}}'`,
  });
});

router.patch('/:id', requireProject('admin'), async (c) => {
  const project = c.get('project');
  const body = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);

  const patch: Partial<typeof projects.$inferInsert> = { ...body.data };

  if (body.data.timezone !== undefined) {
    if (!isValidTimezone(body.data.timezone)) return c.json({ error: 'Unknown IANA timezone' }, 400);
    patch.timezone = body.data.timezone;
  }
  if (body.data.clarityId !== undefined) patch.clarityId = body.data.clarityId || null;

  const [updated] = await db.update(projects).set(patch).where(eq(projects.id, project.id)).returning();

  await invalidateProjectConfig(project.id);
  await invalidateProject(project.id);

  return c.json({ project: present(updated, c.get('projectRole')) });
});

/**
 * Rotate the write key. The old server-side key stops working immediately;
 * historical data and the browser snippet are untouched.
 */
router.post('/:id/rotate-write-key', requireProject('admin'), async (c) => {
  const project = c.get('project');
  const [updated] = await db.update(projects)
    .set({ writeKey: newWriteKey() })
    .where(eq(projects.id, project.id))
    .returning();
  return c.json({ writeKey: updated.writeKey });
});

/**
 * Rotate the public snippet id.
 *
 * The previous implementation created a new project row and deleted the old one,
 * which cascade-deleted every event the customer had ever collected. This moves
 * the existing rows to the new id inside one transaction instead, so history
 * survives and only the old snippet stops working.
 */
router.post('/:id/regenerate', requireProject('admin'), async (c) => {
  const project = c.get('project');
  const newId = nanoid(12);

  await db.transaction(async (tx) => {
    // Insert the new identity first so foreign keys stay satisfied throughout.
    await tx.insert(projects).values({
      ...project,
      id: newId,
      writeKey: newWriteKey(),
      publicKeyVersion: project.publicKeyVersion + 1,
      shareSlug: null,
      sharePasswordHash: null,
    });

    for (const table of [
      'events', 'sessions', 'daily_visitors', 'visitor_profiles', 'daily_stats',
      'daily_pages', 'page_transitions', 'error_groups', 'rollup_state',
    ]) {
      await tx.execute(sql`UPDATE ${sql.raw(table)} SET project_id = ${newId} WHERE project_id = ${project.id}`);
    }
    for (const table of ['goals', 'funnels', 'alerts', 'project_members']) {
      await tx.execute(sql`UPDATE ${sql.raw(table)} SET project_id = ${newId} WHERE project_id = ${project.id}`);
    }

    await tx.delete(projects).where(eq(projects.id, project.id));
  });

  await invalidateProjectConfig(project.id);
  await invalidateProject(project.id);

  const [moved] = await db.select().from(projects).where(eq(projects.id, newId));
  return c.json({
    project: present(moved, 'owner'),
    snippet: snippetFor(baseOrigin(c.req.url), moved),
    historyPreserved: true,
  });
});

router.delete('/:id', requireProject('admin'), async (c) => {
  const project = c.get('project');
  // Analytics tables are not FK-linked to projects (they are partitioned/rollup
  // tables), so they are cleared explicitly rather than by cascade.
  await db.transaction(async (tx) => {
    for (const table of [
      'events', 'sessions', 'daily_visitors', 'visitor_profiles', 'daily_stats',
      'daily_pages', 'page_transitions', 'error_groups', 'rollup_state',
    ]) {
      await tx.execute(sql`DELETE FROM ${sql.raw(table)} WHERE project_id = ${project.id}`);
    }
    await tx.delete(projects).where(eq(projects.id, project.id));
  });

  await invalidateProjectConfig(project.id);
  await invalidateProject(project.id);
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// Installation health — powers the onboarding verification screen
// ─────────────────────────────────────────────────────────────

router.get('/:id/setup-status', async (c) => {
  const project = c.get('project');

  const [row] = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE timestamp >= NOW() - interval '5 minutes')  AS last_5m,
      COUNT(*) FILTER (WHERE timestamp >= NOW() - interval '24 hours')   AS last_24h,
      COUNT(DISTINCT path) FILTER (WHERE type = 'pageview')              AS distinct_paths,
      COUNT(*) FILTER (WHERE type = 'performance')                       AS perf_events,
      COUNT(*) FILTER (WHERE type = 'custom')                            AS custom_events,
      COUNT(*) FILTER (WHERE type = 'js_error')                          AS error_events,
      MAX(timestamp)                                                     AS last_event_at
    FROM events WHERE project_id = ${project.id}
  `)) as unknown as Array<Record<string, unknown>>;

  const n = (v: unknown) => Number(v ?? 0);
  const installed = !!project.firstEventAt;
  const receiving = n(row?.last_24h) > 0;

  const warnings: string[] = [];
  if (installed && !receiving) warnings.push('No events received in the last 24 hours — the snippet may have been removed.');
  if (receiving && n(row?.distinct_paths) === 1) warnings.push('Events are only arriving from one page. If your site has more, the snippet may only be on the homepage.');
  if (receiving && n(row?.perf_events) === 0) warnings.push('No performance samples yet — Core Web Vitals need a few real page loads.');

  return c.json({
    installed,
    receiving,
    liveNow: n(row?.last_5m),
    last24h: n(row?.last_24h),
    distinctPaths: n(row?.distinct_paths),
    customEvents: n(row?.custom_events),
    errorEvents: n(row?.error_events),
    firstEventAt: project.firstEventAt,
    lastEventAt: row?.last_event_at ?? project.lastEventAt,
    warnings,
  });
});

// ─────────────────────────────────────────────────────────────
// Team members
// ─────────────────────────────────────────────────────────────

router.get('/:id/members', requireProject('admin'), async (c) => {
  const project = c.get('project');
  const rows = (await db.execute(sql`
    SELECT u.id, u.email, u.name, m.role, m.created_at
    FROM project_members m JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ${project.id}
    ORDER BY m.created_at ASC
  `)) as unknown as Array<Record<string, unknown>>;

  const owner = await db.query.users.findFirst({ where: eq(users.id, project.userId) });

  return c.json({
    owner: owner ? { id: owner.id, email: owner.email, name: owner.name, role: 'owner' } : null,
    members: rows,
  });
});

router.post('/:id/members', requireProject('admin'), async (c) => {
  const project = c.get('project');
  const body = z.object({
    email: z.string().email(),
    role: z.enum(['viewer', 'member', 'admin']).default('viewer'),
  }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);

  const user = await db.query.users.findFirst({ where: eq(users.email, body.data.email) });
  if (!user) return c.json({ error: 'No account with that email. Ask them to sign up first.' }, 404);
  if (user.id === project.userId) return c.json({ error: 'That user already owns this project.' }, 409);

  await db.insert(projectMembers)
    .values({ projectId: project.id, userId: user.id, role: body.data.role })
    .onConflictDoUpdate({
      target: [projectMembers.projectId, projectMembers.userId],
      set: { role: body.data.role },
    });

  return c.json({ ok: true, member: { id: user.id, email: user.email, role: body.data.role } }, 201);
});

router.delete('/:id/members/:userId', requireProject('admin'), async (c) => {
  const project = c.get('project');
  const deleted = await db.delete(projectMembers)
    .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, c.req.param('userId') ?? '')))
    .returning();
  if (!deleted.length) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// Public sharing
// ─────────────────────────────────────────────────────────────

router.post('/:id/share', requireProject('admin'), async (c) => {
  const project = c.get('project');
  const body = z.object({
    enabled: z.boolean(),
    password: z.string().min(4).max(128).nullable().optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);

  if (!body.data.enabled) {
    await db.update(projects).set({ shareSlug: null, sharePasswordHash: null }).where(eq(projects.id, project.id));
    return c.json({ shareSlug: null });
  }

  const slug = project.shareSlug || nanoid(16);
  const passwordHash = body.data.password ? await bcrypt.hash(body.data.password, 10) : null;

  await db.update(projects)
    .set({ shareSlug: slug, sharePasswordHash: body.data.password === undefined ? project.sharePasswordHash : passwordHash })
    .where(eq(projects.id, project.id));

  return c.json({ shareSlug: slug, url: `${baseOrigin(c.req.url)}/share/${slug}` });
});

// ─────────────────────────────────────────────────────────────
// GDPR — erase one visitor's data on request
// ─────────────────────────────────────────────────────────────

router.delete('/:id/visitors/:visitorId', requireProject('admin'), async (c) => {
  const project = c.get('project');
  const visitorId = c.req.param('visitorId');

  const removed = await db.transaction(async (tx) => {
    const res = (await tx.execute(sql`
      DELETE FROM events WHERE project_id = ${project.id} AND visitor_id = ${visitorId}
    `)) as unknown as { count?: number };
    await tx.execute(sql`DELETE FROM sessions WHERE project_id = ${project.id} AND visitor_id = ${visitorId}`);
    await tx.execute(sql`DELETE FROM daily_visitors WHERE project_id = ${project.id} AND visitor_id = ${visitorId}`);
    await tx.execute(sql`DELETE FROM visitor_profiles WHERE project_id = ${project.id} AND visitor_id = ${visitorId}`);
    return res?.count ?? 0;
  });

  await invalidateProject(project.id);
  return c.json({ ok: true, eventsDeleted: removed, note: 'Rollups will be rebuilt on the next pass.' });
});

export default router;
