import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Query } from '../api';

/**
 * Range and filter state lives in the URL, not component state.
 *
 * That makes every view shareable and bookmarkable, survives a refresh, and
 * means the browser back button steps through filter changes the way users
 * expect it to.
 */

export const PRESETS: Array<{ value: string; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' },
  { value: 'month_to_date', label: 'Month to date' },
  { value: 'last_month', label: 'Last month' },
  { value: 'year_to_date', label: 'Year to date' },
  { value: 'last_12mo', label: 'Last 12 months' },
  { value: 'all_time', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
];

export const GRANULARITIES = [
  { value: '', label: 'Auto' },
  { value: 'hour', label: 'Hourly' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

export const COMPARE_MODES = [
  { value: '', label: 'No comparison' },
  { value: 'previous', label: 'Previous period' },
  { value: 'year_over_year', label: 'Same period last year' },
];

/** Segment filters the UI can apply. Keys match the server's parser exactly. */
export const FILTER_KEYS = [
  'path', 'entryPath', 'exitPath', 'source', 'channel', 'referrerHost',
  'country', 'device', 'browser', 'os', 'utmSource', 'utmMedium', 'utmCampaign',
  'visitorType', 'conversion',
] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];

export const FILTER_LABELS: Record<FilterKey, string> = {
  path: 'Page',
  entryPath: 'Entry page',
  exitPath: 'Exit page',
  source: 'Source',
  channel: 'Channel',
  referrerHost: 'Referrer',
  country: 'Country',
  device: 'Device',
  browser: 'Browser',
  os: 'OS',
  utmSource: 'UTM source',
  utmMedium: 'UTM medium',
  utmCampaign: 'UTM campaign',
  visitorType: 'Visitor',
  conversion: 'Conversion',
};

const RANGE_KEYS = ['preset', 'from', 'to', 'granularity', 'compare'] as const;
type RangeKey = (typeof RANGE_KEYS)[number];

export interface QueryState {
  /** Everything the API needs: range + active filters. */
  query: Query;
  preset: string;
  from: string;
  to: string;
  granularity: string;
  compare: string;
  filters: Array<{ key: FilterKey; value: string }>;
  setRange: (patch: Partial<Record<RangeKey, string>>) => void;
  setFilter: (key: FilterKey, value: string | null) => void;
  clearFilters: () => void;
  /** Stable string for effect dependencies. */
  signature: string;
}

export function useQueryState(): QueryState {
  const [params, setParams] = useSearchParams();

  const preset = params.get('preset') || 'last_7d';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const granularity = params.get('granularity') || '';
  const compare = params.get('compare') || '';

  const filters = useMemo(
    () => FILTER_KEYS
      .map((key) => ({ key, value: params.get(key) || '' }))
      .filter((f) => f.value !== ''),
    [params],
  );

  const query = useMemo<Query>(() => {
    const q: Query = { preset };
    if (preset === 'custom') {
      if (from) q.from = from;
      if (to) q.to = to;
    }
    if (granularity) q.granularity = granularity;
    if (compare) q.compare = compare;
    for (const f of filters) q[f.key] = f.value;
    return q;
  }, [preset, from, to, granularity, compare, filters]);

  const setRange = useCallback(
    (patch: Partial<Record<RangeKey, string>>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          // A named preset makes explicit dates meaningless — drop them.
          if (patch.preset && patch.preset !== 'custom') {
            next.delete('from');
            next.delete('to');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setFilter = useCallback(
    (key: FilterKey, value: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: false }, // filter changes are navigable history
      );
    },
    [setParams],
  );

  const clearFilters = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of FILTER_KEYS) next.delete(key);
        return next;
      },
      { replace: false },
    );
  }, [setParams]);

  return {
    query,
    preset, from, to, granularity, compare,
    filters,
    setRange, setFilter, clearFilters,
    signature: JSON.stringify(query),
  };
}

// ── Formatting helpers shared across the dashboard ──────────

export function formatNumber(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seconds ?? 0)));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatMs(ms: number | null | undefined): string {
  const n = Number(ms ?? 0);
  if (!Number.isFinite(n) || n === 0) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`;
}

/** Chart axis label appropriate to the bucket granularity. */
export function formatBucket(bucket: string, granularity: string): string {
  if (!bucket) return '';
  if (granularity === 'hour') {
    const d = new Date(bucket.length <= 19 ? `${bucket}Z` : bucket);
    return Number.isNaN(d.getTime())
      ? bucket.slice(11, 16)
      : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (granularity === 'month') return bucket.slice(0, 7);
  return bucket.slice(5); // MM-DD
}

let regionNames: Intl.DisplayNames | null = null;

export function countryName(code: string): string {
  if (!code || code.length !== 2) return code || 'Unknown';
  try {
    if (!regionNames) regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code.toUpperCase()) || code;
  } catch {
    return code;
  }
}
