import { Hono } from 'hono';
import { db } from '../db/index.js';
import { users, projects, events } from '../db/schema.js';
import { eq, count, countDistinct, desc, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../lib/types.js';

const admin = new Hono<AppEnv>();
admin.use('*', authMiddleware);

// Admin guard
admin.use('*', async (c, next) => {
  const userId = c.get('userId');
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  return next();
});

// GET /api/admin/stats
admin.get('/stats', async (c) => {
  const [userCount] = await db.select({ count: count() }).from(users);
  const [projectCount] = await db.select({ count: count() }).from(projects);
  const [eventCount] = await db.select({ count: count() }).from(events);
  return c.json({ users: userCount.count, projects: projectCount.count, events: eventCount.count });
});

// GET /api/admin/users
admin.get('/users', async (c) => {
  const allUsers = await db.select({
    id: users.id,
    email: users.email,
    name: users.name,
    role: users.role,
    createdAt: users.createdAt,
    projectCount: sql<number>`(SELECT COUNT(*) FROM projects WHERE projects.user_id = users.id)`,
  }).from(users).orderBy(desc(users.createdAt));
  return c.json({ users: allUsers });
});

export default admin;
