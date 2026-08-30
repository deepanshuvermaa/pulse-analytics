/**
 * Durable event ingest queue built on Redis Streams.
 *
 * Replaces the previous in-process array, which lost every buffered event on
 * crash, could not coordinate across instances, and grew without bound when
 * Postgres was unavailable.
 *
 * Guarantees here: events survive a process restart, multiple API instances share
 * one stream, a consumer group gives at-least-once delivery with explicit ACK,
 * MAXLEN caps memory, and messages stuck in a dead consumer's pending list are
 * reclaimed by whoever is still alive.
 */

import { redis, redisBlocking } from './redis.js';
import { env } from '../config.js';

export interface QueuedEvent {
  projectId: string;
  type: string;
  name: string | null;
  path: string | null;
  referrerHost: string | null;
  source: string | null;
  channel: string | null;
  visitorId: string;
  sessionId: string;
  userId: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device: string;
  browser: string;
  os: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  payload: unknown;
  timestamp: string;
}

let groupReady = false;

async function ensureGroup(): Promise<void> {
  if (groupReady) return;
  try {
    await redis.xgroup('CREATE', env.INGEST_STREAM, env.INGEST_GROUP, '0', 'MKSTREAM');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('BUSYGROUP')) throw e;
  }
  groupReady = true;
}

/** Enqueue one event. Returns false if Redis rejected it (caller decides fallback). */
export async function enqueue(event: QueuedEvent): Promise<boolean> {
  try {
    await ensureGroup();
    await redis.xadd(
      env.INGEST_STREAM,
      'MAXLEN',
      '~',
      String(env.INGEST_MAXLEN),
      '*',
      'd',
      JSON.stringify(event),
    );
    return true;
  } catch (e) {
    console.error('[queue] enqueue failed:', e instanceof Error ? e.message : e);
    return false;
  }
}

export interface StreamBatch {
  ids: string[];
  events: QueuedEvent[];
}

function decode(entries: Array<[string, string[]]>): StreamBatch {
  const ids: string[] = [];
  const events: QueuedEvent[] = [];
  for (const [id, fields] of entries) {
    ids.push(id);
    const idx = fields.indexOf('d');
    if (idx < 0) continue;
    try {
      events.push(JSON.parse(fields[idx + 1]) as QueuedEvent);
    } catch {
      // Undecodable payload: ack it anyway (below) so it cannot block the group.
    }
  }
  return { ids, events };
}

/** Read the next batch of new events, blocking until some arrive or the timeout expires. */
export async function readBatch(consumer: string): Promise<StreamBatch> {
  await ensureGroup();
  const res = (await redisBlocking.xreadgroup(
    'GROUP',
    env.INGEST_GROUP,
    consumer,
    'COUNT',
    env.INGEST_BATCH,
    'BLOCK',
    env.INGEST_BLOCK_MS,
    'STREAMS',
    env.INGEST_STREAM,
    '>',
  )) as Array<[string, Array<[string, string[]]>]> | null;

  if (!res?.length) return { ids: [], events: [] };
  return decode(res[0][1]);
}

/**
 * Take over messages another consumer claimed but never acked (crashed mid-flush).
 * Without this those events sit in the pending list forever.
 */
export async function reclaimStale(consumer: string, idleMs = 60_000): Promise<StreamBatch> {
  await ensureGroup();
  try {
    const res = (await redis.xautoclaim(
      env.INGEST_STREAM,
      env.INGEST_GROUP,
      consumer,
      idleMs,
      '0-0',
      'COUNT',
      env.INGEST_BATCH,
    )) as [string, Array<[string, string[]]>, string[]];
    return decode(res?.[1] ?? []);
  } catch {
    return { ids: [], events: [] };
  }
}

export async function ack(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await redis.xack(env.INGEST_STREAM, env.INGEST_GROUP, ...ids);
}

export async function queueDepth(): Promise<number> {
  try {
    return await redis.xlen(env.INGEST_STREAM);
  } catch {
    return 0;
  }
}

export async function pendingDepth(): Promise<number> {
  try {
    await ensureGroup();
    const res = (await redis.xpending(env.INGEST_STREAM, env.INGEST_GROUP)) as [number, ...unknown[]];
    return Number(res?.[0] ?? 0);
  } catch {
    return 0;
  }
}
