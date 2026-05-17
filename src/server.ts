import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import { env } from './config.js';
import { initDB } from './db/index.js';
import auth from './routes/auth.js';
import collect from './routes/collect.js';
import projectsRouter from './routes/projects.js';
import analytics from './routes/analytics.js';
import admin from './routes/admin.js';
import suggestions from './routes/suggestions.js';

const app = new Hono();

// Middleware
app.use('*', logger());

// Collector — open to all origins, no credentials (tracker sends from any domain)
app.use('/api/collect', cors({ origin: '*', credentials: false }));

// All other API routes — restricted origin with credentials
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/collect')) return next();
  return cors({
    origin: env.NODE_ENV === 'production' ? env.CORS_ORIGIN : '*',
    credentials: true,
  })(c, next);
});

// Static assets (video, tracker)
app.get('/pulsehero.mp4', serveStatic({ path: './public/pulsehero.mp4' }));
app.use('/t.js', cors({ origin: '*' }));
app.get('/t.js', serveStatic({ path: './public/t.js' }));

// Routes
app.route('/api/auth', auth);
app.route('/api/collect', collect);
app.route('/api/projects', projectsRouter);
app.route('/api/analytics', analytics);
app.route('/api/admin', admin);
app.route('/api/suggestions', suggestions);

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Serve frontend in production
if (env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist/client' }));
  app.get('/*', serveStatic({ path: './dist/client/index.html' }));
}

// Start with DB init
initDB().then(() => {
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`🚀 Pulse Analytics running on http://localhost:${info.port}`);
  });
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });

export default app;
