import { Hono } from 'hono';
import { z } from 'zod';
import { db, sql as pg } from '../db/index.js';
import { projects } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { rateLimit } from '../lib/redis.js';
import { resolveVisitor, clientIp } from '../lib/identity.js';
import { parseAgent } from '../lib/ua.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireProject } from '../middleware/project.js';
import {
  normalizePhone, normalizeEmail, cleanText, isLeadStatus, LEAD_STATUSES, HOT_SCORE, type LeadInput,
} from '../lib/leads.js';
import { upsertLead, updateLead, sessionAttribution, notifyHotLead } from '../lib/leads-store.js';
import type { AppEnv, Project } from '../lib/types.js';

const router = new Hono<AppEnv>();

const leadSchema = z.object({
  phone: z.union([z.string().max(40), z.number()]).nullish(),
  email: z.string().max(255).nullish(),
  name: z.string().max(200).nullish(),
  business_name: z.string().max(300).nullish(),
  business_type: z.string().max(120).nullish(),
  city: z.string().max(120).nullish(),
  address: z.string().max(1000).nullish(),
  website: z.string().max(1000).nullish(),
  message: z.string().max(4000).nullish(),
  source: z.string().max(40).nullish(),
  ref: z.union([z.string().max(120), z.number()]).nullish(),
  status: z.string().max(16).nullish(),
  notes: z.string().max(4000).nullish(),
  channel: z.string().max(32).nullish(),
  utm_source: z.string().max(120).nullish(),
  utm_medium: z.string().max(120).nullish(),
  utm_campaign: z.string().max(120).nullish(),
  attributes: z.record(z.unknown()).nullish(),
  occurred_at: z.string().max(40).nullish(),
  country_code: z.string().regex(/^\d{1,3}$/).nullish(),
});
type LeadPayload = z.infer<typeof leadSchema>;

function sourceName(raw: string | null | undefined, fallback: string): string {
  const s = (raw ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return s || fallback;
}

function occurredAt(raw: string | null | undefined): Date {
  const parsed = raw ? new Date(raw) : new Date();
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > Date.now()) return new Date();
  return parsed;
}

/** Turn any source's payload into a normalised LeadInput, or explain why not. */
export function toLeadInput(body: LeadPayload, fallbackSource: string): { input: LeadInput } | { error: string } {
  const phone = normalizePhone(body.phone, body.country_code ?? '91');
  const email = normalizeEmail(body.email);
  if (!phone && !email) return { error: 'phone or email required' };

  const source = sourceName(body.source, fallbackSource);
  const ref = body.ref === null || body.ref === undefined || body.ref === '' ? null : String(body.ref);
  const attributes = body.attributes ?? {};

  return {
    input: {
      phone,
      email,
      name: cleanText(body.name, 120),
      businessName: cleanText(body.business_name, 200),
      businessType: cleanText(body.business_type, 80),
      city: cleanText(body.city, 80),
      address: cleanText(body.address, 500),
      website: cleanText(body.website, 500),
      message: cleanText(body.message, 4000),
      source,
      ref: ref ? (ref.includes(':') ? ref : `${source}:${ref}`).slice(0, 120) : null,
      status: isLeadStatus(body.status) ? body.status : null,
      notes: cleanText(body.notes, 4000),
      channel: cleanText(body.channel, 32),
      referrerSource: null,
      landingPath: null,
      utmSource: cleanText(body.utm_source, 120),
      utmMedium: cleanText(body.utm_medium, 120),
      utmCampaign: cleanText(body.utm_campaign, 120),
      sessionId: null,
      visitorId: null,
      // Attributes are free-form per source; cap them so one bad import can't bloat rows.
      attributes: JSON.stringify(attributes).length <= 8000 ? attributes : {},
      occurredAt: occurredAt(body.occurred_at),
    },
  };
}

async function projectByWriteKey(authorization: string | undefined): Promise<Project | null> {
  const writeKey = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!writeKey) return null;
  const project = await db.query.projects.findFirst({ where: eq(projects.writeKey, writeKey) });
  return project && project.isActive ? project : null;
}

// ─────────────────────────────────────────────────────────────
// POST /api/leads/capture — browser forms on a tracked site
// ─────────────────────────────────────────────────────────────

const captureSchema = leadSchema.pick({
  phone: true, email: true, name: true, business_name: true, business_type: true, city: true, message: true,
}).extend({
  p: z.string().min(1).max(24),
  /** Honeypot: real visitors never fill it. */
  hp: z.string().max(200).nullish(),
  /** Tracker's durable id, when the site runs the tracker in persistent mode. */
  d: z.string().max(64).nullish(),
  /** Which form: "trial", "enquiry", "whatsapp" … becomes the lead's source. */
  form: z.string().max(40).nullish(),
});

const PUBLIC_SOURCES = new Set(['website_form', 'whatsapp', 'enquiry', 'trial', 'callback']);

router.post('/capture', async (c) => {
  const parsed = captureSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid lead' }, 400);
  const body = parsed.data;
  if (body.hp) return c.json({ ok: true }, 202);

  const project = await db.query.projects.findFirst({ where: eq(projects.id, body.p) });
  if (!project || !project.isActive) return c.json({ ok: true }, 202);

  const headers = { get: (n: string) => c.req.header(n) };
  const userAgent = c.req.header('user-agent') || '';
  if (parseAgent(userAgent).isBot) return c.json({ ok: true }, 202);
  const ip = clientIp(headers);
  if (!(await rateLimit(`rl:lead:${project.id}:${ip}`, 10, 3600))) return c.json({ error: 'Too many submissions' }, 429);

  const form = sourceName(body.form, 'website_form');
  const result = toLeadInput({ ...body, source: PUBLIC_SOURCES.has(form) ? form : 'website_form' }, 'website_form');
  if ('error' in result) return c.json({ error: result.error }, 400);
  const input = result.input;

  // Same identity the tracker gets, so the lead inherits the channel of the visit
  // that produced it ("AI Assistant", "Organic Search" …).
  try {
    const { visitorId } = await resolveVisitor({
      projectId: project.id, ip, userAgent, durableId: body.d ?? null, userId: null,
      identityMode: project.identityMode === 'persistent' ? 'persistent' : 'cookieless',
    });
    const attribution = await sessionAttribution(project.id, visitorId);
    Object.assign(input, { visitorId, ...attribution });
  } catch (e) {
    console.error('[leads] attribution unavailable:', e instanceof Error ? e.message : e);
  }

  const saved = await upsertLead(project.id, input);
  if (saved.becameHot) void notifyHotLead(project.name, saved.id, input, saved.score);
  return c.json({ ok: true }, 202);
});

// ─────────────────────────────────────────────────────────────
// POST /api/leads/ingest — server-to-server (scraper sync, Harvey, imports)
// ─────────────────────────────────────────────────────────────

const ingestSchema = z.object({
  source: z.string().max(40).nullish(),
  leads: z.array(z.unknown()).min(1).max(500),
});

router.post('/ingest', async (c) => {
  const project = await projectByWriteKey(c.req.header('authorization'));
  if (!project) return c.json({ error: 'Invalid write key' }, 401);

  const parsed = ingestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const batchSource = sourceName(parsed.data.source, 'import');

  let created = 0;
  let merged = 0;
  const rejected: Array<{ index: number; error: string }> = [];
  for (const [index, raw] of parsed.data.leads.entries()) {
    const item = leadSchema.safeParse(raw);
    if (!item.success) { rejected.push({ index, error: 'invalid fields' }); continue; }
    const result = toLeadInput(item.data, batchSource);
    if ('error' in result) { rejected.push({ index, error: result.error }); continue; }
    try {
      const saved = await upsertLead(project.id, result.input);
      if (saved.created) created++; else merged++;
      if (saved.becameHot) void notifyHotLead(project.name, saved.id, result.input, saved.score);
    } catch (e) {
      rejected.push({ index, error: e instanceof Error ? e.message : 'failed' });
    }
  }
  return c.json({ ok: true, created, merged, rejected });
});

// ─────────────────────────────────────────────────────────────
// Dashboard — JWT + project access
// ─────────────────────────────────────────────────────────────

router.use('*', authMiddleware);
router.use('/:projectId', requireProject('viewer'));
router.use('/:projectId/*', requireProject('viewer'));

const LIST_COLUMNS = pg`
  id, phone, email, name, business_name, business_type, city, source, sources, status, score, touches,
  channel, referrer_source, landing_path, utm_campaign, notes, first_seen_at, last_seen_at`;

function listFilters(projectId: string, q: (k: string) => string | undefined) {
  const status = q('status');
  const source = q('source');
  const channel = q('channel');
  const search = (q('q') || '').trim().slice(0, 100);
  const minScore = Number(q('min_score'));
  const digits = search.replace(/\D/g, '');
  return pg`
    project_id = ${projectId}
    ${status && status !== 'all' ? (status === 'open' ? pg`AND status IN ('new','contacted','qualified')` : pg`AND status = ${status}`) : pg``}
    ${source ? pg`AND ${source} = ANY(sources)` : pg``}
    ${channel ? pg`AND channel = ${channel}` : pg``}
    ${Number.isFinite(minScore) && minScore > 0 ? pg`AND score >= ${minScore}` : pg``}
    ${search ? pg`AND (name ILIKE ${'%' + search + '%'} OR business_name ILIKE ${'%' + search + '%'} OR email ILIKE ${'%' + search + '%'}
      ${digits.length >= 4 ? pg`OR phone LIKE ${'%' + digits + '%'}` : pg``})` : pg``}`;
}

router.get('/:projectId', async (c) => {
  const project = c.get('project');
  const q = c.req.query.bind(c.req);
  const limit = Math.min(Math.max(Number(q('limit')) || 50, 1), 200);
  const offset = Math.max(Number(q('offset')) || 0, 0);
  const order = q('sort') === 'recent' ? pg`last_seen_at DESC` : pg`score DESC, last_seen_at DESC`;
  const where = listFilters(project.id, q);

  const [rows, [{ total }]] = await Promise.all([
    pg`SELECT ${LIST_COLUMNS} FROM leads WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
    pg<Array<{ total: number }>>`SELECT COUNT(*)::int AS total FROM leads WHERE ${where}`,
  ]);
  return c.json({ leads: rows, total, limit, offset });
});

router.get('/:projectId/summary', async (c) => {
  const project = c.get('project');
  const [totals] = await pg<Array<Record<string, number>>>`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status IN ('new','contacted','qualified') AND score >= ${HOT_SCORE})::int AS hot,
           COUNT(*) FILTER (WHERE status = 'new')::int AS new,
           COUNT(*) FILTER (WHERE status = 'won')::int AS won,
           COUNT(*) FILTER (WHERE first_seen_at >= NOW() - INTERVAL '7 days')::int AS last_7_days
    FROM leads WHERE project_id = ${project.id}`;
  const [bySource, byChannel, byStatus] = await Promise.all([
    pg`SELECT s AS source, COUNT(*)::int AS leads, COUNT(*) FILTER (WHERE status = 'won')::int AS won
       FROM leads, unnest(sources) AS s WHERE project_id = ${project.id} GROUP BY s ORDER BY leads DESC`,
    pg`SELECT COALESCE(channel, 'Unattributed') AS channel, COUNT(*)::int AS leads, COUNT(*) FILTER (WHERE status = 'won')::int AS won
       FROM leads WHERE project_id = ${project.id} GROUP BY 1 ORDER BY leads DESC`,
    pg`SELECT status, COUNT(*)::int AS leads FROM leads WHERE project_id = ${project.id} GROUP BY status`,
  ]);
  return c.json({ ...totals, hotScore: HOT_SCORE, statuses: LEAD_STATUSES, bySource, byChannel, byStatus });
});

function csv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('|') : v instanceof Date ? v.toISOString() : String(v);
    // Leading = + - @ would run as a formula when the file is opened in Excel.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map(r => headers.map(h => cell(r[h])).join(','))].join('\n');
}

router.get('/:projectId/export', async (c) => {
  const project = c.get('project');
  const rows = await pg`
    SELECT ${LIST_COLUMNS}, address, website, message, utm_source, utm_medium
    FROM leads WHERE ${listFilters(project.id, c.req.query.bind(c.req))}
    ORDER BY score DESC, last_seen_at DESC LIMIT 20000`;
  const filename = `${project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  return c.body(csv(rows as unknown as Array<Record<string, unknown>>), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
});

router.get('/:projectId/:leadId', async (c) => {
  const project = c.get('project');
  const leadId = c.req.param('leadId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return c.json({ error: 'Lead not found' }, 404);
  const [lead] = await pg`SELECT * FROM leads WHERE id = ${leadId} AND project_id = ${project.id}`;
  if (!lead) return c.json({ error: 'Lead not found' }, 404);
  const events = await pg`
    SELECT e.kind, e.source, e.ref, e.detail, e.created_at, u.email AS actor
    FROM lead_events e LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.lead_id = ${leadId} ORDER BY e.created_at DESC LIMIT 200`;
  return c.json({ lead, events });
});

const updateSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  notes: z.string().max(4000).nullable().optional(),
});

router.patch('/:projectId/:leadId', requireProject('member'), async (c) => {
  const project = c.get('project');
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const leadId = c.req.param('leadId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return c.json({ error: 'Lead not found' }, 404);
  const ok = await updateLead(project.id, leadId, parsed.data, c.get('userId'));
  return ok ? c.json({ ok: true }) : c.json({ error: 'Lead not found' }, 404);
});

/** Manual entry — a call, a walk-in, a referral from a customer. */
router.post('/:projectId', requireProject('member'), async (c) => {
  const project = c.get('project');
  const parsed = leadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const result = toLeadInput(parsed.data, 'manual');
  if ('error' in result) return c.json({ error: result.error }, 400);
  const saved = await upsertLead(project.id, result.input);
  return c.json({ ok: true, ...saved }, saved.created ? 201 : 200);
});

export default router;
