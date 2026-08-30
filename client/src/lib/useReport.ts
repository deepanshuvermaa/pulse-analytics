import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Query } from '../api';

export interface ReportState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Fetch one analytics report and keep it in sync with the current range/filters.
 *
 * Two things matter here that the old dashboard got wrong:
 *  - stale responses are discarded, so rapidly changing the date range cannot
 *    leave the previous period's numbers on screen;
 *  - previous data stays visible while refetching, so the dashboard does not
 *    flash empty on every filter change.
 */
export function useReport<T = any>(
  projectId: string | undefined,
  report: string,
  query: Query,
  options: { enabled?: boolean; refreshMs?: number } = {},
): ReportState<T> {
  const { enabled = true, refreshMs } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const signature = JSON.stringify(query);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!projectId || !enabled) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.report<T>(projectId, report, JSON.parse(signature));
      if (id === requestId.current) setData(result);
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [projectId, report, signature, enabled]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!refreshMs || !enabled) return;
    const timer = setInterval(() => void load(), refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs, enabled, load]);

  return { data, loading, error, reload: load };
}

/** Same contract for anything that is not a plain analytics report. */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  options: { enabled?: boolean } = {},
): ReportState<T> {
  const { enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async () => {
    if (!enabled) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current();
      if (id === requestId.current) setData(result);
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => { void load(); }, [load]);

  return { data, loading, error, reload: load };
}
