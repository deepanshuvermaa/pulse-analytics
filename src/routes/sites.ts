import { Hono } from 'hono';
import { z } from 'zod';
import { env } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireProject } from '../middleware/project.js';
import type { AppEnv } from '../lib/types.js';

/**
 * Client websites, built and published by ZeroBuild's agency API. The hub only
 * proxies: ZeroBuild owns the sites, the token stays server-side. Each site is
 * tagged "<projectId>:<leadId|manual>" so a project only sees its own sites.
 */
const router = new Hono<AppEnv>();

router.use('*', authMiddleware);
router.use('/:projectId', requireProject('viewer'));
router.use('/:projectId/*', requireProject('viewer'));

function configured() {
  return Boolean(env.ZEROBUILD_URL && env.ZEROBUILD_TOKEN);
}

async function zb(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.ZEROBUILD_URL.replace(/\/+$/, '')}/api/agency${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Agency-Token': env.ZEROBUILD_TOKEN, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });
}

async function relay(res: Response) {
  const body = await res.json().catch(() => ({ error: `ZeroBuild answered ${res.status}` }));
  return { status: res.status, body };
}

const ownedBy = (projectId: string, site: { leadRef?: string | null }) => String(site.leadRef ?? '').startsWith(`${projectId}:`);

router.get('/:projectId', async (c) => {
  if (!configured()) return c.json({ configured: false, sites: [] });
  const project = c.get('project');
  try {
    const { status, body } = await relay(await zb('/sites'));
    if (status !== 200) return c.json({ configured: true, error: body.error ?? 'ZeroBuild unavailable', sites: [] }, 502);
    return c.json({ configured: true, sites: (body.sites ?? []).filter((s: { leadRef?: string }) => ownedBy(project.id, s)) });
  } catch (e) {
    return c.json({ configured: true, error: e instanceof Error ? e.message : 'ZeroBuild unreachable', sites: [] }, 502);
  }
});

const createSchema = z.object({
  businessName: z.string().min(1).max(200),
  businessType: z.string().max(120).optional(),
  city: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  whatsapp: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
  email: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  services: z.array(z.string().max(120)).max(12).optional(),
  leadId: z.string().max(64).optional(),
});

router.post('/:projectId', requireProject('member'), async (c) => {
  if (!configured()) return c.json({ error: 'Set ZEROBUILD_URL and ZEROBUILD_TOKEN on the hub' }, 503);
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const { leadId, ...site } = parsed.data;
  const leadRef = `${c.get('project').id}:${leadId || 'manual'}`;
  const { status, body } = await relay(await zb('/sites', { method: 'POST', body: JSON.stringify({ ...site, leadRef }) }));
  return c.json(body, status as 201);
});

async function ownedSite(c: { get: (k: 'project') => { id: string }; req: { param: (k: string) => string | undefined } }) {
  const id = c.req.param('siteId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { status, body } = await relay(await zb(`/sites/${id}`));
  return status === 200 && ownedBy(c.get('project').id, body) ? body : null;
}

router.get('/:projectId/:siteId/download', async (c) => {
  if (!configured()) return c.json({ error: 'ZeroBuild not configured' }, 503);
  const site = await ownedSite(c);
  if (!site) return c.json({ error: 'Site not found' }, 404);
  const siteUrl = c.req.query('siteUrl');
  const res = await zb(`/sites/${site.id}/download${siteUrl ? `?siteUrl=${encodeURIComponent(siteUrl)}` : ''}`);
  if (!res.ok) return c.json({ error: 'Download failed' }, 502);
  return c.body(await res.arrayBuffer(), 200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': res.headers.get('content-disposition') ?? 'attachment; filename="site.zip"',
  });
});

const deploySchema = z.object({
  siteUrl: z.string().url().optional(),
  cpanel: z.object({ host: z.string().min(1), user: z.string().min(1), password: z.string().min(1), dir: z.string().optional() }),
});

router.post('/:projectId/:siteId/deploy', requireProject('member'), async (c) => {
  if (!configured()) return c.json({ error: 'ZeroBuild not configured' }, 503);
  const parsed = deploySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const site = await ownedSite(c);
  if (!site) return c.json({ error: 'Site not found' }, 404);
  // FTP credentials pass straight through to ZeroBuild and are never stored here.
  const { status, body } = await relay(await zb(`/sites/${site.id}/deploy`, {
    method: 'POST', body: JSON.stringify({ target: 'cpanel', ...parsed.data }),
  }));
  return c.json(body, status as 200);
});

const catalogSchema = z.object({
  products: z.array(z.object({
    name: z.string().min(1).max(200),
    price: z.union([z.number(), z.string().max(20)]).optional(),
    description: z.string().max(300).optional(),
  })).max(60),
});

/** Billing catalogue → the site's price list (paste/CSV from the billing app, or a sync job). */
router.put('/:projectId/:siteId/catalog', requireProject('member'), async (c) => {
  if (!configured()) return c.json({ error: 'ZeroBuild not configured' }, 503);
  const parsed = catalogSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const site = await ownedSite(c);
  if (!site) return c.json({ error: 'Site not found' }, 404);
  const { status, body } = await relay(await zb(`/sites/${site.id}/catalog`, { method: 'PUT', body: JSON.stringify(parsed.data) }));
  return c.json(body, status as 200);
});

export default router;
