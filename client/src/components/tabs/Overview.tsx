import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Activity } from 'lucide-react';
import { useReport } from '../../lib/useReport';
import { formatBucket, formatDuration, formatNumber, type QueryState } from '../../lib/query-state';
import { Panel, StatCard, EmptyState, ErrorNote, BarRow } from '../ui';

const CHART_METRICS = [
  { key: 'visitors', label: 'Visitors', color: '#3d8b42' },
  { key: 'pageviews', label: 'Pageviews', color: '#85c488' },
  { key: 'sessions', label: 'Sessions', color: '#2d6e32' },
];

export default function Overview({ projectId, state }: { projectId: string; state: QueryState }) {
  const overview = useReport(projectId, 'overview', state.query, { refreshMs: 60_000 });
  const audience = useReport(projectId, 'audience', state.query);
  const pages = useReport(projectId, 'pages', { ...state.query, limit: '8' });

  if (overview.error) return <ErrorNote message={overview.error} onRetry={overview.reload} />;

  const stats = overview.data?.stats?.current;
  const change = overview.data?.stats?.change ?? {};
  const series = overview.data?.series ?? [];
  const granularity = overview.data?.range?.granularity ?? 'day';
  const comparing = !!overview.data?.range?.compare;

  const maxSource = Math.max(1, ...(audience.data?.sources ?? []).map((s: any) => s.visitors));
  const maxPage = Math.max(1, ...(pages.data?.data ?? []).map((p: any) => p.views));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Live now" value={overview.data?.liveVisitors ?? 0} accent hint="Active in the last 5 minutes" />
        <StatCard label="Visitors" value={stats?.visitors ?? 0} change={comparing ? change.visitors : undefined} loading={overview.loading && !stats} />
        <StatCard label="Pageviews" value={stats?.pageviews ?? 0} change={comparing ? change.pageviews : undefined} loading={overview.loading && !stats} />
        <StatCard label="Sessions" value={stats?.sessions ?? 0} change={comparing ? change.sessions : undefined} loading={overview.loading && !stats} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Bounce rate"
          value={stats?.bounceRate ?? 0}
          suffix="%"
          change={comparing ? change.bounceRate : undefined}
          invertColor
          hint="One page, no interaction, under 10s"
          loading={overview.loading && !stats}
        />
        <StatCard
          label="Avg. session"
          value={formatDuration(stats?.avgSessionSec)}
          change={comparing ? change.avgSessionSec : undefined}
          loading={overview.loading && !stats}
        />
        <StatCard
          label="Pages / session"
          value={stats?.pagesPerSession ?? 0}
          change={comparing ? change.pagesPerSession : undefined}
          loading={overview.loading && !stats}
        />
        <StatCard
          label="New visitors"
          value={stats?.newVisitors ?? 0}
          change={comparing ? change.newVisitors : undefined}
          hint={stats ? `${formatNumber(stats.returningVisitors)} returning` : undefined}
          loading={overview.loading && !stats}
        />
      </div>

      <Panel title="Traffic">
        {series.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No traffic in this period"
            hint="Try a wider date range, or check the Setup tab to confirm the snippet is installed."
          />
        ) : (
          <div className="p-4">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={series} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  {CHART_METRICS.map((m) => (
                    <linearGradient key={m.key} id={`grad-${m.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={m.color} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={m.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#dceede" vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tick={{ fontSize: 11, fill: '#4b5b47' }}
                  tickFormatter={(b) => formatBucket(b, granularity)}
                  minTickGap={24}
                />
                <YAxis tick={{ fontSize: 11, fill: '#4b5b47' }} allowDecimals={false} width={48} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: '1px solid #dceede', fontSize: 12 }}
                  labelFormatter={(b) => formatBucket(String(b), granularity)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {CHART_METRICS.map((m) => (
                  <Area
                    key={m.key}
                    type="monotone"
                    dataKey={m.key}
                    name={m.label}
                    stroke={m.color}
                    strokeWidth={2}
                    fill={`url(#grad-${m.key})`}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="Top pages">
          {(pages.data?.data ?? []).length === 0 ? (
            <EmptyState title="No pages yet" />
          ) : (
            <div>
              {pages.data.data.map((p: any) => (
                <BarRow
                  key={p.path}
                  label={p.path}
                  value={p.views}
                  max={maxPage}
                  secondary={`${p.visitors} visitors`}
                  onClick={() => state.setFilter('path', p.path)}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Top sources">
          {(audience.data?.sources ?? []).length === 0 ? (
            <EmptyState title="No referral data yet" hint="Traffic with no referrer is reported as Direct." />
          ) : (
            <div>
              {audience.data.sources.slice(0, 8).map((s: any) => (
                <BarRow
                  key={s.value}
                  label={s.value}
                  value={s.visitors}
                  max={maxSource}
                  secondary={`${s.bounceRate}% bounce`}
                  onClick={() => state.setFilter('source', s.value)}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
