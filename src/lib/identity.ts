/**
 * Visitor identity.
 *
 * Two modes, chosen per project:
 *
 *  - `cookieless` (default): visitor id = sha256(dailySalt + projectId + ip + userAgent).
 *    The salt is 32 random bytes generated once per UTC day and dropped after 48h,
 *    so identities cannot be linked across days and nothing persistent is stored on
 *    the visitor's device. No cookie banner required. Cross-day metrics (retention,
 *    returning visitors) are unavailable unless the visitor is `identify()`-ed.
 *
 *  - `persistent`: the tracker keeps a random id in localStorage and sends it. We
 *    still hash it with the project id so ids are not portable across projects.
 *    Enables retention and cohorts, but requires consent in the EU.
 *
 * An explicit `identify()` call always wins: a logged-in user id is both more
 * accurate and consented, so it upgrades the visitor to a stable identity.
 */

import { createHash, randomBytes } from 'node:crypto';
import { redis } from './redis.js';
import { env } from '../config.js';

const SALT_TTL_SEC = 48 * 3600;
const saltCache = new Map<string, { salt: string; expires: number }>();

function saltKey(day: string): string {
  return `salt:${day}`;
}

/** UTC day string. Salt rotation is deliberately global, not per project timezone. */
export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Fetch (or atomically create) the rotating salt for a UTC day.
 * `SET NX` makes concurrent instances agree on one value.
 */
export async function getDailySalt(day = utcDay()): Promise<string> {
  const cached = saltCache.get(day);
  if (cached && cached.expires > Date.now()) return cached.salt;

  const key = saltKey(day);
  let salt = await redis.get(key);
  if (!salt) {
    const candidate = randomBytes(32).toString('hex');
    const ok = await redis.set(key, candidate, 'EX', SALT_TTL_SEC, 'NX');
    salt = ok ? candidate : await redis.get(key);
    if (!salt) salt = candidate;
  }

  saltCache.set(day, { salt, expires: Date.now() + 60_000 });
  if (saltCache.size > 8) {
    for (const k of saltCache.keys()) {
      if (k < day) saltCache.delete(k);
    }
  }
  return salt;
}

function sha(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export interface IdentityInput {
  projectId: string;
  ip: string;
  userAgent: string;
  /** Durable id from the tracker's localStorage (persistent mode only). */
  durableId?: string | null;
  /** Application user id supplied via `pulse('identify', id)`. */
  userId?: string | null;
  identityMode: 'cookieless' | 'persistent';
}

export interface Identity {
  visitorId: string;
  /** True when this id survives across calendar days. */
  durable: boolean;
}

export async function resolveVisitor(input: IdentityInput): Promise<Identity> {
  // Explicit identification beats every heuristic.
  if (input.userId) {
    return { visitorId: 'u' + sha(`${env.IDENTITY_PEPPER}|u|${input.projectId}|${input.userId}`).slice(0, 31), durable: true };
  }

  if (input.identityMode === 'persistent' && input.durableId) {
    return { visitorId: 'p' + sha(`${env.IDENTITY_PEPPER}|p|${input.projectId}|${input.durableId}`).slice(0, 31), durable: true };
  }

  const salt = await getDailySalt();
  return {
    visitorId: 'a' + sha(`${salt}|${env.IDENTITY_PEPPER}|${input.projectId}|${input.ip}|${input.userAgent}`).slice(0, 31),
    durable: false,
  };
}

/**
 * Server-authoritative sessionisation. A session is a run of activity with no
 * gap longer than SESSION_TIMEOUT_SEC. Redis holds the open session id per
 * visitor with a sliding TTL, so the client cannot forge or split sessions.
 */
export async function resolveSession(projectId: string, visitorId: string): Promise<{ sessionId: string; isNew: boolean }> {
  const key = `sess:${projectId}:${visitorId}`;
  const existing = await redis.get(key);
  if (existing) {
    await redis.expire(key, env.SESSION_TIMEOUT_SEC);
    return { sessionId: existing, isNew: false };
  }
  const sessionId = 's' + randomBytes(15).toString('hex');
  const ok = await redis.set(key, sessionId, 'EX', env.SESSION_TIMEOUT_SEC, 'NX');
  if (!ok) {
    const winner = await redis.get(key);
    if (winner) return { sessionId: winner, isNew: false };
  }
  return { sessionId, isNew: true };
}

/** Client IP, trusting the proxy headers Railway/Cloudflare/Vercel actually set. */
export function clientIp(headers: { get(name: string): string | undefined }): string {
  const candidates = [
    headers.get('cf-connecting-ip'),
    headers.get('x-real-ip'),
    headers.get('x-forwarded-for')?.split(',')[0],
    headers.get('x-client-ip'),
  ];
  for (const c of candidates) {
    const v = c?.trim();
    if (v) return v;
  }
  return '0.0.0.0';
}
