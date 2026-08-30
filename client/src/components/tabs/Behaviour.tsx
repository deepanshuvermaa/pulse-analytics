import { useState } from 'react';
import { Sankey, Tooltip, ResponsiveContainer, Layer, Rectangle } from 'recharts';
import { LogOut, MousePointerClick, AlertTriangle, TrendingDown, ArrowLeft, Sparkles } from 'lucide-react';
import { api } from '../../api';
import { useReport, useAsync } from '../../lib/useReport';
import { formatNumber, type QueryState } from '../../lib/query-state';
import { Panel, EmptyState, ErrorNote, DataTable, Spinner, Pill, StatCard } from '../ui';

/**
 * "Where do users leave, and why."
 *
 * Reads top-down: exit pages → pick one → the reasons behind that exit →
 * which audience over-indexes among the leavers. The flow diagram sits
 * underneath so the journey into the exit is visible too.
 */
export default function Behaviour({ projectId, state }: { projectId: string; state: QueryState }) {
  const [selected, setSelected] = useState<string | null>(null);

  const exits = useReport(projectId, 'exits', state.query);
  const frustration = useReport(projectId, 'frustration', state.query);

  if (exits.error) return <ErrorNote message={exits.error} onRetry={exits.reload} />;

  const rows = exits.data?.data ?? [];

  return (
    <div className="space-y-6">
      <Panel
        title="Where visitors leave"
        action={<span className="text-[11px] text-forest-muted">Click a page to see why</span>}
      >
        {exits.loading && !rows.length ? (
          <Spinner />
        ) : (
          <DataTable
            rows={rows}
            keyOf={(r: any) => r.path}
            empty={<EmptyState icon={LogOut} title="No exit data yet" hint="Exit pages appear once sessions have been rolled up." />}
            columns={[
              {
                key: 'path',
                header: 'Exit page',
                render: (r: any) => (
                  <button
                    onClick={() => setSelected(r.path)}
                    className={`text-left truncate max-w-[280px] block hover:underline ${selected === r.path ? 'font-semibold text-forest' : 'text-forest'}`}
                  >
                    {r.path}
                  </button>
                ),
              },
              { key: 'exits', header: 'Exits', align: 'right', render: (r: any) => formatNumber(r.exits) },
              {
                key: 'exitRate',
                header: 'Exit rate',
                align: 'right',
                render: (r: any) => (
                  <span className={r.exitRate >= 70 ? 'text-red-600 font-semibold' : 'text-forest'}>{r.exitRate}%</span>
                ),
              },
              { key: 'bounceRate', header: 'Bounce rate', align: 'right', render: (r: any) => `${r.bounceRate}%` },
              { key: 'scroll', header: 'Avg scroll', align: 'right', render: (r: any) => `${r.avgScrollAtExit}%` },
              {
                key: 'frustration',
                header: 'Frustrated',
                align: 'right',
                render: (r: any) =>
                  r.frustrationRate > 0
                    ? <Pill tone={r.frustrationRate >= 25 ? 'bad' : 'warn'}>{r.frustrationRate}%</Pill>
                    : <span className="text-forest-muted">—</span>,
              },
            ]}
          />
        )}
      </Panel>

      {selected && <ExitReasons projectId={projectId} state={state} path={selected} onClose={() => setSelected(null)} />}

      <FlowDiagram projectId={projectId} state={state} startPath={selected} />

      <Panel title="Frustration signals by page">
        {frustration.loading && !frustration.data ? (
          <Spinner />
        ) : (
          <DataTable
            rows={frustration.data?.byPage ?? []}
            keyOf={(r: any) => r.path}
            empty={
              <EmptyState
                icon={MousePointerClick}
                title="No frustration signals recorded"
                hint="Rage clicks, dead clicks, JS errors and quick-backs appear here as they happen."
              />
            }
            columns={[
              { key: 'path', header: 'Page', render: (r: any) => <span className="truncate max-w-[260px] block">{r.path}</span> },
              { key: 'rage', header: 'Rage clicks', align: 'right', render: (r: any) => r.rageClicks || '—' },
              { key: 'dead', header: 'Dead clicks', align: 'right', render: (r: any) => r.deadClicks || '—' },
              { key: 'errors', header: 'JS errors', align: 'right', render: (r: any) => r.errors || '—' },
              { key: 'quick', header: 'Quick backs', align: 'right', render: (r: any) => r.quickBacks || '—' },
              { key: 'forms', header: 'Form abandons', align: 'right', render: (r: any) => r.formAbandons || '—' },
            ]}
          />
        )}
      </Panel>

      <FormAbandonment data={frustration.data?.forms} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

function ExitReasons({ projectId, state, path, onClose }: {
  projectId: string;
  state: QueryState;
  path: string;
  onClose: () => void;
}) {
  const report = useAsync(
    () => api.report(projectId, 'exit-reasons', { ...state.query, path }),
    [projectId, path, state.signature],
  );

  return (
    <Panel
      title={
        <div className="flex items-center gap-2 min-w-0">
          <TrendingDown className="w-4 h-4 text-red-500 shrink-0" />
          <h3 className="font-semibold text-forest text-sm truncate">Why visitors leave {path}</h3>
        </div>
      }
      action={
        <button onClick={onClose} className="text-xs text-forest-muted hover:text-forest inline-flex items-center gap-1">
          <ArrowLeft className="w-3 h-3" /> Close
        </button>
      }
    >
      {report.loading && !report.data ? (
        <Spinner label="Attributing exits…" />
      ) : report.error ? (
        <div className="p-4"><ErrorNote message={report.error} onRetry={report.reload} /></div>
      ) : (
        <div className="p-5 space-y-6">
          <p className="text-sm text-forest-muted">
            <strong className="text-forest">{formatNumber(report.data?.exits ?? 0)}</strong> sessions ended here.
            Signals are counted in the 30 seconds before the session ended, so one session can carry more than one reason.
          </p>

          <div className="space-y-2">
            {(report.data?.reasons ?? []).map((r: any) => (
              <div key={r.reason} className="relative rounded-lg overflow-hidden border border-meadow-100">
                <div
                  className={`absolute inset-y-0 left-0 ${r.reason === 'no_signal' ? 'bg-meadow-100/70' : 'bg-red-100/70'}`}
                  style={{ width: `${Math.min(r.share, 100)}%` }}
                  aria-hidden
                />
                <div className="relative flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-sm text-forest">{r.label}</span>
                  <span className="text-sm font-semibold text-forest tabular-nums whitespace-nowrap">
                    {r.share}% <span className="text-xs font-normal text-forest-muted">({formatNumber(r.sessions)})</span>
                  </span>
                </div>
              </div>
            ))}
            {!(report.data?.reasons ?? []).length && <EmptyState title="No exits from this page in the selected period" />}
          </div>

          {!!(report.data?.topErrors ?? []).length && (
            <div>
              <h4 className="text-xs font-semibold text-forest-muted uppercase tracking-wide mb-2">Errors seen on this page</h4>
              <ul className="space-y-1.5">
                {report.data.topErrors.map((e: any, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                    <span className="text-red-800 font-mono break-all">{e.message}</span>
                    <span className="ml-auto text-red-600 font-semibold whitespace-nowrap">{e.sessions} sessions</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h4 className="text-xs font-semibold text-forest-muted uppercase tracking-wide mb-2">How far they scrolled before leaving</h4>
            <div className="flex gap-1.5">
              {(report.data?.scrollBuckets ?? []).map((b: any) => {
                const total = (report.data?.exits ?? 0) || 1;
                return (
                  <div key={b.bucket} className="flex-1 text-center">
                    <div className="h-20 flex items-end justify-center">
                      <div
                        className="w-full bg-meadow-400 rounded-t"
                        style={{ height: `${Math.max((b.sessions / total) * 100, 2)}%` }}
                        title={`${b.sessions} sessions`}
                      />
                    </div>
                    <div className="text-[10px] text-forest-muted mt-1">{b.bucket}</div>
                    <div className="text-[11px] font-semibold text-forest">{b.sessions}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {!!(report.data?.segmentLift ?? []).length && (
            <div>
              <h4 className="text-xs font-semibold text-forest-muted uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-meadow-600" />
                Who is over-represented among the leavers
              </h4>
              <div className="space-y-1.5">
                {report.data.segmentLift.map((l: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-sm bg-meadow-50 rounded-lg px-3 py-2">
                    <span className="text-forest">
                      <span className="text-forest-muted capitalize">{l.dimension.replace('_', ' ')}:</span>{' '}
                      <strong>{l.value}</strong>
                    </span>
                    <span className="text-xs whitespace-nowrap">
                      <strong className={l.lift >= 1 ? 'text-red-600' : 'text-meadow-700'}>{l.lift}×</strong>
                      <span className="text-forest-muted"> ({l.targetShare}% here vs {l.baselineShare}% elsewhere)</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────

const FLOW_COLORS = ['#3d8b42', '#5aab5f', '#85c488', '#b8ddb9', '#2d6e32'];

function FlowNode({ x, y, width, height, index, payload }: any) {
  const isExit = payload.name === '(exit)';
  return (
    <Layer key={`node-${index}`}>
      <Rectangle x={x} y={y} width={width} height={height} fill={isExit ? '#dc2626' : FLOW_COLORS[payload.step % FLOW_COLORS.length]} fillOpacity={0.9} />
      <text x={x + width + 6} y={y + height / 2} textAnchor="start" dominantBaseline="middle" fontSize={10} fill="#1f2a1d">
        {payload.name.length > 26 ? `${payload.name.slice(0, 26)}…` : payload.name}
      </text>
    </Layer>
  );
}

function FlowDiagram({ projectId, state, startPath }: { projectId: string; state: QueryState; startPath: string | null }) {
  const [direction, setDirection] = useState<'forward' | 'reverse'>('forward');
  const [depth, setDepth] = useState(4);

  const flow = useReport(projectId, 'flow', {
    ...state.query,
    startPath: startPath ?? undefined,
    direction,
    depth: String(depth),
    minCount: '2',
  });

  const nodes = flow.data?.nodes ?? [];
  const links = flow.data?.links ?? [];

  // Recharts needs at least one link and non-self-referencing indices.
  const usable = links.length > 0 && nodes.length > 1;

  return (
    <Panel
      title={startPath ? `Journey ${direction === 'forward' ? 'from' : 'into'} ${startPath}` : 'User flow'}
      action={
        <div className="flex items-center gap-2">
          {startPath && (
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'forward' | 'reverse')}
              className="text-xs bg-meadow-50 border border-meadow-200 rounded-lg px-2 py-1 focus:outline-none"
            >
              <option value="forward">Where they go next</option>
              <option value="reverse">What led here</option>
            </select>
          )}
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="text-xs bg-meadow-50 border border-meadow-200 rounded-lg px-2 py-1 focus:outline-none"
          >
            {[3, 4, 5, 6].map((d) => <option key={d} value={d}>{d} steps</option>)}
          </select>
        </div>
      }
    >
      {flow.loading && !flow.data ? (
        <Spinner label="Reconstructing journeys…" />
      ) : !usable ? (
        <EmptyState
          title="Not enough journeys to draw a flow"
          hint="Flows need sessions with more than one pageview. Widen the date range, or pick a page above."
        />
      ) : (
        <div className="p-4 overflow-x-auto">
          <ResponsiveContainer width="100%" height={Math.max(280, Math.min(nodes.length * 26, 620))}>
            <Sankey
              data={{
                nodes: nodes.map((n: any) => ({ name: n.path, step: n.step })),
                links,
              }}
              nodePadding={18}
              nodeWidth={12}
              margin={{ top: 10, right: 180, bottom: 10, left: 10 }}
              link={{ stroke: '#85c488', strokeOpacity: 0.3 }}
              node={<FlowNode />}
            >
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid #dceede', fontSize: 12 }}
                formatter={(value: any) => [`${formatNumber(Number(value))} sessions`, '']}
              />
            </Sankey>
          </ResponsiveContainer>
          <p className="text-[11px] text-forest-muted mt-2">
            Red nodes marked <strong>(exit)</strong> are sessions that ended at that step.
          </p>
        </div>
      )}
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────

function FormAbandonment({ data }: { data: any }) {
  if (!data) return null;

  return (
    <Panel title="Form completion">
      <div className="p-5 grid grid-cols-3 gap-4 border-b border-meadow-100">
        <StatCard label="Forms started" value={data.starts ?? 0} />
        <StatCard label="Forms submitted" value={data.submits ?? 0} />
        <StatCard label="Completion rate" value={data.completionRate ?? 0} suffix="%" />
      </div>
      <DataTable
        rows={data.byField ?? []}
        keyOf={(r: any, i: number) => `${r.path}-${r.form}-${r.lastField}-${i}`}
        empty={<EmptyState title="No form abandonment recorded" hint="Fields appear here when a visitor focuses a form and leaves without submitting." />}
        columns={[
          { key: 'path', header: 'Page', render: (r: any) => <span className="truncate max-w-[200px] block">{r.path}</span> },
          { key: 'form', header: 'Form', render: (r: any) => r.form },
          {
            key: 'field',
            header: 'Last field touched',
            render: (r: any) => <code className="text-xs bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded">{r.lastField}</code>,
          },
          { key: 'abandons', header: 'Abandons', align: 'right', render: (r: any) => formatNumber(r.abandons) },
        ]}
      />
    </Panel>
  );
}
