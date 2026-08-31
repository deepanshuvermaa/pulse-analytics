import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { projects } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { redis, touchLive, rateLimit } from '../lib/redis.js';
import { enqueue, type QueuedEvent } from '../lib/queue.js';
import { resolveVisitor, resolveSession, clientIp } from '../lib/identity.js';
import { parseAgent, countryFrom, regionFrom, cityFrom } from '../lib/ua.js';
import { classify, extractUtm, parseHost, isSelfReferral } from '../lib/referrer.js';
import { pathExcluded } from '../lib/match.js';
import { env } from '../config.js';

const collect = new Hono();

/** Event types the collector will accept. Anything else is dropped. */
const EVENT_TYPES = [
  'pageview', 'custom', 'click', 'rage_click', 'dead_click', 'js_error',
  'performance', 'form_start', 'form_submit', 'form_abandon', 'quick_back',
  'scroll', 'session_end', 'identify',
] as const;

const singleEvent = z.object({
  t: z.enum(EVENT_TYPES).default('pageview'),
  n: z.string().max(120).nullish(),
  u: z.string().max(2048).nullish(),
  r: z.string().max(2048).nullish(),
  ts: z.string().max(40).nullish(),
  props: z.record(z.unknown()).nullish(),
});

const payloadSchema = z.object({
  p: z.string().min(1).max(24),
  /** Durable visitor id from localStorage — only honoured in persistent mode. */
  d: z.string().max(64).nullish(),
  /** Application user id from `pulse('identify', …)`. */
  uid: z.string().max(120).nullish(),
  /** Batched events share the envelope fields above. */
  b: z.array(singleEvent).max(50).optional(),
}).and(singleEvent.partial());

type ProjectConfig = {
  id: string;
  domain: string;
  isActive: boolean;
  identityMode: 'cookieless' | 'persistent';
  excludedPaths: string[];
  excludedIps: string[];
};

const PROJECT_CACHE_TTL = 300;

async function loadProject(projectId: string): Promise<ProjectConfig | null> {
  const key = `proj:${projectId}`;
  const hit = await redis.get(key);
  if (hit) {
    try {
      return JSON.parse(hit) as ProjectConfig;
    } catch {
      /* fall through to a fresh read */
    }
  }

  const row = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!row) {
    // Negative-cache unknown ids briefly so a spam loop can't hammer Postgres.
    await redis.set(key, 'null', 'EX', 30);
    return null;
  }

  const config: ProjectConfig = {
    id: row.id,
    domain: row.domain,
    isActive: row.isActive,
    identityMode: row.identityMode === 'persistent' ? 'persistent' : 'cookieless',
    excludedPaths: row.excludedPaths ?? [],
    excludedIps: row.excludedIps ?? [],
  };
  await redis.set(key, JSON.stringify(config), 'EX', PROJECT_CACHE_TTL);
  return config;
}

export async function invalidateProjectConfig(projectId: string): Promise<void> {
  await redis.del(`proj:${projectId}`);
}

/** Strip the query string down to the params that carry meaning. */
function normalisePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  const path = value.split('#')[0];
  const [base] = path.split('?');
  const clean = (base || '/').slice(0, 1024);
  return clean.startsWith('/') ? clean : `/${clean}`;
}

function safeTimestamp(input: string | null | undefined): Date {
  if (!input) return new Date();
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return new Date();
  const now = Date.now();
  // Reject clock-skewed clients: more than 5 min ahead or 24h behind.
  if (parsed.getTime() > now + 300_000 || parsed.getTime() < now - 86_400_000) return new Date();
  return parsed;
}

async function readBody(c: { req: { json(): Promise<unknown>; text(): Promise<string> } }): Promise<unknown> {
  // sendBeacon and no-cors fetch both arrive as text/plain.
  try {
    return await c.req.json();
  } catch {
    try {
      return JSON.parse(await c.req.text());
    } catch {
      return null;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/collect — browser tracker
// ─────────────────────────────────────────────────────────────

collect.post('/', async (c) => {
  const raw = await readBody(c);
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return c.body(null, 204); // never surface schema detail to the page

  const body = parsed.data;
  const project = await loadProject(body.p);
  if (!project || !project.isActive) return c.body(null, 204);

  const headers = { get: (n: string) => c.req.header(n) };
  const userAgent = c.req.header('user-agent') || '';
  const agent = parseAgent(userAgent);
  if (agent.isBot) return c.body(null, 204);

  const ip = clientIp(headers);
  if (project.excludedIps.includes(ip)) return c.body(null, 204);

  // Identity, sessionisation and rate limiting all live in Redis. If it is
  // unreachable we answer 503 rather than inventing an identity — the tracker
  // persists the batch to localStorage on a non-2xx and replays it later, so
  // the data is delayed rather than lost or misattributed.
  let identity: Awaited<ReturnType<typeof resolveVisitor>>;
  let sessionId: string;
  try {
    identity = await resolveVisitor({
      projectId: project.id,
      ip,
      userAgent,
      durableId: body.d ?? null,
      userId: body.uid ?? null,
      identityMode: project.identityMode,
    });

    const allowed = await rateLimit(
      `rl:${project.id}:${identity.visitorId}`,
      env.RATE_LIMIT_EVENTS,
      env.RATE_LIMIT_WINDOW_SEC,
    );
    if (!allowed) return c.body(null, 429);

    ({ sessionId } = await resolveSession(project.id, identity.visitorId));
  } catch (e) {
    console.error('[collect] identity unavailable:', e instanceof Error ? e.message : e);
    return c.body(null, 503);
  }

  const country = countryFrom(headers);
  const region = regionFrom(headers);
  const city = cityFrom(headers);

  const batch = body.b?.length ? body.b : [{ t: body.t ?? 'pageview', n: body.n, u: body.u, r: body.r, ts: body.ts, props: body.props }];

  let livePath: string | null = null;

  for (const item of batch) {
    const path = normalisePath(item.u);
    if (pathExcluded(path, project.excludedPaths)) continue;

    const utm = extractUtm(item.u);
    const referrerHost = parseHost(item.r);
    // A referrer pointing at the customer's own domain is internal navigation,
    // not an acquisition source.
    const externalReferrer = isSelfReferral(referrerHost, project.domain) ? null : item.r ?? null;
    const info = classify(externalReferrer, utm);

    const event: QueuedEvent = {
      projectId: project.id,
      type: item.t ?? 'pageview',
      name: item.n?.slice(0, 120) ?? null,
      path,
      referrerHost: info.host,
      source: info.source,
      channel: info.channel,
      visitorId: identity.visitorId,
      sessionId,
      userId: body.uid?.slice(0, 120) ?? null,
      country,
      region,
      city,
      device: agent.device,
      browser: agent.browser,
      os: agent.os,
      utmSource: utm.source ?? null,
      utmMedium: utm.medium ?? null,
      utmCampaign: utm.campaign ?? null,
      utmTerm: utm.term ?? null,
      utmContent: utm.content ?? null,
      payload: item.props ?? null,
      timestamp: safeTimestamp(item.ts).toISOString(),
    };

    await enqueue(event);
    if (event.type === 'pageview') livePath = path;
  }

  // Live counts are cosmetic — never fail an accepted event over them.
  if (livePath !== null) {
    try {
      await touchLive(project.id, identity.visitorId, livePath);
    } catch {
      /* ignore */
    }
  }

  return c.body(null, 204);
});

// ─────────────────────────────────────────────────────────────
// POST /api/collect/server — trusted server-side ingestion
//
// Authenticated with the project's secret write key, so a backend can record
// events (payment_succeeded, subscription_cancelled) the browser must not be
// trusted to report. Identity comes from the caller, not from a fingerprint.
// ─────────────────────────────────────────────────────────────

const serverEventSchema = z.object({
  event: z.string().min(1).max(120),
  userId: z.string().min(1).max(120),
  path: z.string().max(2048).nullish(),
  properties: z.record(z.unknown()).nullish(),
  timestamp: z.string().max(40).nullish(),
});

collect.post('/server', async (c) => {
  const authHeader = c.req.header('authorization') || '';
  const writeKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!writeKey) return c.json({ error: 'Missing write key' }, 401);

  const project = await db.query.projects.findFirst({ where: eq(projects.writeKey, writeKey) });
  if (!project || !project.isActive) return c.json({ error: 'Invalid write key' }, 401);

  const parsed = serverEventSchema.safeParse(await readBody(c));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const body = parsed.data;

  const identity = await resolveVisitor({
    projectId: project.id,
    ip: '',
    userAgent: '',
    userId: body.userId,
    identityMode: 'persistent',
  });
  const { sessionId } = await resolveSession(project.id, identity.visitorId);

  await enqueue({
    projectId: project.id,
    type: 'custom',
    name: body.event.slice(0, 120),
    path: normalisePath(body.path),
    referrerHost: null,
    source: 'Server',
    channel: 'Other',
    visitorId: identity.visitorId,
    sessionId,
    userId: body.userId,
    country: null,
    region: null,
    city: null,
    device: 'desktop',
    browser: 'Server',
    os: 'Server',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
    payload: body.properties ?? null,
    timestamp: safeTimestamp(body.timestamp).toISOString(),
  });

  return c.json({ ok: true }, 202);
});

export default collect;
