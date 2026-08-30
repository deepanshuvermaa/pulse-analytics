import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Sparkles, Lock } from 'lucide-react';
import { toQueryString } from '../api';
import { PRESETS, countryName, formatBucket, formatDuration, formatNumber } from '../lib/query-state';
import { Panel, StatCard, EmptyState, ErrorNote, Spinner, BarRow } from '../components/ui';

/**
 * Public read-only dashboard. No account required.
 * Segment filters are deliberately unavailable — a stranger with the link should
 * not be able to probe arbitrary slices of someone else's traffic.
 */
export default function Share() {
  const { slug } = useParams<{ slug: string }>();
  const [params, setParams] = useSearchParams();
  const preset = params.get('preset') || 'last_30d';

  const [meta, setMeta] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/share/${slug}/meta`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('This dashboard is not available.'))))
      .then(setMeta)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  const load = useCallback(async () => {
    if (!meta || (meta.requiresPassword && !token)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/share/${slug}/dashboard${toQueryString({ preset })}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Could not load this dashboard.');
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [slug, meta, token, preset]);

  useEffect(() => { void load(); }, [load]);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/share/${slug}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) return setError('Incorrect password.');
    const body = await res.json();
    setToken(body.token);
  }

  if (!meta && loading) return <Centered><Spinner label="Loading…" /></Centered>;
  if (!meta) return <Centered><ErrorNote message={error || 'Not found'} /></Centered>;

  if (meta.requiresPassword && !token) {
    return (
      <Centered>
        <form onSubmit={unlock} className="bg-white rounded-2xl border border-meadow-200 p-6 w-full max-w-sm">
          <Lock className="w-6 h-6 text-meadow-600 mb-3" />
          <h1 className="font-semibold text-forest">{meta.name}</h1>
          <p className="text-sm text-forest-muted mt-1 mb-4">This dashboard is password protected.</p>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full px-4 py-2.5 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500"
          />
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          <button type="submit" className="mt-3 w-full bg-forest hover:bg-forest-light text-white font-medium py-2.5 rounded-full text-sm">
            View dashboard
          </button>
        </form>
      </Centered>
    );
  }

  const stats = data?.stats?.current;
  const granularity = data?.range?.granularity ?? 'day';

  return (
    <div className="min-h-screen bg-meadow-50">
      <nav className="bg-white/90 backdrop-blur-md border-b border-meadow-200 px-4 sm:px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Sparkles className="w-5 h-5 text-meadow-600 shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold text-forest truncate">{meta.name}</div>
              <div className="text-[11px] text-forest-muted truncate">{meta.domain}</div>
            </div>
          </div>
          <select
            value={preset}
            onChange={(e) => setParams({ preset: e.target.value }, { replace: true })}
            className="text-sm bg-white border border-meadow-200 rounded-full px-3 py-1.5 focus:outline-none"
          >
            {PRESETS.filter((p) => p.value !== 'custom').map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {error && <ErrorNote message={error} onRetry={load} />}

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label="Live now" value={data?.liveVisitors ?? 0} accent />
          <StatCard label="Visitors" value={stats?.visitors ?? 0} loading={loading && !stats} />
          <StatCard label="Pageviews" value={stats?.pageviews ?? 0} loading={loading && !stats} />
          <StatCard label="Bounce rate" value={stats?.bounceRate ?? 0} suffix="%" loading={loading && !stats} />
          <StatCard label="Avg. session" value={formatDuration(stats?.avgSessionSec)} loading={loading && !stats} />
        </div>

        <Panel title="Traffic">
          {!(data?.series ?? []).length ? (
            <EmptyState title="No traffic in this period" />
          ) : (
            <div className="p-4">
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data.series} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="share-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3d8b42" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#3d8b42" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dceede" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#4b5b47' }} tickFormatter={(b) => formatBucket(b, granularity)} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: '#4b5b47' }} allowDecimals={false} width={48} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #dceede', fontSize: 12 }} />
                  <Area type="monotone" dataKey="visitors" name="Visitors" stroke="#3d8b42" strokeWidth={2} fill="url(#share-grad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <div className="grid lg:grid-cols-2 gap-6">
          <ShareList title="Top pages" rows={data?.pages ?? []} labelKey="path" valueKey="views" />
          <ShareList title="Top sources" rows={data?.sources ?? []} labelKey="value" valueKey="visitors" />
          <ShareList title="Countries" rows={data?.countries ?? []} labelKey="value" valueKey="visitors" format={countryName} />
          <ShareList title="Devices" rows={data?.devices ?? []} labelKey="value" valueKey="visitors" />
        </div>

        <p className="text-center text-[11px] text-forest-muted pb-6">
          Powered by Pulse Analytics · {formatNumber(stats?.sessions ?? 0)} sessions in this period
        </p>
      </div>
    </div>
  );
}

function ShareList({ title, rows, labelKey, valueKey, format }: {
  title: string;
  rows: any[];
  labelKey: string;
  valueKey: string;
  format?: (v: string) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  return (
    <Panel title={title}>
      {!rows.length ? (
        <EmptyState title="No data" />
      ) : (
        <div className="max-h-80 overflow-y-auto">
          {rows.map((r, i) => (
            <BarRow
              key={`${r[labelKey]}-${i}`}
              label={format ? format(r[labelKey]) : r[labelKey]}
              value={Number(r[valueKey]) || 0}
              max={max}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-meadow-50 flex items-center justify-center p-4">{children}</div>;
}
