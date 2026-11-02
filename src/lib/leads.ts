/**
 * Lead normalisation, merging and scoring.
 *
 * Every source sends contacts in its own shape: the website trial form, the Maps
 * scraper, Harvey, a salesperson typing in a number from a phone call. Normalising
 * the phone number is what lets the kirana owner who was scraped on Monday and
 * filled the trial form on Friday become one lead with two touches, not two
 * strangers in two spreadsheets.
 *
 * Everything here is pure so the rules are unit-tested; the database side lives
 * in leads-store.ts.
 */

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost', 'junk'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Score at or above which a lead is worth a same-day call. */
export const HOT_SCORE = 50;

/** Points for the strongest source a lead has come through. Inbound beats outbound. */
const SOURCE_POINTS: Record<string, number> = {
  website_form: 35,
  trial: 35,
  enquiry: 35,
  callback: 35,
  whatsapp: 30,
  referral: 25,
  manual: 15,
  harvey: 10,
  import: 5,
  maps_scraper: 0,
};
const UNKNOWN_SOURCE_POINTS = 5;

/** Visitors who searched or asked an AI assistant arrived with a problem to solve. */
const HIGH_INTENT_CHANNELS = new Set(['Organic Search', 'AI Assistant']);

export interface LeadFields {
  phone: string | null;
  email: string | null;
  name: string | null;
  businessName: string | null;
  businessType: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  message: string | null;
}

/** A lead as it arrives from one source, after normalisation. */
export interface LeadInput extends LeadFields {
  source: string;
  /** Stable id in the source system ("maps_scraper:42") so re-syncs merge instead of counting as new touches. */
  ref: string | null;
  status: LeadStatus | null;
  notes: string | null;
  channel: string | null;
  referrerSource: string | null;
  landingPath: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  sessionId: string | null;
  visitorId: string | null;
  attributes: Record<string, unknown>;
  occurredAt: Date;
}

/** The stored lead, as far as merging and scoring care. */
export interface LeadRecord extends LeadFields {
  source: string;
  sources: string[];
  refs: string[];
  status: LeadStatus;
  notes: string | null;
  channel: string | null;
  referrerSource: string | null;
  landingPath: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  sessionId: string | null;
  visitorId: string | null;
  attributes: Record<string, unknown>;
  touches: number;
  score: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * Normalise to digits with a country code: "098765 43210", "+91-98765-43210" and
 * "9876543210" all become "919876543210". Lucknow landlines ("0522 2345678")
 * become "915222345678". Returns null for anything that can't be a phone number.
 */
export function normalizePhone(raw: unknown, countryCode = '91'): string | null {
  if (raw === null || raw === undefined) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) return countryCode + digits;
  if (digits.length >= 11 && digits.length <= 15 && !digits.startsWith('0')) return digits;
  return null;
}

/** Indian mobile numbers are the only ones WhatsApp outreach can reach. */
export function isIndianMobile(phone: string | null): boolean {
  return !!phone && /^91[6-9]\d{9}$/.test(phone);
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 255 ? email : null;
}

/** Trim, collapse whitespace and cap length; empty strings become null. */
export function cleanText(raw: unknown, max: number): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).replace(/\s+/g, ' ').trim().slice(0, max);
  return text || null;
}

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === 'string' && (LEAD_STATUSES as readonly string[]).includes(value);
}

export interface ScoreInput {
  phone: string | null;
  email: string | null;
  source: string;
  sources?: string[];
  channel: string | null;
  message: string | null;
  touches?: number;
  attributes?: Record<string, unknown>;
}

/**
 * 0–100, transparent on purpose: a salesperson should be able to guess why a lead
 * scored what it did. Inbound intent dominates; contactability comes next.
 */
export function scoreLead(lead: ScoreInput): number {
  const sources = new Set([lead.source, ...(lead.sources ?? [])]);
  let score = 0;

  if (lead.phone) score += isIndianMobile(lead.phone) ? 25 : 15;
  if (lead.email) score += 10;
  score += Math.max(...[...sources].map((s) => SOURCE_POINTS[s] ?? UNKNOWN_SOURCE_POINTS));
  if (lead.channel && HIGH_INTENT_CHANNELS.has(lead.channel)) score += 10;
  if ((lead.message ?? '').trim().length >= 20) score += 5;
  if ((lead.touches ?? 1) > 1) score += 10;
  if (sources.size > 1) score += 5;

  const rating = Number(lead.attributes?.rating);
  const reviews = Number(lead.attributes?.reviews_count);
  if (rating >= 4 && reviews >= 20) score += 5;

  return Math.min(100, score);
}

/** A source can move a lead out of "new"; it never overrides what a person decided. */
export function mergeStatus(existing: LeadStatus, incoming: LeadStatus | null): LeadStatus {
  if (!incoming || existing !== 'new') return existing;
  return incoming;
}

function appendMessage(existing: string | null, incoming: string | null): string | null {
  if (!incoming || existing?.includes(incoming)) return existing;
  return (existing ? `${existing}\n---\n${incoming}` : incoming).slice(-4000);
}

/** New lead from its first touch. */
export function createRecord(input: LeadInput): LeadRecord {
  const record: LeadRecord = {
    ...pickFields(input),
    source: input.source,
    sources: [input.source],
    refs: input.ref ? [input.ref] : [],
    status: input.status ?? 'new',
    notes: input.notes,
    channel: input.channel,
    referrerSource: input.referrerSource,
    landingPath: input.landingPath,
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
    utmCampaign: input.utmCampaign,
    sessionId: input.sessionId,
    visitorId: input.visitorId,
    attributes: input.attributes,
    touches: 1,
    score: 0,
    firstSeenAt: input.occurredAt,
    lastSeenAt: input.occurredAt,
  };
  record.score = scoreLead(record);
  return record;
}

/**
 * Fold a new touch into an existing lead. Known values are never overwritten by a
 * later source (first contact details win), gaps are filled, a second phone number
 * is kept in attributes, and re-syncing the same source record is not a new touch.
 */
export function mergeRecord(existing: LeadRecord, input: LeadInput): LeadRecord {
  const resync = !!input.ref && existing.refs.includes(input.ref);
  const fields = pickFields(input);
  const attributes = { ...existing.attributes, ...input.attributes };

  if (fields.phone && existing.phone && fields.phone !== existing.phone) {
    const alt = Array.isArray(attributes.alt_phones) ? (attributes.alt_phones as string[]) : [];
    if (!alt.includes(fields.phone)) attributes.alt_phones = [...alt, fields.phone];
  }

  const merged: LeadRecord = {
    ...existing,
    phone: existing.phone ?? fields.phone,
    email: existing.email ?? fields.email,
    name: existing.name ?? fields.name,
    businessName: existing.businessName ?? fields.businessName,
    businessType: existing.businessType ?? fields.businessType,
    city: existing.city ?? fields.city,
    address: existing.address ?? fields.address,
    website: existing.website ?? fields.website,
    message: appendMessage(existing.message, fields.message),
    sources: existing.sources.includes(input.source) ? existing.sources : [...existing.sources, input.source],
    refs: input.ref && !existing.refs.includes(input.ref) ? [...existing.refs, input.ref] : existing.refs,
    status: mergeStatus(existing.status, input.status),
    notes: existing.notes ?? input.notes,
    // First-touch attribution: the channel that found the lead keeps the credit.
    channel: existing.channel ?? input.channel,
    referrerSource: existing.referrerSource ?? input.referrerSource,
    landingPath: existing.landingPath ?? input.landingPath,
    utmSource: existing.utmSource ?? input.utmSource,
    utmMedium: existing.utmMedium ?? input.utmMedium,
    utmCampaign: existing.utmCampaign ?? input.utmCampaign,
    sessionId: existing.sessionId ?? input.sessionId,
    visitorId: existing.visitorId ?? input.visitorId,
    attributes,
    touches: resync ? existing.touches : existing.touches + 1,
    lastSeenAt: resync || input.occurredAt < existing.lastSeenAt ? existing.lastSeenAt : input.occurredAt,
  };
  merged.score = scoreLead(merged);
  return merged;
}

function pickFields(input: LeadFields): LeadFields {
  return {
    phone: input.phone,
    email: input.email,
    name: input.name,
    businessName: input.businessName,
    businessType: input.businessType,
    city: input.city,
    address: input.address,
    website: input.website,
    message: input.message,
  };
}
