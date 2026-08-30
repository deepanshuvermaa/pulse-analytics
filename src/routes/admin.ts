import { Hono } from 'hono';
import { db } from '../db/index.js';
import { users, projects, suggestions } from '../db/schema.js';
import { count, desc, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { requireInstanceAdmin } from '../middleware/project.js';
import { queueDepth, pendingDepth } from '../lib/queue.js';
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
