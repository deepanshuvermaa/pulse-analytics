/**
 * Database side of the lead hub: every source — website form, Maps scraper,
 * Harvey, a manual entry — goes through upsertLead, so merging and scoring
 * behave the same no matter where a contact came from.
 */

import type { TransactionSql } from 'postgres';
import { sql as pg } from '../db/index.js';
import { redis } from './redis.js';
import { env } from '../config.js';
import {
  createRecord, mergeRecord, isLeadStatus, HOT_SCORE,
  type LeadInput, type LeadRecord, type LeadStatus,
} from './leads.js';

export interface UpsertResult {
  id: string;
  created: boolean;
  score: number;
  /** True the first time this lead crosses HOT_SCORE — worth a real-time alert. */
  becameHot: boolean;
}

interface LeadRow {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  business_name: string | null;
  business_type: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  message: string | null;
  source: string;
  sources: string[];
  refs: string[];
  status: string;
  notes: string | null;
  channel: string | null;
  referrer_source: string | null;
  landing_path: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  session_id: string | null;
  visitor_id: string | null;
  attributes: Record<string, unknown> | null;
  touches: number;
  score: number;
  first_seen_at: Date;
  last_seen_at: Date;
}

function toRecord(row: LeadRow): LeadRecord {
  return {
    phone: row.phone,
    email: row.email,
    name: row.name,
    businessName: row.business_name,
    businessType: row.business_type,
    city: row.city,
    address: row.address,
    website: row.website,
    message: row.message,
    source: row.source,
    sources: row.sources ?? [],
    refs: row.refs ?? [],
    status: isLeadStatus(row.status) ? row.status : 'new',
    notes: row.notes,
    channel: row.channel,
    referrerSource: row.referrer_source,
    landingPath: row.landing_path,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    sessionId: row.session_id,
    visitorId: row.visitor_id,
    attributes: row.attributes ?? {},
    touches: row.touches,
    score: row.score,
    firstSeenAt: new Date(row.first_seen_at),
    lastSeenAt: new Date(row.last_seen_at),
  };
}

function columns(r: LeadRecord) {
  return {
    phone: r.phone,
    email: r.email,
    name: r.name,
    business_name: r.businessName,
    business_type: r.businessType,
    city: r.city,
    address: r.address,
    website: r.website,
    message: r.message,
    source: r.source,
    // Arrays and timestamps go over as literals: this driver setup can't serialise
    // JS Date values (see db/index.ts), and text[] needs an explicit array.
    sources: pg.array(r.sources),
    refs: pg.array(r.refs),
    status: r.status,
    score: r.score,
    touches: r.touches,
    notes: r.notes,
    channel: r.channel,
    referrer_source: r.referrerSource,
    landing_path: r.landingPath,
    utm_source: r.utmSource,
    utm_medium: r.utmMedium,
    utm_campaign: r.utmCampaign,
    session_id: r.sessionId,
    visitor_id: r.visitorId,
    attributes: pg.json(r.attributes as never),
    first_seen_at: r.firstSeenAt.toISOString(),
    last_seen_at: r.lastSeenAt.toISOString(),
  };
}

/** Insert or merge one touch. Must be given a phone or an email. */
export async function upsertLead(projectId: string, input: LeadInput): Promise<UpsertResult> {
  if (!input.phone && !input.email) throw new Error('A lead needs a phone number or an email');

  return pg.begin(async (tx: TransactionSql) => {
    // Serialise concurrent touches for the same person so two sources arriving
    // at once merge into one lead instead of racing to create two.
    const identity = input.phone ? `p:${input.phone}` : `e:${input.email}`;
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`${projectId}|${identity}`}))`;

    let rows = input.phone
      ? await tx<LeadRow[]>`SELECT * FROM leads WHERE project_id = ${projectId} AND phone = ${input.phone} LIMIT 1`
      : [];
    if (!rows.length && input.email) {
      rows = await tx<LeadRow[]>`
        SELECT * FROM leads WHERE project_id = ${projectId} AND email = ${input.email}
        ORDER BY (phone IS NULL) DESC LIMIT 1`;
    }

    const existing = rows[0];
    const detail = tx.json({
      status: input.status,
      channel: input.channel,
      message: input.message?.slice(0, 500) ?? null,
    } as never);

    if (!existing) {
      const record = createRecord(input);
      const [inserted] = await tx<Array<{ id: string }>>`
        INSERT INTO leads ${tx({ project_id: projectId, ...columns(record) })}
        RETURNING id`;
      await tx`
        INSERT INTO lead_events (lead_id, project_id, kind, source, ref, detail)
        VALUES (${inserted.id}, ${projectId}, 'touch', ${input.source}, ${input.ref}, ${detail})`;
      return { id: inserted.id, created: true, score: record.score, becameHot: record.score >= HOT_SCORE };
    }

    const before = toRecord(existing);
    const merged = mergeRecord(before, input);
    await tx`
      UPDATE leads SET ${tx({ ...columns(merged), updated_at: new Date().toISOString() })}
      WHERE id = ${existing.id}`;
    if (merged.touches > before.touches || merged.status !== before.status) {
      await tx`
        INSERT INTO lead_events (lead_id, project_id, kind, source, ref, detail)
        VALUES (${existing.id}, ${projectId}, 'touch', ${input.source}, ${input.ref}, ${detail})`;
    }
    return { id: existing.id, created: false, score: merged.score, becameHot: before.score < HOT_SCORE && merged.score >= HOT_SCORE };
  });
}

/** A person changed a lead's status or notes from the dashboard. */
export async function updateLead(
  projectId: string,
  leadId: string,
  change: { status?: LeadStatus; notes?: string | null },
  actorId: string,
): Promise<boolean> {
  return pg.begin(async (tx: TransactionSql) => {
    const [row] = await tx<Array<{ status: string; notes: string | null }>>`
      SELECT status, notes FROM leads WHERE id = ${leadId} AND project_id = ${projectId} FOR UPDATE`;
    if (!row) return false;

    const status = change.status ?? row.status;
    const notes = change.notes !== undefined ? change.notes : row.notes;
    await tx`UPDATE leads SET status = ${status}, notes = ${notes}, updated_at = NOW() WHERE id = ${leadId}`;

    if (change.status && change.status !== row.status) {
      await tx`
        INSERT INTO lead_events (lead_id, project_id, kind, detail, actor_id)
        VALUES (${leadId}, ${projectId}, 'status', ${tx.json({ from: row.status, to: change.status } as never)}, ${actorId})`;
    }
    if (change.notes !== undefined && change.notes !== row.notes) {
      await tx`
        INSERT INTO lead_events (lead_id, project_id, kind, detail, actor_id)
        VALUES (${leadId}, ${projectId}, 'note', ${tx.json({ notes: change.notes } as never)}, ${actorId})`;
    }
    return true;
  });
}

/**
 * The visitor's current session, if they have one. Lets a server-side form
 * submission (e.g. a WhatsApp enquiry relayed by the site) carry the channel the
 * visitor arrived through — "AI Assistant", "Organic Search" — onto the lead.
 */
export async function sessionAttribution(projectId: string, visitorId: string | null): Promise<{
  sessionId: string | null; channel: string | null; referrerSource: string | null; landingPath: string | null;
  utmSource: string | null; utmMedium: string | null; utmCampaign: string | null;
}> {
  const empty = { sessionId: null, channel: null, referrerSource: null, landingPath: null, utmSource: null, utmMedium: null, utmCampaign: null };
  if (!visitorId) return empty;
  const sessionId = await redis.get(`sess:${projectId}:${visitorId}`).catch(() => null);

  // The live session's first event is real-time; the sessions table is only
  // rolled up every few minutes, so it is the fallback for older visits.
  if (sessionId) {
    const [first] = await pg<Array<{ channel: string | null; source: string | null; path: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null }>>`
      SELECT channel, source, path, utm_source, utm_medium, utm_campaign
      FROM events
      WHERE project_id = ${projectId} AND session_id = ${sessionId}
        AND timestamp >= NOW() - INTERVAL '1 day'
      ORDER BY timestamp ASC LIMIT 1`;
    if (first) {
      return {
        sessionId,
        channel: first.channel,
        referrerSource: first.source,
        landingPath: first.path,
        utmSource: first.utm_source,
        utmMedium: first.utm_medium,
        utmCampaign: first.utm_campaign,
      };
    }
  }

  const [s] = await pg<Array<{ session_id: string; channel: string | null; source: string | null; entry_path: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null }>>`
    SELECT session_id, channel, source, entry_path, utm_source, utm_medium, utm_campaign
    FROM sessions
    WHERE project_id = ${projectId} AND visitor_id = ${visitorId}
    ORDER BY started_at DESC LIMIT 1`;
  if (!s) return { ...empty, sessionId };
  return {
    sessionId: s.session_id,
    channel: s.channel,
    referrerSource: s.source,
    landingPath: s.entry_path,
    utmSource: s.utm_source,
    utmMedium: s.utm_medium,
    utmCampaign: s.utm_campaign,
  };
}

/**
 * Real-time alert for a lead that just turned hot. Same payload shape as the
 * analytics alerts, so a Slack/Discord/Telegram-bridge webhook works unchanged.
 */
export async function notifyHotLead(projectName: string, leadId: string, input: LeadInput, score: number): Promise<void> {
  const telegram = env.LEADS_TELEGRAM_BOT_TOKEN && env.LEADS_TELEGRAM_CHAT_ID;
  if (!env.LEADS_WEBHOOK_URL && !telegram) return;
  const text = hotLeadText(projectName, input, score);
  const sends: Array<Promise<void>> = [];
  if (env.LEADS_WEBHOOK_URL) {
    sends.push(postJson(env.LEADS_WEBHOOK_URL, {
      text, leadId, score, source: input.source, channel: input.channel, phone: input.phone, email: input.email,
    }, 'webhook'));
  }
  if (telegram) {
    // A Telegram bot reaches the owner's phone instantly and costs nothing.
    sends.push(postJson(`https://api.telegram.org/bot${env.LEADS_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: env.LEADS_TELEGRAM_CHAT_ID, text, disable_web_page_preview: true,
    }, 'telegram'));
  }
  await Promise.all(sends);
}

/** One message a salesperson can act on from a phone lock screen. */
export function hotLeadText(projectName: string, input: LeadInput, score: number): string {
  const who = [input.name, input.businessName].filter(Boolean).join(' · ') || 'Unnamed lead';
  const via = input.channel ? `${input.source} via ${input.channel}` : input.source;
  const lines = [
    `🔥 [${projectName}] Hot lead (${score}/100)`,
    who,
    input.phone ? `📞 +${input.phone}  ·  https://wa.me/${input.phone}` : `✉️ ${input.email}`,
    [input.businessType, input.city].filter(Boolean).join(' · '),
    `Came in: ${via}${input.landingPath ? ` (${input.landingPath})` : ''}`,
    input.message ? `“${input.message.slice(0, 280)}”` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

async function postJson(url: string, body: unknown, label: string): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    clearTimeout(timeout);
    if (!res.ok) console.error(`[leads] ${label} answered ${res.status}`);
  } catch (e) {
    console.error(`[leads] ${label} failed:`, e instanceof Error ? `${e.message} ${(e as { cause?: Error }).cause?.message ?? ''}` : e);
  }
}
