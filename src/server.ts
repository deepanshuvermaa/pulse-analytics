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

import { startIngestWorker, stopIngestWorker } from './workers/ingest.js';
import { startRollupWorker, stopRollupWorker } from './workers/rollup.js';
import { startAlertWorker, stopAlertWorker } from './workers/alerts.js';

const app = new Hono();

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

// Lightweight readiness endpoint — returns 200 as soon as the app process is up.
app.get('/ready', (c) => c.text('ok', 200));

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

app.get('/health', async (c) => {
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'unreachable';
    healthy = false;
  }

  try {
    const { db } = await import('./db/index.js');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`SELECT 1`);
    checks.database = 'ok';
  } catch {
    checks.database = 'unreachable';
    healthy = false;
  }

  return c.json(
    { status: healthy ? 'ok' : 'degraded', checks, ingestQueue: await queueDepth(), timestamp: new Date().toISOString() },
    healthy ? 200 : 503,
  );
});

// SPA in production. Order matters: assets first, then the catch-all.
if (env.IS_PROD) {
  app.use('/assets/*', serveStatic({ root: './dist/client' }));
  app.get('/*', serveStatic({ root: './dist/client' }));
  app.get('/*', serveStatic({ path: './dist/client/index.html' }));
}

async function main(): Promise<void> {
  await connectRedis();
  await initDB();

  startIngestWorker();
  startRollupWorker();
  startAlertWorker();

  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`🚀 Pulse Analytics on http://localhost:${info.port} (${env.NODE_ENV})`);
  });

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

export default app;
