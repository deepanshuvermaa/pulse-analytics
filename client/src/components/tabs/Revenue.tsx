import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar } from 'recharts';
import { DollarSign } from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../lib/useReport';
import { formatBucket, formatNumber, type QueryState } from '../../lib/query-state';
import { Panel, StatCard, EmptyState, ErrorNote, Spinner, DataTable } from '../ui';

export default function Revenue({ projectId, state }: { projectId: string; state: QueryState }) {
  const overview = useAsync(() => api.revenueOverview(projectId, state.query), [projectId, state.signature]);
  const timeseries = useAsync(() => api.revenueTimeseries(projectId, state.query), [projectId, state.signature]);
  const channels = useAsync(() => api.revenueChannels(projectId, state.query), [projectId, state.signature]);

  if (overview.error) return <ErrorNote message={overview.error} onRetry={overview.reload} />;

  const range = overview.data?.range;
  const granularity = state.granularity === '' ? 'day' : (state.granularity || 'day');
  const series = (timeseries.data?.series ?? []).map((s: any) => ({
    day: s.day,
    revenue: Number(s.revenue ?? 0),
    conversions: Number(s.conversions ?? 0),
  }));

  const rows = (channels.data?.channels ?? []).map((c: any) => ({
    channel: c.channel ?? 'Unknown',
    revenue: Number(c.revenue ?? 0),
    sessions: Number(c.sessions ?? 0),
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Revenue" value={`$${formatNumber(overview.data?.revenue ?? 0)}`} hint="Sum of goal conversion_value over the period" />
        <StatCard label="Conversions" value={formatNumber(overview.data?.conversions ?? 0)} />
        <StatCard label="Avg order value" value={overview.data?.conversions ? `$${(Math.round(((overview.data?.revenue ?? 0) / overview.data.conversions) * 100) / 100)}` : '—'} />
        <StatCard label="Active channels" value={rows.length} />
      </div>

      <Panel title="Revenue over time">
        {timeseries.loading && !timeseries.data ? <Spinner /> : !series.length ? (
          <EmptyState icon={DollarSign} title="No revenue yet" hint="Tag your goals with a value to see revenue attribution. Send purchase events to /api/payments/ingest with a write key." />
        ) : (
          <div className="p-4">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3d8b42" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#3d8b42" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#dceede" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#4b5b47' }} tickFormatter={(b) => formatBucket(String(b), granularity)} minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: '#4b5b47' }} allowDecimals={false} width={64} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #dceede', fontSize: 12 }} formatter={(v: any) => `$${formatNumber(Number(v))}`} />
                <Area type="monotone" dataKey="revenue" stroke="#3d8b42" strokeWidth={2} fill="url(#rev-grad)" />
              </AreaChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-forest-muted px-4 pb-3">
              {range?.from} → {range?.to}. Time zone follows the project's timezone.
            </p>
          </div>
        )}
      </Panel>

      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="Revenue by channel">
          {rows.length === 0 ? <EmptyState title="No channel revenue yet" /> : (
            <div className="p-4">
              <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 32)}>
                <BarChart data={rows} layout="vertical" margin={{ left: 12, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dceede" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#4b5b47' }} tickFormatter={(v) => `$${formatNumber(Number(v))}`} />
                  <YAxis type="category" dataKey="channel" tick={{ fontSize: 11, fill: '#4b5b47' }} width={100} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #dceede', fontSize: 12 }} formatter={(v: any) => `$${formatNumber(Number(v))}`} />
                  <Bar dataKey="revenue" fill="#3d8b42" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Channel breakdown">
          <DataTable
            rows={rows}
            keyOf={(r: any) => r.channel}
            columns={[
              { key: 'channel', header: 'Channel', render: (r: any) => r.channel },
              { key: 'revenue', header: 'Revenue', align: 'right', render: (r: any) => `$${formatNumber(r.revenue)}` },
              { key: 'sessions', header: 'Sessions', align: 'right', render: (r: any) => formatNumber(r.sessions) },
              { key: 'rps', header: 'Rev / session', align: 'right', render: (r: any) => `$${(r.revenue / Math.max(1, r.sessions)).toFixed(2)}` },
            ]}
            empty={<EmptyState title="No data" />}
          />
        </Panel>
      </div>
    </div>
  );
}