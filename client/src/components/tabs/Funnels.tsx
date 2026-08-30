import { useState } from 'react';
import { Filter, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../lib/useReport';
import { formatDuration, formatNumber, type QueryState } from '../../lib/query-state';
import { Panel, EmptyState, ErrorNote, Spinner, Pill } from '../ui';

interface Step { kind: 'pageview' | 'event'; value: string; matchType?: string; label?: string }

export default function Funnels({ projectId, state, canEdit }: {
  projectId: string;
  state: QueryState;
  canEdit: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [breakdown, setBreakdown] = useState('');

  const list = useAsync(() => api.getFunnels(projectId), [projectId]);
  const funnels = list.data?.funnels ?? [];
  const activeId = selectedId ?? funnels[0]?.id ?? null;

  const report = useAsync(
    () => api.funnelReport(projectId, activeId!, { ...state.query, breakdown: breakdown || undefined }),
    [projectId, activeId, state.signature, breakdown],
    { enabled: !!activeId },
  );

  async function remove(id: string) {
    if (!confirm('Delete this funnel?')) return;
    await api.deleteFunnel(projectId, id);
    if (activeId === id) setSelectedId(null);
    list.reload();
  }

  if (list.error) return <ErrorNote message={list.error} onRetry={list.reload} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {funnels.map((f: any) => (
          <button
            key={f.id}
            onClick={() => setSelectedId(f.id)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              activeId === f.id ? 'bg-forest text-white' : 'bg-white text-forest-muted border border-meadow-200 hover:border-meadow-400'
            }`}
          >
            {f.name}
          </button>
        ))}
        {canEdit && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border border-dashed border-meadow-300 text-forest-muted hover:text-forest hover:border-meadow-400"
          >
            <Plus className="w-3.5 h-3.5" /> New funnel
          </button>
        )}
      </div>

      {creating && (
        <FunnelBuilder
          projectId={projectId}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); setSelectedId(id); list.reload(); }}
        />
      )}

      {!funnels.length && !creating && (
        <Panel>
          <EmptyState
            icon={Filter}
            title="No funnels yet"
            hint="A funnel measures how many visitors get from one step to the next, and where they fall out. Two steps minimum — for example /pricing → /signup → signup_completed."
          />
        </Panel>
      )}

      {activeId && (
        <Panel
          title="Conversion"
          action={
            <div className="flex items-center gap-2">
              <select
                value={breakdown}
                onChange={(e) => setBreakdown(e.target.value)}
                className="text-xs bg-meadow-50 border border-meadow-200 rounded-lg px-2 py-1 focus:outline-none"
              >
                <option value="">No breakdown</option>
                {(list.data?.breakdowns ?? []).map((b: string) => (
                  <option key={b} value={b}>By {b.replace('_', ' ')}</option>
                ))}
              </select>
              {canEdit && (
                <button onClick={() => remove(activeId)} className="text-forest-muted hover:text-red-600 p-1" aria-label="Delete funnel">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          }
        >
          {report.loading && !report.data ? (
            <Spinner label="Computing funnel…" />
          ) : report.error ? (
            <div className="p-4"><ErrorNote message={report.error} onRetry={report.reload} /></div>
          ) : (
            <FunnelResult data={report.data} />
          )}
        </Panel>
      )}
    </div>
  );
}

function FunnelResult({ data }: { data: any }) {
  if (!data) return null;
  const steps = data.steps ?? [];
  const max = Math.max(1, ...steps.map((s: any) => s.entered));

  return (
    <div className="p-5 space-y-6">
      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          <div className="text-xs text-forest-muted uppercase tracking-wide">Entered</div>
          <div className="text-2xl font-bold text-forest">{formatNumber(data.totalEntered)}</div>
        </div>
        <div>
          <div className="text-xs text-forest-muted uppercase tracking-wide">Completed</div>
          <div className="text-2xl font-bold text-forest">{formatNumber(data.totalCompleted)}</div>
        </div>
        <div>
          <div className="text-xs text-forest-muted uppercase tracking-wide">Conversion</div>
          <div className="text-2xl font-bold text-meadow-600">{data.overallConversion}%</div>
        </div>
        {data.medianCompletionSeconds !== null && (
          <div>
            <div className="text-xs text-forest-muted uppercase tracking-wide">Median time</div>
            <div className="text-2xl font-bold text-forest">{formatDuration(data.medianCompletionSeconds)}</div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {steps.map((s: any, i: number) => (
          <div key={i}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-forest font-medium truncate">
                <span className="text-forest-muted mr-2">{i + 1}.</span>
                {s.label}
                <span className="ml-2 text-[11px] text-forest-muted">({s.kind})</span>
              </span>
              <span className="text-forest-muted text-xs whitespace-nowrap">
                {formatNumber(s.entered)} · {s.conversionFromStart}% of start
                {i > 0 && s.medianSecondsFromPrevious !== null && (
                  <span className="ml-2">· {formatDuration(s.medianSecondsFromPrevious)} after previous</span>
                )}
              </span>
            </div>
            <div className="h-8 bg-meadow-50 rounded-lg overflow-hidden">
              <div
                className="h-full bg-meadow-500 flex items-center px-3 text-xs font-semibold text-white transition-all"
                style={{ width: `${Math.max((s.entered / max) * 100, 2)}%` }}
              >
                {s.conversionFromPrevious}%
              </div>
            </div>
            {i < steps.length - 1 && s.droppedOff > 0 && (
              <div className="text-[11px] text-red-600 mt-1 ml-1">
                ↓ {formatNumber(s.droppedOff)} dropped off here ({s.dropOffRate}%)
              </div>
            )}
          </div>
        ))}
      </div>

      {!!data.breakdown?.length && (
        <div>
          <h4 className="text-xs font-semibold text-forest-muted uppercase tracking-wide mb-2">
            Conversion by segment
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead>
                <tr className="text-[11px] text-forest-muted uppercase tracking-wide">
                  <th className="text-left py-2">Segment</th>
                  <th className="text-right py-2">Entered</th>
                  <th className="text-right py-2">Completed</th>
                  <th className="text-right py-2">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {data.breakdown.map((b: any) => {
                  const best = Math.max(...data.breakdown.map((x: any) => x.conversion));
                  const worst = Math.min(...data.breakdown.map((x: any) => x.conversion));
                  return (
                    <tr key={b.value} className="border-t border-meadow-100">
                      <td className="py-2 text-sm text-forest">{b.value}</td>
                      <td className="py-2 text-sm text-right tabular-nums">{formatNumber(b.entered)}</td>
                      <td className="py-2 text-sm text-right tabular-nums">{formatNumber(b.completed)}</td>
                      <td className="py-2 text-right">
                        <Pill tone={b.conversion === best ? 'good' : b.conversion === worst ? 'bad' : 'neutral'}>
                          {b.conversion}%
                        </Pill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FunnelBuilder({ projectId, onClose, onCreated }: {
  projectId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [windowHours, setWindowHours] = useState(168);
  const [steps, setSteps] = useState<Step[]>([
    { kind: 'pageview', value: '', matchType: 'exact' },
    { kind: 'pageview', value: '', matchType: 'exact' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(i: number, patch: Partial<Step>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function save() {
    setError(null);
    const cleaned = steps.filter((s) => s.value.trim()).map((s) => ({ ...s, value: s.value.trim() }));
    if (!name.trim()) return setError('Give the funnel a name.');
    if (cleaned.length < 2) return setError('A funnel needs at least two steps with values.');

    setSaving(true);
    try {
      const res = await api.createFunnel(projectId, { name: name.trim(), steps: cleaned, windowHours });
      onCreated(res.funnel.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save funnel');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="New funnel"
      action={<button onClick={onClose} className="text-forest-muted hover:text-forest p-1"><X className="w-4 h-4" /></button>}
    >
      <div className="p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] font-semibold text-forest-muted uppercase tracking-wide">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Signup funnel"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-forest-muted uppercase tracking-wide">Conversion window</span>
            <select
              value={windowHours}
              onChange={(e) => setWindowHours(Number(e.target.value))}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500"
            >
              <option value={1}>1 hour</option>
              <option value={24}>1 day</option>
              <option value={168}>7 days</option>
              <option value={720}>30 days</option>
            </select>
          </label>
        </div>

        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-center">
              <span className="text-xs font-semibold text-forest-muted w-5">{i + 1}.</span>
              <select
                value={s.kind}
                onChange={(e) => update(i, { kind: e.target.value as Step['kind'] })}
                className="px-2 py-2 rounded-lg border border-meadow-200 bg-meadow-50 text-xs focus:outline-none"
              >
                <option value="pageview">Page</option>
                <option value="event">Event</option>
              </select>
              {s.kind === 'pageview' && (
                <select
                  value={s.matchType}
                  onChange={(e) => update(i, { matchType: e.target.value })}
                  className="px-2 py-2 rounded-lg border border-meadow-200 bg-meadow-50 text-xs focus:outline-none"
                >
                  <option value="exact">is</option>
                  <option value="starts_with">starts with</option>
                  <option value="contains">contains</option>
                  <option value="regex">matches regex</option>
                </select>
              )}
              <input
                value={s.value}
                onChange={(e) => update(i, { value: e.target.value })}
                placeholder={s.kind === 'pageview' ? '/pricing' : 'signup_completed'}
                className="flex-1 min-w-[160px] px-3 py-2 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500"
              />
              {steps.length > 2 && (
                <button
                  onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-forest-muted hover:text-red-600 p-1"
                  aria-label={`Remove step ${i + 1}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          {steps.length < 8 && (
            <button
              onClick={() => setSteps((prev) => [...prev, { kind: 'pageview', value: '', matchType: 'exact' }])}
              className="text-xs font-medium text-meadow-600 hover:text-meadow-700 inline-flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add step
            </button>
          )}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="bg-forest hover:bg-forest-light disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-full"
          >
            {saving ? 'Saving…' : 'Create funnel'}
          </button>
          <button onClick={onClose} className="text-sm text-forest-muted hover:text-forest px-4">Cancel</button>
        </div>
      </div>
    </Panel>
  );
}
