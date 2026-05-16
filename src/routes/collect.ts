import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { events, projects } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { redis } from '../lib/redis.js';
import UAParser from 'ua-parser-js';

const collect = new Hono();

const eventSchema = z.object({
  project_id: z.string().min(1),
  type: z.enum(['pageview', 'click', 'scroll', 'session_end', 'custom']),
  visitor_id: z.string().min(1),
  session_id: z.string().min(1),
  path: z.string().optional(),
  referrer: z.string().nullable().optional(),
  timestamp: z.string().optional(),
  payload: z.any().optional(),
});

// Event buffer for batch inserts
let eventBuffer: any[] = [];
let flushTimer: NodeJS.Timeout | null = null;
const BATCH_SIZE = 50;
const FLUSH_INTERVAL = 5000;

async function flushEvents() {
  if (eventBuffer.length === 0) return;
  const batch = eventBuffer.splice(0, eventBuffer.length);
  try {
    await db.insert(events).values(batch);
  } catch (e) {
    console.error('Failed to flush events:', e);
    eventBuffer.unshift(...batch); // re-queue on failure
  }
}

function scheduleFlush() {
  if (!flushTimer) {
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      await flushEvents();
    }, FLUSH_INTERVAL);
  }
}

// POST /api/collect
collect.post('/', async (c) => {
  const body = eventSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: 'Invalid event' }, 400);

  const data = body.data;

  // Rate limit: 100 events per visitor per minute
  const rateKey = `rl:${data.project_id}:${data.visitor_id}`;
  const count = await redis.incr(rateKey);
  if (count === 1) await redis.expire(rateKey, 60);
  if (count > 100) return c.json({ error: 'Rate limited' }, 429);

  // Validate project exists (cached in Redis)
  const projCacheKey = `proj:${data.project_id}`;
  let projectDomain = await redis.get(projCacheKey);
  if (!projectDomain) {
    const proj = await db.query.projects.findFirst({ where: eq(projects.id, data.project_id) });
    if (!proj || !proj.isActive) return c.json({ error: 'Invalid project' }, 404);
    projectDomain = proj.domain;
    await redis.set(projCacheKey, proj.domain, 'EX', 300);
  }

  // Origin validation (optional in dev)
  const origin = c.req.header('origin') || c.req.header('referer') || '';
  if (projectDomain !== '*' && origin && !origin.includes(projectDomain)) {
    return c.json({ error: 'Origin mismatch' }, 403);
  }

  // Parse user agent
  const ua = new UAParser(c.req.header('user-agent') || '');
  const device = ua.getDevice().type || 'desktop';
  const browser = ua.getBrowser().name || 'Unknown';
  const os = ua.getOS().name || 'Unknown';

  // Country from headers (Railway/Cloudflare provide this)
  const country = c.req.header('cf-ipcountry') || c.req.header('x-vercel-ip-country') || null;

  // Buffer event for batch insert
  eventBuffer.push({
    projectId: data.project_id,
    type: data.type,
    path: data.path,
    referrer: data.referrer,
    visitorId: data.visitor_id,
    sessionId: data.session_id,
    country,
    device,
    browser,
    os,
    payload: data.payload || null,
    timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
  });

  if (eventBuffer.length >= BATCH_SIZE) await flushEvents();
  else scheduleFlush();

  // Update real-time counters in Redis
  const now = new Date();
  const dayKey = `stats:${data.project_id}:${now.toISOString().slice(0, 10)}`;
  const liveKey = `live:${data.project_id}`;

  if (data.type === 'pageview') {
    await redis.hincrby(dayKey, 'pageviews', 1);
    await redis.sadd(`${dayKey}:visitors`, data.visitor_id);
    await redis.expire(dayKey, 86400 * 2);
    await redis.expire(`${dayKey}:visitors`, 86400 * 2);
    // Live visitors (5min TTL per visitor)
    await redis.set(`${liveKey}:${data.visitor_id}`, '1', 'EX', 300);
  }

  return c.body(null, 204);
});

// Flush remaining events on process exit
process.on('SIGTERM', flushEvents);
process.on('SIGINT', flushEvents);

export default collect;
