/**
 * Analytics query cache.
 *
 * Reports over closed (fully elapsed) periods never change, so they cache for an
 * hour. Reports that include the current day cache for a minute. The key folds in
 * every input that can change the result — project, endpoint, range, granularity,
 * comparison and the whole segment filter set — so a filter change can never
 * serve another segment's numbers.
 */

import { createHash } from 'node:crypto';
import { redis } from './redis.js';
import { env } from '../config.js';

export function cacheKey(projectId: string, report: string, parts: Record<string, unknown>): string {
  const stable = JSON.stringify(parts, Object.keys(parts).sort());
  const hash = createHash('sha1').update(stable).digest('hex').slice(0, 20);
  return `q:${projectId}:${report}:${hash}`;
}

export async function cached<T>(key: string, isOpenPeriod: boolean, produce: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    // Cache is an optimisation; a Redis blip must not take the dashboard down.
  }

  const value = await produce();

  try {
    const ttl = isOpenPeriod ? env.CACHE_TTL_OPEN : env.CACHE_TTL_CLOSED;
    await redis.set(key, JSON.stringify(value), 'EX', ttl);
  } catch {
    /* ignore */
  }

  return value;
}

/** Drop every cached report for a project (settings changed, data deleted, …). */
export async function invalidateProject(projectId: string): Promise<void> {
  const pattern = `q:${projectId}:*`;
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    if (keys.length) await redis.del(...keys);
  } while (cursor !== '0');
}
