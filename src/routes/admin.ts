import { Hono } from 'hono';
import { db } from '../db/index.js';
import { users, projects, suggestions } from '../db/schema.js';
import { count, desc, eq, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { requireInstanceAdmin } from '../middleware/project.js';
import { queueDepth, pendingDepth } from '../lib/queue.js';
import { liveCounts } from '../lib/redis.js';
import type { AppEnv } from '../lib/types.js';

const admin = new Hono<AppEnv>();
admin.use('*', authMiddleware);
admin.use('*', requireInstanceAdmin);

admin.get('/stats', async (c) => {
  const [[userCount], [projectCount], [eventCount], [sessionCount]] = await Promise.all([
    db.select({ count: count() }).from(users),
    db.select({ count: count() }).from(projects),
    // Exact COUNT(*) over a partitioned firehose is a full scan; the planner's
    // estimate is the right tool for a dashboard tile.
    db.execute(sql`SELECT COALESCE(SUM(n_live_tup), 0)::bigint AS count
                   FROM pg_stat_user_tables WHERE relname LIKE 'events%'`) as unknown as Promise<Array<{ count: string }>>,
    db.execute(sql`SELECT COUNT(*)::bigint AS count FROM sessions`) as unknown as Promise<Array<{ count: string }>>,
  ]);

  return c.json({
    users: userCount.count,
    projects: projectCount.count,
    events: Number(eventCount.count),
    sessions: Number(sessionCount.count),
    ingestQueue: await queueDepth(),
    ingestPending: await pendingDepth(),
  });
});

admin.get('/users', async (c) => {
  const rows = await db.select({
    id: users.id,
    email: users.email,
    name: users.name,
    role: users.role,
    createdAt: users.createdAt,
    projectCount: sql<number>`(SELECT COUNT(*) FROM projects WHERE projects.user_id = users.id)`,
  }).from(users).orderBy(desc(users.createdAt)).limit(500);

  return c.json({ users: rows });
});

/** Ingest and rollup health — the first thing to check when numbers look wrong. */
admin.get('/health', async (c) => {
  const lag = (await db.execute(sql`
    SELECT p.id, p.name, p.timezone,
           MAX(e.timestamp) AS last_event,
           MAX(rs.built_at) AS last_rollup,
           COUNT(*) FILTER (WHERE rs.sealed = FALSE) AS open_days
    FROM projects p
    LEFT JOIN events e ON e.project_id = p.id AND e.timestamp > NOW() - interval '2 days'
    LEFT JOIN rollup_state rs ON rs.project_id = p.id
    GROUP BY p.id, p.name, p.timezone
    ORDER BY last_event DESC NULLS LAST
    LIMIT 100
  `)) as unknown as Array<Record<string, unknown>>;

  const partitions = (await db.execute(sql`
    SELECT c.relname AS name, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'events'
    ORDER BY c.relname DESC
  `)) as unknown as Array<Record<string, unknown>>;

  return c.json({
    ingestQueue: await queueDepth(),
    ingestPending: await pendingDepth(),
    projects: lag,
    partitions,
  });
});

/**
 * Every project on the instance, with its owner and current activity.
 * Instance admins already resolve as project owners, so the normal analytics
 * endpoints work for any id listed here — no separate reporting path to keep
 * in sync.
 */
admin.get('/projects', async (c) => {
  const search = (c.req.query('search') || '').trim().toLowerCase();
  const limit = Math.min(Number(c.req.query('limit')) || 200, 500);

  const rows = (await db.execute(sql`
    SELECT p.id, p.name, p.domain, p.timezone, p.identity_mode, p.is_active,
           p.created_at, p.first_event_at, p.last_event_at,
           u.id AS owner_id, u.email AS owner_email, u.name AS owner_name,
           COALESCE(ds.sessions_30d, 0)  AS sessions_30d,
           COALESCE(ds.pageviews_30d, 0) AS pageviews_30d,
           COALESCE(ds.days_with_data, 0) AS days_with_data,
           (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS member_count
    FROM projects p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN (
      SELECT project_id,
             SUM(sessions)  AS sessions_30d,
             SUM(pageviews) AS pageviews_30d,
             COUNT(*)       AS days_with_data
      FROM daily_stats
      WHERE day >= (NOW() - interval '30 days')::date
      GROUP BY project_id
    ) ds ON ds.project_id = p.id
    ${search ? sql`WHERE LOWER(p.name) LIKE ${'%' + search + '%'}
                      OR LOWER(p.domain) LIKE ${'%' + search + '%'}
                      OR LOWER(u.email) LIKE ${'%' + search + '%'}` : sql``}
    ORDER BY p.last_event_at DESC NULLS LAST
    LIMIT ${limit}
  `)) as unknown as Array<Record<string, unknown>>;

  const live = await liveCounts(rows.map((r) => String(r.id)));

  return c.json({
    projects: rows.map((r) => ({
      id: r.id,
      name: r.name,
      domain: r.domain,
      timezone: r.timezone,
      identityMode: r.identity_mode,
      isActive: r.is_active,
      createdAt: r.created_at,
      firstEventAt: r.first_event_at,
      lastEventAt: r.last_event_at,
      owner: { id: r.owner_id, email: r.owner_email, name: r.owner_name },
      sessions30d: Number(r.sessions_30d ?? 0),
      pageviews30d: Number(r.pageviews_30d ?? 0),
      daysWithData: Number(r.days_with_data ?? 0),
      memberCount: Number(r.member_count ?? 0),
      liveVisitors: live[String(r.id)] ?? 0,
    })),
  });
});

/** One user with their projects — the drill-in from the users table. */
admin.get('/users/:userId', async (c) => {
  const userId = c.req.param('userId') ?? '';

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return c.json({ error: 'Not found' }, 404);

  const owned = (await db.execute(sql`
    SELECT p.id, p.name, p.domain, p.timezone, p.is_active,
           p.created_at, p.last_event_at,
           COALESCE(SUM(ds.sessions), 0)  AS sessions_30d,
           COALESCE(SUM(ds.pageviews), 0) AS pageviews_30d
    FROM projects p
    LEFT JOIN daily_stats ds
      ON ds.project_id = p.id AND ds.day >= (NOW() - interval '30 days')::date
    WHERE p.user_id = ${userId}
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `)) as unknown as Array<Record<string, unknown>>;

  const shared = (await db.execute(sql`
    SELECT p.id, p.name, p.domain, m.role
    FROM project_members m JOIN projects p ON p.id = m.project_id
    WHERE m.user_id = ${userId}
  `)) as unknown as Array<Record<string, unknown>>;

  return c.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt },
    ownedProjects: owned.map((p) => ({
      ...p,
      sessions30d: Number(p.sessions_30d ?? 0),
      pageviews30d: Number(p.pageviews_30d ?? 0),
    })),
    sharedProjects: shared,
  });
});

/** Promote or demote an instance admin. */
admin.patch('/users/:userId', async (c) => {
  const userId = c.req.param('userId') ?? '';
  const body = await c.req.json().catch(() => null);
  const role = body?.role;
  if (role !== 'admin' && role !== 'user') {
    return c.json({ error: 'role must be "admin" or "user"' }, 400);
  }

  // Refuse to remove the last admin — otherwise nobody can administer anything.
  if (role === 'user') {
    const [{ count: admins }] = (await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'
    `)) as unknown as Array<{ count: number }>;
    const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (target?.role === 'admin' && admins <= 1) {
      return c.json({ error: 'Cannot demote the last remaining admin.' }, 409);
    }
  }

  const [updated] = await db.update(users).set({ role }).where(eq(users.id, userId)).returning();
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json({ user: { id: updated.id, email: updated.email, role: updated.role } });
});

/** Instance-wide activity trend, for the admin overview chart. */
admin.get('/activity', async (c) => {
  const days = Math.min(Number(c.req.query('days')) || 30, 180);
  const rows = (await db.execute(sql`
    SELECT day::text AS day,
           SUM(pageviews) AS pageviews,
           SUM(sessions)  AS sessions,
           COUNT(DISTINCT project_id) AS active_projects
    FROM daily_stats
    WHERE day >= (NOW() - ${sql.raw(`interval '${days} days'`)})::date
    GROUP BY day ORDER BY day
  `)) as unknown as Array<Record<string, unknown>>;

  return c.json({
    days,
    series: rows.map((r) => ({
      day: r.day,
      pageviews: Number(r.pageviews ?? 0),
      sessions: Number(r.sessions ?? 0),
      activeProjects: Number(r.active_projects ?? 0),
    })),
  });
});

/** Suggestion inbox. Previously readable by any signed-in user — now admin only. */
admin.get('/suggestions', async (c) => {
  const rows = await db.execute(sql`
    SELECT s.id, s.message, s.created_at, u.email, u.name
    FROM suggestions s LEFT JOIN users u ON s.user_id = u.id
    ORDER BY s.created_at DESC
    LIMIT 500
  `);
  return c.json({ suggestions: rows });
});

admin.delete('/suggestions/:id', async (c) => {
  await db.execute(sql`DELETE FROM ${suggestions} WHERE id = ${c.req.param('id')}::uuid`);
  return c.json({ ok: true });
});

export default admin;
