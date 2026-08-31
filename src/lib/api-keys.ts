/**
 * Read-only API keys for programmatic and AI-agent access.
 *
 * Keys are stored only as a SHA-256 hash. The plaintext is returned once at
 * creation and never again — a leaked database gives an attacker nothing usable.
 * Lookup is by hash, which is a single indexed equality check rather than a scan
 * with per-row bcrypt comparisons.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from '../db/index.js';
import { apiKeys, projects } from '../db/schema.js';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Project } from './types.js';

const PREFIX = 'pk_';

export interface GeneratedKey {
  /** Full secret — shown to the user exactly once. */
  plaintext: string;
  hash: string;
  prefix: string;
}

export function generateKey(): GeneratedKey {
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `${PREFIX}${secret}`;
  return {
    plaintext,
    hash: hashKey(plaintext),
    // Enough to recognise a key in a list, far too little to reconstruct it.
    prefix: plaintext.slice(0, 11),
  };
}

export function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** Constant-time compare, used when confirming a supplied key against a stored hash. */
export function hashesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface ResolvedKey {
  project: Project;
  keyId: string;
}

/** Resolve a plaintext key to its project, or null if unknown or revoked. */
export async function resolveApiKey(plaintext: string): Promise<ResolvedKey | null> {
  if (!plaintext || !plaintext.startsWith(PREFIX) || plaintext.length > 128) return null;

  const row = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.keyHash, hashKey(plaintext)), isNull(apiKeys.revokedAt)),
  });
  if (!row) return null;

  const project = await db.query.projects.findFirst({ where: eq(projects.id, row.projectId) });
  if (!project || !project.isActive) return null;

  // Best-effort usage stamp; never block the request on it.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: sql`NOW()` })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {});

  return { project, keyId: row.id };
}
