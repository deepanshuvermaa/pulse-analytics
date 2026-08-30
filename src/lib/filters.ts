/**
 * Shared segment filters.
 *
 * Every report accepts the same filter set, so `?path=/pricing&device=mobile`
 * reshapes the entire dashboard consistently. Filters are parsed once per request
 * and rendered into SQL fragments for either the event table or the session table.
 */

import { sql, type SQL } from 'drizzle-orm';

export interface Filters {
  path?: string;
  entryPath?: string;
  exitPath?: string;
  source?: string;
  channel?: string;
  referrerHost?: string;
  country?: string;
  device?: string;
  browser?: string;
  os?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  /** 'new' | 'returning' */
  visitorType?: 'new' | 'returning';
  /** 'converted' | 'not_converted' */
  conversion?: 'converted' | 'not_converted';
  /** Restrict to sessions that hit this goal id. */
  goalId?: string;
}

/** Dimension keys the UI may filter and break down by. */
export const FILTER_KEYS = [
  'path', 'entryPath', 'exitPath', 'source', 'channel', 'referrerHost',
  'country', 'device', 'browser', 'os', 'utmSource', 'utmMedium', 'utmCampaign',
  'visitorType', 'conversion', 'goalId',
] as const;

function str(v: string | undefined | null, max = 512): string | undefined {
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  return t ? t.slice(0, max) : undefined;
}

export function parseFilters(get: (key: string) => string | undefined): Filters {
  const visitorType = str(get('visitorType'));
  const conversion = str(get('conversion'));
  return {
    path: str(get('path'), 1024),
    entryPath: str(get('entryPath'), 1024),
    exitPath: str(get('exitPath'), 1024),
    source: str(get('source'), 120),
    channel: str(get('channel'), 32),
    referrerHost: str(get('referrerHost'), 255),
    country: str(get('country'), 2)?.toUpperCase(),
    device: str(get('device'), 12),
    browser: str(get('browser'), 40),
    os: str(get('os'), 40),
    utmSource: str(get('utmSource'), 120),
    utmMedium: str(get('utmMedium'), 120),
    utmCampaign: str(get('utmCampaign'), 120),
    visitorType: visitorType === 'new' || visitorType === 'returning' ? visitorType : undefined,
    conversion: conversion === 'converted' || conversion === 'not_converted' ? conversion : undefined,
    goalId: str(get('goalId'), 64),
  };
}

/** Stable object for cache keys — drops undefined entries so key order is deterministic. */
export function filterFingerprint(f: Filters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const v = f[key as keyof Filters];
    if (v !== undefined) out[key] = String(v);
  }
  return out;
}

export function hasAnyFilter(f: Filters): boolean {
  return FILTER_KEYS.some((k) => f[k as keyof Filters] !== undefined);
}

/** Session-scope filters cannot be answered from the events table alone. */
function hasSessionScopedFilter(f: Filters): boolean {
  return !!(f.entryPath || f.exitPath || f.visitorType || f.conversion || f.goalId);
}

/**
 * Path matcher supporting a single trailing `*` wildcard, so `/blog/*` works
 * without exposing raw LIKE/regex injection surface.
 */
function pathMatch(column: SQL, value: string): SQL {
  if (value.endsWith('*')) {
    const prefix = value.slice(0, -1);
    return sql`${column} LIKE ${prefix + '%'}`;
  }
  return sql`${column} = ${value}`;
}

function joinAnd(parts: SQL[]): SQL {
  if (!parts.length) return sql`TRUE`;
  return parts.reduce((acc, p, i) => (i === 0 ? p : sql`${acc} AND ${p}`));
}

/** Conditions applied to the `sessions` table under alias `s`. */
export function sessionConditions(f: Filters): SQL {
  const parts: SQL[] = [];

  if (f.entryPath) parts.push(pathMatch(sql`s.entry_path`, f.entryPath));
  if (f.exitPath) parts.push(pathMatch(sql`s.exit_path`, f.exitPath));
  if (f.source) parts.push(sql`s.source = ${f.source}`);
  if (f.channel) parts.push(sql`s.channel = ${f.channel}`);
  if (f.referrerHost) parts.push(sql`s.referrer_host = ${f.referrerHost}`);
  if (f.country) parts.push(sql`s.country = ${f.country}`);
  if (f.device) parts.push(sql`s.device = ${f.device}`);
  if (f.browser) parts.push(sql`s.browser = ${f.browser}`);
  if (f.os) parts.push(sql`s.os = ${f.os}`);
  if (f.utmSource) parts.push(sql`s.utm_source = ${f.utmSource}`);
  if (f.utmMedium) parts.push(sql`s.utm_medium = ${f.utmMedium}`);
  if (f.utmCampaign) parts.push(sql`s.utm_campaign = ${f.utmCampaign}`);
  if (f.visitorType === 'new') parts.push(sql`s.is_new_visitor = TRUE`);
  if (f.visitorType === 'returning') parts.push(sql`s.is_new_visitor = FALSE`);
  if (f.conversion === 'converted') parts.push(sql`s.converted = TRUE`);
  if (f.conversion === 'not_converted') parts.push(sql`s.converted = FALSE`);
  if (f.goalId) parts.push(sql`s.goals_hit ? ${f.goalId}`);

  // A page filter on a session query means "sessions that touched this page".
  if (f.path) {
    parts.push(sql`EXISTS (
      SELECT 1 FROM events pe
      WHERE pe.project_id = s.project_id
        AND pe.session_id = s.session_id
        AND pe.type = 'pageview'
        AND ${pathMatch(sql`pe.path`, f.path)}
    )`);
  }

  return joinAnd(parts);
}

/**
 * Conditions applied to the `events` table under alias `e`.
 * Session-scope filters degrade to a semi-join on `sessions`.
 */
export function eventConditions(f: Filters, projectId: string): SQL {
  const parts: SQL[] = [];

  if (f.path) parts.push(pathMatch(sql`e.path`, f.path));
  if (f.source) parts.push(sql`e.source = ${f.source}`);
  if (f.channel) parts.push(sql`e.channel = ${f.channel}`);
  if (f.referrerHost) parts.push(sql`e.referrer_host = ${f.referrerHost}`);
  if (f.country) parts.push(sql`e.country = ${f.country}`);
  if (f.device) parts.push(sql`e.device = ${f.device}`);
  if (f.browser) parts.push(sql`e.browser = ${f.browser}`);
  if (f.os) parts.push(sql`e.os = ${f.os}`);
  if (f.utmSource) parts.push(sql`e.utm_source = ${f.utmSource}`);
  if (f.utmMedium) parts.push(sql`e.utm_medium = ${f.utmMedium}`);
  if (f.utmCampaign) parts.push(sql`e.utm_campaign = ${f.utmCampaign}`);

  if (hasSessionScopedFilter(f)) {
    const sessionOnly: Filters = {
      entryPath: f.entryPath,
      exitPath: f.exitPath,
      visitorType: f.visitorType,
      conversion: f.conversion,
      goalId: f.goalId,
    };
    parts.push(sql`e.session_id IN (
      SELECT s.session_id FROM sessions s
      WHERE s.project_id = ${projectId} AND ${sessionConditions(sessionOnly)}
    )`);
  }

  return joinAnd(parts);
}

/**
 * True when a query can be answered from the pre-aggregated daily rollups.
 * Any filter narrows below the rollup grain, so those queries fall back to raw
 * sessions/events.
 */
export function canUseRollups(f: Filters): boolean {
  return !hasAnyFilter(f);
}

/** Column that a `dimension` breakdown maps to on the sessions table. */
export const DIMENSION_COLUMNS: Record<string, string> = {
  source: 'source',
  channel: 'channel',
  referrer: 'referrer_host',
  country: 'country',
  device: 'device',
  browser: 'browser',
  os: 'os',
  utm_source: 'utm_source',
  utm_medium: 'utm_medium',
  utm_campaign: 'utm_campaign',
  entry_page: 'entry_path',
  exit_page: 'exit_path',
};

export function dimensionColumn(dimension: string): string | null {
  return Object.prototype.hasOwnProperty.call(DIMENSION_COLUMNS, dimension)
    ? DIMENSION_COLUMNS[dimension]
    : null;
}
