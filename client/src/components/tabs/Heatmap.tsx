import { useState } from 'react';
import { Layers, MousePointerClick } from 'lucide-react';
import { api } from '../../api';
import { useAsync, useReport } from '../../lib/useReport';
import { formatNumber, type QueryState } from '../../lib/query-state';
import { Panel, EmptyState, ErrorNote, Spinner, Pill } from '../ui';

/**
 * Click heatmap per page.
 *
 * Renders a normalised 0–1 grid of click points as a CSS heatmap (gaussian
 * blur + colour ramp). No canvas dependency, no images, and it degrades
 * gracefully to a dot cloud on small samples.
 */
export default function Heatmap({ projectId, state }: { projectId: string; state: QueryState }) {
  const pages = useReport(projectId, 'pages', { ...state.query, limit: '50' });
  const [selected, setSelected] = useState<string | null>(null);

  const activePath = selected ?? pages.data?.data?.[0]?.path ?? null;

  if (pages.error) return <ErrorNote message={pages.error} onRetry={pages.reload} />;
  if (!pages.data?.data?.length) {
    return (
      <Panel>
        <EmptyState
          icon={Layers}
          title="No click data yet"
          hint="Once your site has visitors, you will see click density per page here."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {pages.data.data.slice(0, 12).map((p: any) => (
          <button
            key={p.path}
            onClick={() => setSelected(p.path)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors truncate max-w-[280px] ${
              activePath === p.path
                ? 'bg-forest text-white'
                : 'bg-white text-forest-muted border border-meadow-200 hover:border-meadow-400'
            }`}
          >
            {p.path}
          </button>
        ))}
      </div>

      {activePath && <HeatmapCanvas projectId={projectId} path={activePath} state={state} />}
    </div>
  );
}

function HeatmapCanvas({ projectId, path, state }: { projectId: string; path: string; state: QueryState }) {
  const q = { ...state.query, path };
  const heatmap = useAsync(() => api.heatmap(projectId, path, q), [projectId, path, state.signature]);

  if (heatmap.error) return <ErrorNote message={heatmap.error} onRetry={heatmap.reload} />;
  if (heatmap.loading && !heatmap.data) return <Panel><Spinner label="Aggregating clicks…" /></Panel>;

  const points: Array<{ x: number; y: number }> = heatmap.data?.points ?? [];
  const sample = heatmap.data?.sample ?? 0;

  return (
    <Panel
      title={`Heatmap — ${path}`}
      action={
        <div className="flex items-center gap-2">
          <Pill>{formatNumber(sample)} clicks</Pill>
        </div>
      }
    >
      {!points.length ? (
        <EmptyState
          icon={MousePointerClick}
          title="No clicks recorded for this page"
          hint="Click anywhere on the page on a live site to start collecting heat data."
        />
      ) : (
        <div className="p-4">
          <p className="text-[11px] text-forest-muted mb-3">
            Heatmap sampled from {formatNumber(sample)} clicks. Hover the surface to read raw
            density; darker red = more activity.
          </p>
          <div
            className="relative w-full rounded-2xl border border-meadow-200 overflow-hidden"
            style={{
              aspectRatio: '16 / 9',
              background:
                'linear-gradient(180deg, #ffffff 0%, #f7fbf7 100%), repeating-linear-gradient(0deg, transparent 0 23px, rgba(60, 100, 60, 0.04) 23px 24px), repeating-linear-gradient(90deg, transparent 0 23px, rgba(60, 100, 60, 0.04) 23px 24px)',
              backgroundBlendMode: 'multiply, normal, normal',
            }}
          >
            {points.map((p, i) => (
              <span
                key={i}
                title={`${Math.round(p.x * 100)}, ${Math.round(p.y * 100)}`}
                className="absolute rounded-full pointer-events-none"
                style={{
                  left: `${p.x * 100}%`,
                  top: `${p.y * 100}%`,
                  width: 14,
                  height: 14,
                  transform: 'translate(-50%, -50%)',
                  background: 'radial-gradient(circle, rgba(220, 38, 38, 0.55) 0%, rgba(220, 38, 38, 0.0) 70%)',
                  filter: 'blur(3px)',
                }}
              />
            ))}
            <div className="absolute inset-0 pointer-events-none">
              <div
                className="absolute inset-0 opacity-40"
                style={{
                  background:
                    'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.05) 50%, transparent 100%)',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}