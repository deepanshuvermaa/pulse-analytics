import { Hono } from 'hono';
import { db } from '../db/index.js';
import { events, projects } from '../db/schema.js';
import { eq, and, gte, lte, sql, count, countDistinct, desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { redis } from '../lib/redis.js';
import type { AppEnv } from '../lib/types.js';

const analytics = new Hono<AppEnv>();
analytics.use('*', authMiddleware);

// Helper: validate project ownership
async function getProject(projectId: string, userId: string) {
  return db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, userId)),
  });
}

// GET /api/analytics/:projectId/overview?from=2024-01-01&to=2024-01-31
analytics.get('/:projectId/overview', async (c) => {
  const userId = c.get('userId');
  const project = await getProject(c.req.param('projectId'), userId);
  if (!project) return c.json({ error: 'Not found' }, 404);

  const from = c.req.query('from') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = c.req.query('to') || new Date().toISOString().slice(0, 10);
  const pid = project.id;

  const [stats] = await db.select({
    pageviews: count(),
    visitors: countDistinct(events.visitorId),
    sessions: countDistinct(events.sessionId),
  }).from(events).where(
    and(eq(events.projectId, pid), eq(events.type, 'pageview'), gte(events.timestamp, new Date(from)), lte(events.timestamp, new Date(to + 'T23:59:59')))
  );

  // Live visitors from Redis
  const liveKeys = await redis.keys(`live:${pid}:*`);

  return c.json({
    period: { from, to },
    pageviews: stats.pageviews,
    visitors: stats.visitors,
    sessions: stats.sessions,
    liveVisitors: liveKeys.length,
  });
});

// GET /api/analytics/:projectId/pageviews — daily breakdown
analytics.get('/:projectId/pageviews', async (c) => {
  const userId = c.get('userId');
  const project = await getProject(c.req.param('projectId'), userId);
  if (!project) return c.json({ error: 'Not found' }, 404);

  const from = c.req.query('from') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = c.req.query('to') || new Date().toISOString().slice(0, 10);

  const rows = await db.select({
    date: sql<string>`DATE(${events.timestamp})`.as('date'),
    pageviews: count(),
    visitors: countDistinct(events.visitorId),
  }).from(events).where(
    and(eq(events.projectId, project.id), eq(events.type, 'pageview'), gte(events.timestamp, new Date(from)), lte(events.timestamp, new Date(to + 'T23:59:59')))
  ).groupBy(sql`DATE(${events.timestamp})`).orderBy(sql`DATE(${events.timestamp})`);

  return c.json({ data: rows });
});

// GET /api/analytics/:projectId/pages — top pages
analytics.get('/:projectId/pages', async (c) => {
  const userId = c.get('userId');
  const project = await getProject(c.req.param('projectId'), userId);
  if (!project) return c.json({ error: 'Not found' }, 404);

  const from = c.req.query('from') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const rows = await db.select({
    path: events.path,
    views: count(),
    visitors: countDistinct(events.visitorId),
  }).from(events).where(
    and(eq(events.projectId, project.id), eq(events.type, 'pageview'), gte(events.timestamp, new Date(from)))
  ).groupBy(events.path).orderBy(desc(count())).limit(20);

  return c.json({ data: rows });
});

// GET /api/analytics/:projectId/referrers
analytics.get('/:projectId/referrers', async (c) => {
  const userId = c.get('userId');
  const project = await getProject(c.req.param('projectId'), userId);
  if (!project) return c.json({ error: 'Not found' }, 404);

  const from = c.req.query('from') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const rows = await db.select({
    referrer: events.referrer,
    count: count(),
  }).from(events).where(
    and(eq(events.projectId, project.id), eq(events.type, 'pageview'), gte(events.timestamp, new Date(from)), sql`${events.referrer} IS NOT NULL AND ${events.referrer} != ''`)
  ).groupBy(events.referrer).orderBy(desc(count())).limit(20);

  return c.json({ data: rows });
});

// GET /api/analytics/:projectId/devices
analytics.get('/:projectId/devices', async (c) => {
  const userId = c.get('userId');
  const project = await getProject(c.req.param('projectId'), userId);
  if (!project) return c.json({ error: 'Not found' }, 404);

  const from = c.req.query('from') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const [deviceData, browserData, countryData] = await Promise.all([
    db.select({ device: events.device, count: count() }).from(events).where(
      and(eq(events.projectId, project.id), eq(events.type, 'pageview'), gte(events.timestamp, new Date(from)))
    ).groupBy(events.device).orderBy(desc(count())),

    db.select({ browser: events.browser, count: count() }).from(events).where(
      and(eq(events.projectId, project.id), eq(events.type, 'pageview'), gte(events.timestamp, new Date(from)))
    ).groupBy(events.browser).orderBy(desc(count())).limit(10),

    db.select({ country: events.country, count: count() }).from(events).where(
      and(eq(events.projectId, project.id), eq(events.type, 'pageview'), gte(events.timestamp, new Date(from)), sql`${events.country} IS NOT NULL`)
    ).groupBy(events.country).orderBy(desc(count())).limit(10),
  ]);

  return c.json({ devices: deviceData, browsers: browserData, countries: countryData });
});

// GET /api/analytics/:projectId/live — real-time
analytics.get('/:projectId/live', async (c) => {
  const userId = c.get('userId');
  const project = await getProject(c.req.param('projectId'), userId);
  if (!project) return c.json({ error: 'Not found' }, 404);

  const liveKeys = await redis.keys(`live:${project.id}:*`);
  return c.json({ liveVisitors: liveKeys.length });
});

// GET /api/analytics/:projectId/engagement — DAU/WAU/MAU, returning visitors, rage/dead clicks
analytics.get('/:projectId/engagement', async (c) => {
  const userId = c.get('userId');
  const project = await getProject(c.req.param('projectId'), userId);
  if (!project) return c.json({ error: 'Not found' }, 404);
  const pid = project.id;

  const now = new Date();
  const day1 = new Date(now); day1.setHours(0,0,0,0);
  const day7 = new Date(now); day7.setDate(day7.getDate() - 7);
  const day30 = new Date(now); day30.setDate(day30.getDate() - 30);

  const [dau, wau, mau, returning, rageClicks, deadClicks] = await Promise.all([
    db.select({ count: countDistinct(events.visitorId) }).from(events).where(and(eq(events.projectId, pid), eq(events.type, 'pageview'), gte(events.timestamp, day1))),
    db.select({ count: countDistinct(events.visitorId) }).from(events).where(and(eq(events.projectId, pid), eq(events.type, 'pageview'), gte(events.timestamp, day7))),
    db.select({ count: countDistinct(events.visitorId) }).from(events).where(and(eq(events.projectId, pid), eq(events.type, 'pageview'), gte(events.timestamp, day30))),
    // Returning visitors: visitors who appeared on more than 1 distinct day in last 30 days
    db.execute(sql`SELECT COUNT(*) as count FROM (SELECT visitor_id FROM events WHERE project_id = ${pid} AND type = 'pageview' AND timestamp >= ${day30} GROUP BY visitor_id HAVING COUNT(DISTINCT DATE(timestamp)) > 1) sub`),
    db.select({ count: count() }).from(events).where(and(eq(events.projectId, pid), eq(events.type, 'rage_click'), gte(events.timestamp, day7))),
    db.select({ count: count() }).from(events).where(and(eq(events.projectId, pid), eq(events.type, 'dead_click'), gte(events.timestamp, day7))),
  ]);

  const returningCount = Array.isArray(returning) ? (returning[0] as any)?.count || 0 : 0;

  return c.json({
    dau: dau[0].count,
    wau: wau[0].count,
    mau: mau[0].count,
    returningVisitors: Number(returningCount),
    rageClicks: rageClicks[0].count,
    deadClicks: deadClicks[0].count,
    dauWauRatio: wau[0].count > 0 ? Math.round((dau[0].count / wau[0].count) * 100) : 0,
  });
});

// GET /api/analytics/:projectId/errors — JS errors
analytics.get('/:projectId/errors', async (c) => {
  const userId = c.get('userId');
  const project = await getProject(c.req.param('projectId'), userId);
  if (!project) return c.json({ error: 'Not found' }, 404);

  const from = c.req.query('from') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const errors = await db.select({
    id: events.id,
    path: events.path,
    payload: events.payload,
    timestamp: events.timestamp,
  }).from(events).where(
    and(eq(events.projectId, project.id), eq(events.type, 'js_error'), gte(events.timestamp, new Date(from)))
  ).orderBy(desc(events.timestamp)).limit(50);

  const errorCount = await db.select({ count: count() }).from(events).where(
    and(eq(events.projectId, project.id), eq(events.type, 'js_error'), gte(events.timestamp, new Date(from)))
  );

  return c.json({ errors, total: errorCount[0].count });
});

export default analytics;
