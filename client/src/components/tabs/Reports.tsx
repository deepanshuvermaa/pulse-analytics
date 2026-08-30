import { useState } from 'react';
import { Download, FileText, Globe, Gauge, AlertTriangle, CheckCircle2, Users } from 'lucide-react';
import { api } from '../../api';
import { useReport } from '../../lib/useReport';
import { countryName, formatDuration, formatMs, formatNumber, type QueryState } from '../../lib/query-state';
import { Panel, EmptyState, ErrorNote, DataTable, Spinner, BarRow, StatCard, Pill } from '../ui';

function ExportButton({ projectId, report, query }: { projectId: string; report: string; query: any }) {
  return (
    <a
      href={api.exportUrl(projectId, report, query)}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-forest-muted hover:text-forest"
      title="Download as CSV"
    >
      <Download className="w-3.5 h-3.5" /> CSV
    </a>
  );
}

// ─────────────────────────────────────────────────────────────
// Pages
// ─────────────────────────────────────────────────────────────

export function Pages({ projectId, state }: { projectId: string; state: QueryState }) {
  const pages = useReport(projectId, 'pages', { ...state.query, limit: '200' });
  if (pages.error) return <ErrorNote message={pages.error} onRetry={pages.reload} />;

  return (
    <Panel title="Pages" action={<ExportButton projectId={projectId} report="pages" query={state.query} />}>
      {pages.loading && !pages.data ? (
        <Spinner />
      ) : (
        <DataTable
          rows={pages.data?.data ?? []}
          keyOf={(r: any) => r.path}
          empty={<EmptyState icon={FileText} title="No pageviews in this period" />}
          columns={[
            {
              key: 'path',
              header: 'Page',
              render: (r: any) => (
                <button onClick={() => state.setFilter('path', r.path)} className="text-left truncate max-w-[280px] block hover:underline">
                  {r.path}
                </button>
              ),
            },
            { key: 'views', header: 'Views', align: 'right', render: (r: any) => formatNumber(r.views) },
            { key: 'visitors', header: 'Visitors', align: 'right', render: (r: any) => formatNumber(r.visitors) },
            { key: 'time', header: 'Avg time', align: 'right', render: (r: any) => formatDuration(r.avgTimeSec) },
            { key: 'entrances', header: 'Entrances', align: 'right', render: (r: any) => formatNumber(r.entrances) },
            {
              key: 'bounce',
              header: 'Bounce',
              align: 'right',
              render: (r: any) => (r.entrances ? `${r.bounceRate}%` : '—'),
            },
            {
              key: 'exit',
              header: 'Exit rate',
              align: 'right',
              render: (r: any) => <span className={r.exitRate >= 70 ? 'text-red-600 font-semibold' : ''}>{r.exitRate}%</span>,
            },
            { key: 'scroll', header: 'Avg scroll', align: 'right', render: (r: any) => (r.avgScroll ? `${r.avgScroll}%` : '—') },
          ]}
        />
      )}
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
// Sources / audience
// ─────────────────────────────────────────────────────────────

const AUDIENCE_SECTIONS: Array<{ key: string; title: string; filter: string; format?: (v: string) => string }> = [
  { key: 'channels', title: 'Channels', filter: 'channel' },
  { key: 'sources', title: 'Sources', filter: 'source' },
  { key: 'referrers', title: 'Referrers', filter: 'referrerHost' },
  { key: 'countries', title: 'Countries', filter: 'country', format: countryName },
  { key: 'devices', title: 'Devices', filter: 'device' },
  { key: 'browsers', title: 'Browsers', filter: 'browser' },
  { key: 'operatingSystems', title: 'Operating systems', filter: 'os' },
];

export function Sources({ projectId, state }: { projectId: string; state: QueryState }) {
  const audience = useReport(projectId, 'audience', state.query);
  const campaigns = useReport(projectId, 'campaigns', state.query);

  if (audience.error) return <ErrorNote message={audience.error} onRetry={audience.reload} />;
  if (audience.loading && !audience.data) return <Panel><Spinner /></Panel>;

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-2 gap-6">
        {AUDIENCE_SECTIONS.map((section) => {
          const rows = audience.data?.[section.key] ?? [];
          const max = Math.max(1, ...rows.map((r: any) => r.visitors));
          return (
            <Panel
              key={section.key}
              title={section.title}
              action={<ExportButton projectId={projectId} report={section.filter === 'referrerHost' ? 'referrer' : section.filter === 'os' ? 'os' : section.filter} query={state.query} />}
            >
              {rows.length === 0 ? (
                <EmptyState icon={Globe} title="No data" />
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  {rows.map((r: any) => (
                    <BarRow
                      key={r.value}
                      label={section.format ? section.format(r.value) : r.value}
                      value={r.visitors}
                      max={max}
                      secondary={`${r.bounceRate}% bounce`}
                      onClick={() => state.setFilter(section.filter as any, r.value)}
                    />
                  ))}
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {[
          { key: 'sources', title: 'UTM source', filter: 'utmSource' },
          { key: 'mediums', title: 'UTM medium', filter: 'utmMedium' },
          { key: 'campaigns', title: 'UTM campaign', filter: 'utmCampaign' },
        ].map((section) => {
          const rows = campaigns.data?.[section.key] ?? [];
          const max = Math.max(1, ...rows.map((r: any) => r.visitors));
          return (
            <Panel key={section.key} title={section.title}>
              {rows.length === 0 ? (
                <EmptyState title="No campaign traffic" />
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {rows.map((r: any) => (
                    <BarRow
                      key={r.value}
                      label={r.value}
                      value={r.visitors}
                      max={max}
                      secondary={`${r.conversionRate}% conv.`}
                      onClick={() => state.setFilter(section.filter as any, r.value)}
                    />
                  ))}
                </div>
              )}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Performance
// ─────────────────────────────────────────────────────────────

/** Google's Core Web Vitals thresholds, graded on p75. */
const VITAL_THRESHOLDS: Record<string, { good: number; poor: number; unit: 'ms' | 'raw'; label: string; blurb: string }> = {
  lcp: { good: 2500, poor: 4000, unit: 'ms', label: 'LCP', blurb: 'Largest Contentful Paint — when the main content appears' },
  inp: { good: 200, poor: 500, unit: 'ms', label: 'INP', blurb: 'Interaction to Next Paint — responsiveness to input' },
  cls: { good: 0.1, poor: 0.25, unit: 'raw', label: 'CLS', blurb: 'Cumulative Layout Shift — visual stability' },
  fcp: { good: 1800, poor: 3000, unit: 'ms', label: 'FCP', blurb: 'First Contentful Paint' },
  ttfb: { good: 800, poor: 1800, unit: 'ms', label: 'TTFB', blurb: 'Time to First Byte — server response' },
};

function grade(key: string, p75: number): 'good' | 'warn' | 'bad' {
  const t = VITAL_THRESHOLDS[key];
  if (!t) return 'neutral' as never;
  if (p75 <= t.good) return 'good';
  if (p75 <= t.poor) return 'warn';
  return 'bad';
}

export function Performance({ projectId, state }: { projectId: string; state: QueryState }) {
  const perf = useReport(projectId, 'performance', state.query);
  if (perf.error) return <ErrorNote message={perf.error} onRetry={perf.reload} />;
  if (perf.loading && !perf.data) return <Panel><Spinner /></Panel>;

  const vitals = perf.data?.vitals ?? {};
  const hasSamples = Object.values(vitals).some((v: any) => v.samples > 0);

  if (!hasSamples) {
    return (
      <Panel>
        <EmptyState
          icon={Gauge}
          title="No performance samples yet"
          hint="Core Web Vitals are collected on real page loads. They will appear after a few visits."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {Object.entries(VITAL_THRESHOLDS).map(([key, t]) => {
          const v = vitals[key];
          if (!v || !v.samples) return <StatCard key={key} label={t.label} value="—" hint="No samples" />;
          const tone = grade(key, v.p75);
          return (
            <div key={key} className="bg-white rounded-2xl p-5 border border-meadow-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-forest-muted uppercase tracking-wide">{t.label}</span>
                <Pill tone={tone}>{tone === 'good' ? 'Good' : tone === 'warn' ? 'Needs work' : 'Poor'}</Pill>
              </div>
              <div className="text-2xl font-bold text-forest mt-2">
                {t.unit === 'ms' ? formatMs(v.p75) : v.p75}
              </div>
              <div className="text-[11px] text-forest-muted mt-1">p75 · {formatNumber(v.samples)} samples</div>
              <div className="text-[11px] text-forest-muted mt-2 leading-snug">{t.blurb}</div>
            </div>
          );
        })}
      </div>

      <Panel title="Percentile distribution">
        <DataTable
          rows={Object.entries(vitals).filter(([, v]: any) => v.samples > 0).map(([key, v]: any) => ({ key, ...v }))}
          keyOf={(r: any) => r.key}
          empty={<EmptyState title="No samples" />}
          columns={[
            {
              key: 'metric',
              header: 'Metric',
              render: (r: any) => (
                <span className="font-medium text-forest">{VITAL_THRESHOLDS[r.key]?.label ?? r.key.toUpperCase()}</span>
              ),
            },
            { key: 'p50', header: 'p50 (median)', align: 'right', render: (r: any) => (r.key === 'cls' ? r.p50 : formatMs(r.p50)) },
            { key: 'p75', header: 'p75', align: 'right', render: (r: any) => (r.key === 'cls' ? r.p75 : formatMs(r.p75)) },
            { key: 'p90', header: 'p90', align: 'right', render: (r: any) => (r.key === 'cls' ? r.p90 : formatMs(r.p90)) },
            { key: 'p99', header: 'p99', align: 'right', render: (r: any) => (r.key === 'cls' ? r.p99 : formatMs(r.p99)) },
            { key: 'samples', header: 'Samples', align: 'right', render: (r: any) => formatNumber(r.samples) },
          ]}
        />
        <p className="px-5 py-3 text-[11px] text-forest-muted border-t border-meadow-100">
          Percentiles, not averages — a mean is dominated by outliers and hides the experience most visitors actually get.
          Google grades on p75.
        </p>
      </Panel>

      <Panel title="Slowest pages (p75 LCP)">
        <DataTable
          rows={perf.data?.slowestPages ?? []}
          keyOf={(r: any) => r.path}
          empty={<EmptyState title="Not enough samples per page yet" hint="A page needs at least 3 samples to appear here." />}
          columns={[
            { key: 'path', header: 'Page', render: (r: any) => <span className="truncate max-w-[300px] block">{r.path}</span> },
            {
              key: 'lcp',
              header: 'p75 LCP',
              align: 'right',
              render: (r: any) => (
                <span className={r.p75Lcp > 2500 ? 'text-red-600 font-semibold' : 'text-forest'}>{formatMs(r.p75Lcp)}</span>
              ),
            },
            { key: 'ttfb', header: 'p75 TTFB', align: 'right', render: (r: any) => formatMs(r.p75Ttfb) },
            { key: 'samples', header: 'Samples', align: 'right', render: (r: any) => formatNumber(r.samples) },
          ]}
        />
      </Panel>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────

export function Errors({ projectId, state, canEdit }: { projectId: string; state: QueryState; canEdit: boolean }) {
  const [showResolved, setShowResolved] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const errors = useReport(projectId, 'errors', { ...state.query, includeResolved: String(showResolved) });
  if (errors.error) return <ErrorNote message={errors.error} onRetry={errors.reload} />;

  async function toggle(fingerprint: string, resolved: boolean) {
    await api.resolveError(projectId, fingerprint, resolved);
    errors.reload();
  }

  const rows = errors.data?.errors ?? [];

  return (
    <Panel
      title={`JavaScript errors — ${formatNumber(errors.data?.total ?? 0)} in ${formatNumber(errors.data?.groups ?? 0)} groups`}
      action={
        <label className="flex items-center gap-1.5 text-xs text-forest-muted cursor-pointer">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          Show resolved
        </label>
      }
    >
      {errors.loading && !errors.data ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No errors captured" hint="Errors are grouped by message and origin, so a single bug shows as one row with a count." />
      ) : (
        <div className="divide-y divide-meadow-100">
          {rows.map((e: any) => (
            <div key={e.fingerprint} className="px-5 py-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${e.resolved ? 'text-meadow-400' : 'text-red-500'}`} />
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => setExpanded(expanded === e.fingerprint ? null : e.fingerprint)}
                    className="text-sm font-medium text-forest text-left break-words hover:underline"
                  >
                    {e.message}
                  </button>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] text-forest-muted">
                    <span>{formatNumber(e.count)} occurrences</span>
                    <span>{formatNumber(e.affectedSessions)} sessions</span>
                    {e.samplePath && <span className="truncate max-w-[200px]">on {e.samplePath}</span>}
                    {e.source && <span className="truncate max-w-[200px]">{e.source}:{e.line}</span>}
                    <span>last {new Date(e.lastSeenAt).toLocaleString()}</span>
                  </div>
                  {expanded === e.fingerprint && e.stack && (
                    <pre className="mt-3 bg-forest/95 text-meadow-300 text-[11px] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                      {e.stack}
                    </pre>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {e.resolved && <Pill tone="good">Resolved</Pill>}
                  {canEdit && (
                    <button
                      onClick={() => toggle(e.fingerprint, !e.resolved)}
                      className="text-[11px] font-medium text-forest-muted hover:text-forest underline whitespace-nowrap"
                    >
                      {e.resolved ? 'Reopen' : 'Resolve'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
// Retention
// ─────────────────────────────────────────────────────────────

function retentionColor(rate: number): string {
  if (rate >= 60) return 'bg-meadow-600 text-white';
  if (rate >= 40) return 'bg-meadow-500 text-white';
  if (rate >= 25) return 'bg-meadow-400 text-white';
  if (rate >= 12) return 'bg-meadow-300 text-forest';
  if (rate > 0) return 'bg-meadow-200 text-forest';
  return 'bg-meadow-50 text-forest-muted';
}

export function Retention({ projectId, state }: { projectId: string; state: QueryState }) {
  const [period, setPeriod] = useState<'week' | 'day'>('week');
  const retention = useReport(projectId, 'retention', { ...state.query, period });

  if (retention.error) return <ErrorNote message={retention.error} onRetry={retention.reload} />;

  const cohorts = retention.data?.cohorts ?? [];
  const columns = Math.max(0, ...cohorts.map((c: any) => c.rates.length));

  return (
    <div className="space-y-4">
      {retention.data && !retention.data.reliable && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
          <p className="text-sm text-amber-800">
            <strong>This project uses cookieless identity.</strong> Visitor ids are re-salted every 24 hours,
            so returning visitors cannot be recognised across days and retention will read close to zero.
            Switch the project to <em>persistent</em> identity in Settings (requires consent in the EU),
            or call <code className="bg-amber-100 px-1 rounded">pulse('identify', userId)</code> for signed-in users.
          </p>
        </div>
      )}

      <Panel
        title="Retention cohorts"
        action={
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as 'week' | 'day')}
            className="text-xs bg-meadow-50 border border-meadow-200 rounded-lg px-2 py-1 focus:outline-none"
          >
            <option value="week">Weekly</option>
            <option value="day">Daily</option>
          </select>
        }
      >
        {retention.loading && !retention.data ? (
          <Spinner />
        ) : !cohorts.length ? (
          <EmptyState icon={Users} title="Not enough history for cohorts" hint="Cohorts need visitors first seen inside the selected range." />
        ) : (
          <div className="overflow-x-auto p-4">
            <table className="text-xs border-separate" style={{ borderSpacing: '3px' }}>
              <thead>
                <tr>
                  <th className="text-left text-forest-muted font-semibold px-2">Cohort</th>
                  <th className="text-right text-forest-muted font-semibold px-2">Size</th>
                  {Array.from({ length: columns }, (_, i) => (
                    <th key={i} className="text-center text-forest-muted font-semibold px-1 w-14">
                      {period === 'week' ? `W${i}` : `D${i}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c: any) => (
                  <tr key={c.cohort}>
                    <td className="text-forest px-2 whitespace-nowrap">{c.cohort}</td>
                    <td className="text-right text-forest font-semibold px-2 tabular-nums">{formatNumber(c.size)}</td>
                    {c.rates.map((rate: number, i: number) => (
                      <td
                        key={i}
                        className={`text-center rounded px-1 py-1.5 tabular-nums ${retentionColor(rate)}`}
                        title={`${c.retained[i]} of ${c.size} visitors`}
                      >
                        {rate > 0 ? `${rate}%` : '·'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
