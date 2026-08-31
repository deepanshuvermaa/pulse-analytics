/**
 * Timezone-correct range resolution.
 *
 * Every analytics query in the app funnels through `resolveRange`. Dates are
 * always interpreted as calendar days *in the project's timezone* and converted
 * to absolute UTC instants for querying `timestamptz` columns. Bucketing is done
 * with `date_trunc(unit, timestamp AT TIME ZONE tz)` so daily/weekly/monthly
 * boundaries line up with what the customer sees on their wall clock.
 */

export type Granularity = 'hour' | 'day' | 'week' | 'month';
export type CompareMode = 'none' | 'previous' | 'year_over_year';

export const PRESETS = [
  'today',
  'yesterday',
  'last_7d',
  'last_30d',
  'last_90d',
  'last_12mo',
  'this_month',
  'last_month',
  'month_to_date',
  'year_to_date',
  'all_time',
  'custom',
] as const;
export type Preset = (typeof PRESETS)[number];

export interface DayRange {
  /** Inclusive start day, YYYY-MM-DD in project tz. */
  fromDate: string;
  /** Inclusive end day, YYYY-MM-DD in project tz. */
  toDate: string;
  /** Absolute UTC instant of 00:00:00.000 on fromDate in project tz. */
  from: Date;
  /** Absolute UTC instant of 00:00:00.000 on the day *after* toDate (exclusive). */
  to: Date;
  /**
   * The same two instants as ISO strings.
   *
   * Queries bind these with an explicit `::timestamptz` cast rather than passing
   * the Date objects. How a driver serialises a JS Date depends on the parameter
   * OID the server happens to report, which is an invisible dependency that has
   * already broken this codebase once. An ISO string plus an explicit cast means
   * exactly one interpretation, no matter what sits between us and Postgres.
   */
  fromIso: string;
  toIso: string;
}

export interface ResolvedRange extends DayRange {
  tz: string;
  preset: Preset;
  granularity: Granularity;
  /** Number of inclusive days in the range. */
  days: number;
  /** True when the range includes the project's current day (data still moving). */
  isOpen: boolean;
  compare: (DayRange & { mode: CompareMode }) | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Earliest day we will ever scan for an "all time" query. */
const EPOCH_DAY = '2020-01-01';

// ─────────────────────────────────────────────────────────────
// Timezone primitives (no external dependency; uses Intl)
// ─────────────────────────────────────────────────────────────

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** Offset (ms) such that `utcInstant + offset` reads as local wall clock. */
function tzOffsetMs(instant: Date, tz: string): number {
  const map: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(instant)) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour % 24, map.minute, map.second);
  return asUtc - instant.getTime();
}

/**
 * Convert a wall-clock time in `tz` to the matching absolute UTC instant.
 * Runs the offset lookup twice so DST transitions resolve correctly.
 */
export function zonedToUtc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, tz = 'UTC'): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let ts = guess - tzOffsetMs(new Date(guess), tz);
  ts = guess - tzOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

/** YYYY-MM-DD for an instant, as seen in `tz`. */
export function toDayString(instant: Date, tz: string): string {
  const map: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(instant)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

/** Today's calendar day in `tz`. */
export function todayIn(tz: string, now = new Date()): string {
  return toDayString(now, tz);
}

/** Start-of-day UTC instant for a YYYY-MM-DD in `tz`. */
export function dayStart(day: string, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return zonedToUtc(y, m, d, 0, 0, 0, tz);
}

/** Exclusive end: start-of-day of the following calendar day, in `tz`. */
export function dayEndExclusive(day: string, tz: string): Date {
  return dayStart(addDays(day, 1), tz);
}

/** Calendar-day arithmetic on YYYY-MM-DD strings (timezone independent). */
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addMonths(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + delta, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(d, lastDay))}`;
}

/** Inclusive day count between two YYYY-MM-DD strings. */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000) + 1;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

const VALID_TZ = new Set<string>();
export function isValidTimezone(tz: string): boolean {
  if (VALID_TZ.has(tz)) return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    VALID_TZ.add(tz);
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimezone(tz: string | null | undefined): string {
  return tz && isValidTimezone(tz) ? tz : 'UTC';
}

// ─────────────────────────────────────────────────────────────
// Preset expansion
// ─────────────────────────────────────────────────────────────

function expandPreset(preset: Preset, tz: string, now: Date): { fromDate: string; toDate: string } {
  const today = todayIn(tz, now);
  const [y, m] = today.split('-').map(Number);
  const firstOfMonth = `${y}-${pad(m)}-01`;

  switch (preset) {
    case 'today':
      return { fromDate: today, toDate: today };
    case 'yesterday': {
      const d = addDays(today, -1);
      return { fromDate: d, toDate: d };
    }
    case 'last_7d':
      return { fromDate: addDays(today, -6), toDate: today };
    case 'last_30d':
      return { fromDate: addDays(today, -29), toDate: today };
    case 'last_90d':
      return { fromDate: addDays(today, -89), toDate: today };
    case 'last_12mo':
      return { fromDate: addDays(addMonths(today, -12), 1), toDate: today };
    case 'this_month':
    case 'month_to_date':
      return { fromDate: firstOfMonth, toDate: today };
    case 'last_month': {
      const prev = addMonths(firstOfMonth, -1);
      return { fromDate: prev, toDate: addDays(firstOfMonth, -1) };
    }
    case 'year_to_date':
      return { fromDate: `${y}-01-01`, toDate: today };
    case 'all_time':
      return { fromDate: EPOCH_DAY, toDate: today };
    default:
      return { fromDate: addDays(today, -6), toDate: today };
  }
}

/** Granularity that keeps a chart between roughly 10 and 120 points. */
export function autoGranularity(days: number): Granularity {
  if (days <= 2) return 'hour';
  if (days <= 92) return 'day';
  if (days <= 400) return 'week';
  return 'month';
}

function toDayRange(fromDate: string, toDate: string, tz: string): DayRange {
  const from = dayStart(fromDate, tz);
  const to = dayEndExclusive(toDate, tz);
  return {
    fromDate,
    toDate,
    from,
    to,
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
  };
}

function comparisonRange(
  mode: CompareMode,
  fromDate: string,
  toDate: string,
  tz: string,
): (DayRange & { mode: CompareMode }) | null {
  if (mode === 'none') return null;
  if (mode === 'year_over_year') {
    const f = addMonths(fromDate, -12);
    const t = addMonths(toDate, -12);
    return { ...toDayRange(f, t, tz), mode };
  }
  const len = daysBetween(fromDate, toDate);
  const prevTo = addDays(fromDate, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  return { ...toDayRange(prevFrom, prevTo, tz), mode };
}

export interface RangeQuery {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
  granularity?: string | null;
  compare?: string | null;
}

/**
 * Resolve a request's date parameters against a project timezone.
 * Invalid input degrades to the `last_7d` default rather than throwing, so a
 * malformed URL never blanks the whole dashboard.
 */
export function resolveRange(q: RangeQuery, projectTz: string | null | undefined, now = new Date()): ResolvedRange {
  const tz = normalizeTimezone(projectTz);

  let preset = (q.preset || '').trim() as Preset;
  const hasCustom = !!(q.from && DATE_RE.test(q.from) && q.to && DATE_RE.test(q.to));

  if (hasCustom && (!preset || preset === 'custom')) preset = 'custom';
  else if (!PRESETS.includes(preset)) preset = 'last_7d';

  let fromDate: string;
  let toDate: string;

  if (preset === 'custom' && hasCustom) {
    fromDate = q.from!;
    toDate = q.to!;
  } else {
    if (preset === 'custom') preset = 'last_7d';
    ({ fromDate, toDate } = expandPreset(preset, tz, now));
  }

  // Guard against inverted ranges and future end dates.
  if (fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];
  const today = todayIn(tz, now);
  if (toDate > today) toDate = today;
  if (fromDate > toDate) fromDate = toDate;
  if (fromDate < EPOCH_DAY) fromDate = EPOCH_DAY;

  const days = daysBetween(fromDate, toDate);

  const requested = (q.granularity || '').trim() as Granularity;
  const granularity: Granularity = (['hour', 'day', 'week', 'month'] as const).includes(requested)
    ? requested
    : autoGranularity(days);

  const compareMode: CompareMode =
    q.compare === 'previous' || q.compare === 'year_over_year' ? q.compare : 'none';

  return {
    ...toDayRange(fromDate, toDate, tz),
    tz,
    preset,
    granularity,
    days,
    isOpen: toDate >= today,
    compare: comparisonRange(compareMode, fromDate, toDate, tz),
  };
}

/**
 * Dense series of bucket keys for the range, so charts never draw a continuous
 * line across days that had zero traffic.
 */
export function bucketKeys(range: DayRange, granularity: Granularity, tz: string): string[] {
  const keys: string[] = [];

  if (granularity === 'hour') {
    for (let t = range.from.getTime(); t < range.to.getTime(); t += 3600000) {
      keys.push(new Date(t).toISOString().slice(0, 13) + ':00:00');
    }
    return keys;
  }

  if (granularity === 'day') {
    for (let d = range.fromDate; d <= range.toDate; d = addDays(d, 1)) keys.push(d);
    return keys;
  }

  if (granularity === 'week') {
    let cursor = startOfIsoWeek(range.fromDate);
    while (cursor <= range.toDate) {
      keys.push(cursor);
      cursor = addDays(cursor, 7);
    }
    return keys;
  }

  let cursor = range.fromDate.slice(0, 8) + '01';
  while (cursor <= range.toDate) {
    keys.push(cursor);
    cursor = addMonths(cursor, 1).slice(0, 8) + '01';
  }
  return keys;
}

/** Monday-based ISO week start for a YYYY-MM-DD string. */
export function startOfIsoWeek(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // Mon = 0
  return addDays(day, -dow);
}

/** Normalise a Postgres bucket value (Date or string) to a bucketKeys-comparable key. */
export function bucketKeyOf(value: unknown, granularity: Granularity): string {
  const iso =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'string'
        ? value.length <= 10
          ? value + 'T00:00:00.000Z'
          : value.replace(' ', 'T')
        : new Date(String(value)).toISOString();

  return granularity === 'hour' ? iso.slice(0, 13) + ':00:00' : iso.slice(0, 10);
}

/**
 * Left-join aggregated rows onto the dense bucket series.
 * Missing buckets are filled with `zero`.
 */
export function densify<T extends Record<string, unknown>>(
  rows: Array<Record<string, unknown>>,
  range: DayRange,
  granularity: Granularity,
  tz: string,
  zero: T,
  bucketField = 'bucket',
): Array<T & { bucket: string }> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of rows) byKey.set(bucketKeyOf(r[bucketField], granularity), r);

  return bucketKeys(range, granularity, tz).map((key) => {
    const hit = byKey.get(key);
    const out: Record<string, unknown> = { bucket: key };
    for (const [k, v] of Object.entries(zero)) {
      const raw = hit?.[k];
      out[k] = raw === undefined || raw === null ? v : typeof v === 'number' ? Number(raw) : raw;
    }
    return out as T & { bucket: string };
  });
}

/** Percentage change helper used by every comparison stat card. */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
