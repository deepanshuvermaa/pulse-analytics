/**
 * Alert evaluation.
 *
 * Compares the last full 24h against the preceding 24h from `daily_stats`, and
 * fires a webhook when a rule trips. Rules are rate-limited to one firing per
 * 6 hours so a sustained anomaly does not become a notification storm.
 */

import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { acquireLock, releaseLock } from '../lib/redis.js';
import { env } from '../config.js';

const REFIRE_COOLDOWN_HOURS = 6;

interface AlertRow {
  id: string;
  project_id: string;
  project_name: string;
  name: string;
  kind: string;
  threshold: number;
  webhook_url: string | null;
  email: string | null;
  last_fired_at: Date | null;
}

interface Window {
  pageviews: number;
  visitors: number;
  errors: number;
  conversions: number;
  sessions: number;
}

const ZERO: Window = { pageviews: 0, visitors: 0, errors: 0, conversions: 0, sessions: 0 };

async function windowFor(projectId: string, fromHoursAgo: number, toHoursAgo: number): Promise<Window> {
  const rows = (await db.execute(sql`
    SELECT
      COALESCE(SUM(s.pageview_count), 0)              AS pageviews,
      COUNT(DISTINCT s.visitor_id)                    AS visitors,
      COALESCE(SUM(s.error_count), 0)                 AS errors,
      COUNT(*) FILTER (WHERE s.converted)             AS conversions,
      COUNT(*)                                        AS sessions
    FROM sessions s
    WHERE s.project_id = ${projectId}
      AND s.started_at >= NOW() - ${sql.raw(`interval '${fromHoursAgo} hours'`)}
      AND s.started_at <  NOW() - ${sql.raw(`interval '${toHoursAgo} hours'`)}
  `)) as unknown as Array<Record<string, unknown>>;

  const r = rows[0];
  if (!r) return ZERO;
  return {
    pageviews: Number(r.pageviews ?? 0),
    visitors: Number(r.visitors ?? 0),
    errors: Number(r.errors ?? 0),
    conversions: Number(r.conversions ?? 0),
    sessions: Number(r.sessions ?? 0),
  };
}

function pctChange(current: number, previous: number): number {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

interface Trip {
  fired: boolean;
  message: string;
  current: number;
  previous: number;
  changePct: number;
}

function evaluate(alert: AlertRow, current: Window, previous: Window, hoursSinceLastEvent: number | null): Trip {
  const t = alert.threshold;

  switch (alert.kind) {
    case 'traffic_spike': {
      const change = pctChange(current.visitors, previous.visitors);
      return {
        fired: change >= t,
        message: `Visitors up ${change.toFixed(1)}% (${previous.visitors} → ${current.visitors}) in the last 24h`,
        current: current.visitors, previous: previous.visitors, changePct: change,
      };
    }
    case 'traffic_drop': {
      const change = pctChange(current.visitors, previous.visitors);
      return {
        fired: change <= -t,
        message: `Visitors down ${Math.abs(change).toFixed(1)}% (${previous.visitors} → ${current.visitors}) in the last 24h`,
        current: current.visitors, previous: previous.visitors, changePct: change,
      };
    }
    case 'error_spike': {
      const change = pctChange(current.errors, previous.errors);
      return {
        fired: current.errors > 0 && change >= t,
        message: `JS errors up ${change.toFixed(1)}% (${previous.errors} → ${current.errors}) in the last 24h`,
        current: current.errors, previous: previous.errors, changePct: change,
      };
    }
    case 'conversion_drop': {
      const currentRate = current.sessions ? (current.conversions / current.sessions) * 100 : 0;
      const previousRate = previous.sessions ? (previous.conversions / previous.sessions) * 100 : 0;
      const change = pctChange(currentRate, previousRate);
      return {
        fired: previousRate > 0 && change <= -t,
        message: `Conversion rate down ${Math.abs(change).toFixed(1)}% (${previousRate.toFixed(2)}% → ${currentRate.toFixed(2)}%)`,
        current: currentRate, previous: previousRate, changePct: change,
      };
    }
    case 'no_data': {
      const hours = hoursSinceLastEvent ?? Number.POSITIVE_INFINITY;
      return {
        fired: hours >= t,
        message: `No events received for ${Number.isFinite(hours) ? hours.toFixed(1) : 'over'} hours`,
        current: hours, previous: 0, changePct: 0,
      };
    }
    default:
      return { fired: false, message: '', current: 0, previous: 0, changePct: 0 };
  }
}

async function notify(alert: AlertRow, trip: Trip): Promise<void> {
  if (!alert.webhook_url) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    await fetch(alert.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        alert: alert.name,
        kind: alert.kind,
        project: alert.project_name,
        projectId: alert.project_id,
        // Slack and Discord both render a bare `text` field.
        text: `[${alert.project_name}] ${alert.name}: ${trip.message}`,
        message: trip.message,
        current: trip.current,
        previous: trip.previous,
        changePct: Number(trip.changePct.toFixed(2)),
        firedAt: new Date().toISOString(),
      }),
    });
    clearTimeout(timeout);
  } catch (e) {
    console.error(`[alerts] webhook failed for ${alert.id}:`, e instanceof Error ? e.message : e);
  }
}

export async function runAlertPass(): Promise<void> {
  const alerts = (await db.execute(sql`
    SELECT a.id::text, a.project_id, p.name AS project_name, a.name, a.kind,
           a.threshold, a.webhook_url, a.email, a.last_fired_at
    FROM alerts a
    JOIN projects p ON p.id = a.project_id
    WHERE a.enabled = TRUE AND p.is_active = TRUE
      AND (a.last_fired_at IS NULL
           OR a.last_fired_at < NOW() - ${sql.raw(`interval '${REFIRE_COOLDOWN_HOURS} hours'`)})
  `)) as unknown as AlertRow[];

  const cache = new Map<string, { current: Window; previous: Window; hoursSince: number | null }>();

  for (const alert of alerts) {
    try {
      let windows = cache.get(alert.project_id);
      if (!windows) {
        const [current, previous, lastRows] = await Promise.all([
          windowFor(alert.project_id, 24, 0),
          windowFor(alert.project_id, 48, 24),
          db.execute(sql`
            SELECT EXTRACT(EPOCH FROM (NOW() - MAX(last_event_at))) / 3600 AS hours
            FROM projects WHERE id = ${alert.project_id}
          `) as unknown as Promise<Array<{ hours: string | null }>>,
        ]);
        const hours = lastRows[0]?.hours;
        windows = { current, previous, hoursSince: hours === null || hours === undefined ? null : Number(hours) };
        cache.set(alert.project_id, windows);
      }

      const trip = evaluate(alert, windows.current, windows.previous, windows.hoursSince);
      if (!trip.fired) continue;

      await notify(alert, trip);
      await db.execute(sql`UPDATE alerts SET last_fired_at = NOW() WHERE id = ${alert.id}::uuid`);
      console.log(`[alerts] fired "${alert.name}" for ${alert.project_name}: ${trip.message}`);
    } catch (e) {
      console.error(`[alerts] evaluation failed for ${alert.id}:`, e instanceof Error ? e.message : e);
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startAlertWorker(): void {
  if (timer || !env.RUN_ALERT_WORKER) return;

  const pass = async () => {
    const token = await acquireLock('alerts', 300);
    if (!token) return;
    try {
      await runAlertPass();
    } catch (e) {
      console.error('[alerts] pass failed:', e instanceof Error ? e.message : e);
    } finally {
      await releaseLock('alerts', token);
    }
  };

  timer = setInterval(() => void pass(), env.ALERT_INTERVAL_MS);
  console.log('[alerts] worker scheduled');
}

export function stopAlertWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
