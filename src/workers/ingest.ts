/**
 * Ingest worker: drains the Redis Stream into Postgres.
 *
 * At-least-once delivery. Messages are only ACKed after the transaction commits,
 * so a crash mid-flush replays the batch rather than losing it. Duplicate replays
 * are harmless: every downstream rollup is a full recompute of its day, and the
 * event id is generated client-of-Postgres-side per row so a replayed batch
 * cannot violate the primary key.
 */

import { hostname } from 'node:os';
import { db } from '../db/index.js';
import { events, projects } from '../db/schema.js';
import { sql, eq } from 'drizzle-orm';
import { readBatch, reclaimStale, ack, type QueuedEvent } from '../lib/queue.js';
import { redis } from '../lib/redis.js';
import { errorFingerprint } from '../lib/match.js';
import { env } from '../config.js';

const CONSUMER = `${hostname()}-${process.pid}`;

let running = false;
let stopped = false;

function toRow(e: QueuedEvent) {
  return {
    projectId: e.projectId,
    type: e.type,
    name: e.name,
    path: e.path,
    referrerHost: e.referrerHost,
    source: e.source,
    channel: e.channel,
    visitorId: e.visitorId,
    sessionId: e.sessionId,
    userId: e.userId,
    country: e.country,
    region: e.region,
    city: e.city,
    device: e.device,
    browser: e.browser,
    os: e.os,
    utmSource: e.utmSource,
    utmMedium: e.utmMedium,
    utmCampaign: e.utmCampaign,
    utmTerm: e.utmTerm,
    utmContent: e.utmContent,
    payload: e.payload ?? null,
    timestamp: new Date(e.timestamp),
  };
}

interface ErrorPayload {
  message?: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
}

/**
 * Incrementally maintain grouped errors so the Errors tab is live rather than
 * waiting for the next rollup pass.
 */
async function upsertErrorGroups(batch: QueuedEvent[]): Promise<void> {
  const errors = batch.filter((e) => e.type === 'js_error');
  if (!errors.length) return;

  for (const e of errors) {
    const p = (e.payload ?? {}) as ErrorPayload;
    const message = String(p.message || 'Unknown error').slice(0, 2000);
    const fingerprint = errorFingerprint(message, p.source, p.line);
    const ts = new Date(e.timestamp);

    // Count a session once per error group, tracked in Redis with a 2-day TTL.
    const seenKey = `errseen:${e.projectId}:${fingerprint}`;
    const isNewSession = (await redis.sadd(seenKey, e.sessionId)) === 1;
    if (isNewSession) await redis.expire(seenKey, 172800);

    await db.execute(sql`
      INSERT INTO error_groups (
        project_id, fingerprint, message, source, line, "column", stack,
        sample_path, count, affected_sessions, first_seen_at, last_seen_at
      ) VALUES (
        ${e.projectId}, ${fingerprint}, ${message}, ${p.source?.slice(0, 512) ?? null},
        ${p.line ?? null}, ${p.column ?? null}, ${p.stack?.slice(0, 4000) ?? null},
        ${e.path}, 1, ${isNewSession ? 1 : 0}, ${ts}, ${ts}
      )
      ON CONFLICT (project_id, fingerprint) DO UPDATE SET
        count = error_groups.count + 1,
        affected_sessions = error_groups.affected_sessions + ${isNewSession ? 1 : 0},
        last_seen_at = GREATEST(error_groups.last_seen_at, EXCLUDED.last_seen_at),
        sample_path = COALESCE(EXCLUDED.sample_path, error_groups.sample_path),
        stack = COALESCE(EXCLUDED.stack, error_groups.stack),
        resolved = CASE WHEN error_groups.resolved
                        AND error_groups.last_seen_at < EXCLUDED.last_seen_at
                   THEN FALSE ELSE error_groups.resolved END
    `);
  }
}

/** Keep the per-project activity watermarks fresh for setup checks and alerts. */
async function touchProjectWatermarks(batch: QueuedEvent[]): Promise<void> {
  const latest = new Map<string, Date>();
  for (const e of batch) {
    const ts = new Date(e.timestamp);
    const current = latest.get(e.projectId);
    if (!current || ts > current) latest.set(e.projectId, ts);
  }
  for (const [projectId, ts] of latest) {
    await db
      .update(projects)
      .set({
        lastEventAt: ts,
        firstEventAt: sql`COALESCE(${projects.firstEventAt}, ${ts})`,
      })
      .where(eq(projects.id, projectId));
  }
}

async function flush(batch: QueuedEvent[]): Promise<void> {
  if (!batch.length) return;
  const rows = batch.map(toRow);

  // Chunked so a burst never builds a single oversized statement.
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(events).values(rows.slice(i, i + 500));
  }

  await upsertErrorGroups(batch);
  await touchProjectWatermarks(batch);
}

async function tick(): Promise<void> {
  // Recover anything a dead consumer left pending before taking new work.
  const stale = await reclaimStale(CONSUMER);
  if (stale.ids.length) {
    await flush(stale.events);
    await ack(stale.ids);
    console.log(`[ingest] reclaimed ${stale.ids.length} stranded events`);
  }

  const { ids, events: batch } = await readBatch(CONSUMER);
  if (!ids.length) return;

  await flush(batch);
  await ack(ids);
}

export function startIngestWorker(): void {
  if (running || !env.RUN_INGEST_WORKER) return;
  running = true;

  void (async () => {
    console.log(`[ingest] worker started (consumer=${CONSUMER})`);
    let backoff = 1000;

    while (!stopped) {
      try {
        await tick();
        backoff = 1000;
      } catch (e) {
        console.error('[ingest] batch failed, retrying:', e instanceof Error ? e.message : e);
        // Unacked messages stay pending and will be replayed; back off so a
        // Postgres outage does not become a hot spin loop.
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
    console.log('[ingest] worker stopped');
  })();
}

export async function stopIngestWorker(): Promise<void> {
  stopped = true;
  // Give the current blocking read a chance to return and flush.
  await new Promise((r) => setTimeout(r, env.INGEST_BLOCK_MS + 500));
  try {
    const remaining = await readBatch(CONSUMER);
    if (remaining.ids.length) {
      await flush(remaining.events);
      await ack(remaining.ids);
    }
  } catch {
    /* shutting down anyway — unacked events replay on next boot */
  }
}
