import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import { env } from './config.js';
import { initDB, closeDB } from './db/index.js';
import { connectRedis, redis, redisBlocking } from './lib/redis.js';
import { queueDepth } from './lib/queue.js';

import auth from './routes/auth.js';
import collect from './routes/collect.js';
import projectsRouter from './routes/projects.js';
import analytics from './routes/analytics.js';
import goals from './routes/goals.js';
import funnels from './routes/funnels.js';
import alertsRouter from './routes/alerts.js';
import share from './routes/share.js';
import admin from './routes/admin.js';
import suggestions from './routes/suggestions.js';
import v1 from './routes/v1.js';
import payments from './routes/payments.js';
import mcpServer from './mcp/server.js';

import { startIngestWorker, stopIngestWorker } from './workers/ingest.js';
import { startRollupWorker, stopRollupWorker } from './workers/rollup.js';
import { startAlertWorker, stopAlertWorker } from './workers/alerts.js';

const app = new Hono();

/** Exposed on /health and /ready so a stuck deploy is diagnosable from outside. */
const startupState: { phase: string; error: string | null } = { phase: 'starting', error: null };

app.use('*', logger());

// The collector is called cross-origin from every customer site, so it is open
// and credential-free. Everything else is same-origin with credentials.
app.use('/api/collect/*', cors({ origin: '*', credentials: false, allowMethods: ['POST', 'OPTIONS'] }));
app.use('/api/collect', cors({ origin: '*', credentials: false, allowMethods: ['POST', 'OPTIONS'] }));

app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/collect')) return next();
  return cors({
    origin: env.IS_PROD ? env.CORS_ORIGIN : '*',
    credentials: true,
  })(c, next);
});

// Tracker script — cached hard, served to any origin.
app.use('/t.js', cors({ origin: '*' }));
app.get('/t.js', async (c, next) => {
  c.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  c.header('Content-Type', 'application/javascript; charset=utf-8');
  return next();
});
app.get('/t.js', serveStatic({ path: './public/t.js' }));
app.get('/pulsehero.mp4', serveStatic({ path: './public/pulsehero.mp4' }));

app.route('/api/auth', auth);
app.route('/api/collect', collect);
app.route('/api/projects', projectsRouter);
app.route('/api/analytics', analytics);
app.route('/api/goals', goals);
app.route('/api/funnels', funnels);
app.route('/api/alerts', alertsRouter);
app.route('/api/share', share);
app.route('/api/admin', admin);
app.route('/api/suggestions', suggestions);

// Read-only public API for scripts and AI agents, keyed per project.
app.use('/api/v1/*', cors({ origin: '*', credentials: false, allowMethods: ['GET', 'OPTIONS'] }));
app.route('/api/v1', v1);
app.route('/api/payments', payments);

/**
 * Liveness. Deliberately dependency-free and always 200 while the process runs.
 *
 * This is what the platform healthcheck hits. Gating it on Redis and Postgres
 * meant a transient dependency blip failed the deploy and rolled the release
 * back, which is exactly backwards: the app can still serve cached pages and
 * queue events while a dependency recovers.
 */
app.get('/health', (c) =>
  c.json({
    status: 'ok',
    version: env.GIT_SHA,
    startup: startupState.phase,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  }),
);

/** Readiness — 503 until migrations have finished, for rolling deploys. */
app.get('/ready', (c) =>
  startupState.phase === 'ready'
    ? c.json({ status: 'ready' })
    : c.json({ status: startupState.phase, error: startupState.error }, 503),
);

/** Deep check for humans and uptime monitors. Never used to gate a deploy. */
app.get('/health/deep', async (c) => {
  const withTimeout = <T,>(p: Promise<T>, ms: number) =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    await withTimeout(redis.ping(), 3000);
    checks.redis = 'ok';
  } catch (e) {
    checks.redis = e instanceof Error ? e.message : 'unreachable';
    healthy = false;
  }

  try {
    const { db } = await import('./db/index.js');
    const { sql } = await import('drizzle-orm');
    await withTimeout(db.execute(sql`SELECT 1`), 5000);
    checks.database = 'ok';
  } catch (e) {
    checks.database = e instanceof Error ? e.message : 'unreachable';
    healthy = false;
  }

  let queue = -1;
  try {
    queue = await withTimeout(queueDepth(), 3000);
  } catch {
    /* reported as -1 */
  }

  return c.json(
    { status: healthy ? 'ok' : 'degraded', startup: startupState.phase, checks, ingestQueue: queue, timestamp: new Date().toISOString() },
    healthy ? 200 : 503,
  );
});

// SPA in production. Order matters: assets first, then the catch-all.
if (env.IS_PROD) {
  app.use('/assets/*', serveStatic({ root: './dist/client' }));
  app.get('/*', serveStatic({ root: './dist/client' }));
  app.get('/*', serveStatic({ path: './dist/client/index.html' }));
}

/**
 * Startup runs *after* the port is bound, so a slow migration or an unreachable
 * dependency can never stop the process from answering a healthcheck.
 */
async function initialise(): Promise<void> {
  try {
    startupState.phase = 'connecting-redis';
    await connectRedis(); // never throws; degrades instead

    startupState.phase = 'migrating';
    // Schema migrations can take minutes on a large events table.
    await initDB();

    startupState.phase = 'starting-workers';
    startIngestWorker();
    startRollupWorker();
    startAlertWorker();

    startupState.phase = 'ready';
    console.log('✓ Startup complete — workers running');
  } catch (e) {
    startupState.phase = 'failed';
    startupState.error = e instanceof Error ? e.message : String(e);
    // Stay alive and keep serving /health so the failure is visible in logs and
    // on /ready, instead of crash-looping with no diagnostics.
    console.error('Startup failed:', e);
  }
}

async function main(): Promise<void> {
  // Bind first. Everything else happens in the background.
  const server = serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
    console.log(`🚀 Pulse Analytics listening on 0.0.0.0:${info.port} (${env.NODE_ENV})`);
  });

  void initialise();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — draining…`);

    server.close();
    stopRollupWorker();
    stopAlertWorker();
    // Flush whatever the ingest worker still holds before the process exits.
    await stopIngestWorker();

    await Promise.allSettled([closeDB(), redis.quit(), redisBlocking.quit()]);
    console.log('Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  console.error('Fatal startup error:', e);
  process.exit(1);
});

app.use('/mcp/*', cors({ origin: '*', credentials: false, allowMethods: ['GET', 'POST', 'OPTIONS'] }));
app.route('/mcp', mcpServer);

/**
 * Expose the app on `globalThis` so the in-process MCP server can dispatch
 * sub-requests to /api/v1/* without going over the network. Set here, after
 * every route is mounted, so the dispatcher sees the full surface.
 */
(globalThis as { __pulseApp?: { fetch: (r: Request) => Promise<Response> | Response } }).__pulseApp = app as unknown as { fetch: (r: Request) => Promise<Response> | Response };

export default app;
