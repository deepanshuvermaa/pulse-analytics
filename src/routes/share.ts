import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { projects } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { resolveRange } from '../lib/time.js';
import { parseFilters } from '../lib/filters.js';
import { summaryWithComparison, timeseries, pages, breakdown } from '../lib/reports.js';
import { liveCount } from '../lib/redis.js';
import { createAccessToken, verifyAccessToken } from '../lib/auth.js';
import type { Project } from '../lib/types.js';

/**
 * Read-only public dashboards.
 *
 * No account required. Optionally password protected — the password is exchanged
 * once for a short-lived token scoped to that share slug, so the password itself
 * is never replayed on every request.
 */
const share = new Hono();

const SHARE_SUBJECT = (slug: string) => `share:${slug}`;

async function loadShared(slug: string): Promise<Project | null> {
  if (!slug || slug.length > 32) return null;
  const project = await db.query.projects.findFirst({ where: eq(projects.shareSlug, slug) });
  return project && project.isActive ? project : null;
}

async function authorised(c: { req: { header(n: string): string | undefined } }, project: Project, slug: string): Promise<boolean> {
  if (!project.sharePasswordHash) return true;
  const header = c.req.header('authorization') || '';
  if (!header.startsWith('Bearer ')) return false;
  try {
    return (await verifyAccessToken(header.slice(7))) === SHARE_SUBJECT(slug);
  } catch {
    return false;
  }
}

share.get('/:slug/meta', async (c) => {
  const slug = c.req.param('slug');
  const project = await loadShared(slug);
  if (!project) return c.json({ error: 'Not found' }, 404);
  return c.json({
    name: project.name,
    domain: project.domain,
    timezone: project.timezone,
    requiresPassword: !!project.sharePasswordHash,
  });
});

share.post('/:slug/unlock', async (c) => {
  const slug = c.req.param('slug');
  const project = await loadShared(slug);
  if (!project) return c.json({ error: 'Not found' }, 404);
  if (!project.sharePasswordHash) return c.json({ token: null, open: true });

  const body = await c.req.json().catch(() => ({}));
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!(await bcrypt.compare(password, project.sharePasswordHash))) {
    return c.json({ error: 'Incorrect password' }, 401);
  }

  return c.json({ token: await createAccessToken(SHARE_SUBJECT(slug)) });
});

share.get('/:slug/dashboard', async (c) => {
  const slug = c.req.param('slug');
  const project = await loadShared(slug);
  if (!project) return c.json({ error: 'Not found' }, 404);
  if (!(await authorised(c, project, slug))) return c.json({ error: 'Password required' }, 401);

  const q = c.req.query.bind(c.req);
  const range = resolveRange(
    { preset: q('preset'), from: q('from'), to: q('to'), granularity: q('granularity'), compare: q('compare') },
    project.timezone,
  );
  // Public dashboards are deliberately unfiltered — no segment probing by strangers.
  const filters = parseFilters(() => undefined);

  const [stats, series, topPages, sources, countries, devices, live] = await Promise.all([
    summaryWithComparison(project.id, range, filters),
    timeseries(project.id, range, filters),
    pages(project.id, range, filters, 15),
    breakdown(project.id, range, filters, 'source', 12),
    breakdown(project.id, range, filters, 'country', 12),
    breakdown(project.id, range, filters, 'device', 5),
    liveCount(project.id),
  ]);

  return c.json({
    project: { name: project.name, domain: project.domain, timezone: project.timezone },
    range: { from: range.fromDate, to: range.toDate, preset: range.preset, granularity: range.granularity },
    stats,
    series,
    pages: topPages,
    sources,
    countries,
    devices,
    liveVisitors: live,
  });
});

export default share;
