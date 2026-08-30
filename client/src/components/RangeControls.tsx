import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, X, SlidersHorizontal } from 'lucide-react';
import {
  PRESETS, GRANULARITIES, COMPARE_MODES, FILTER_LABELS,
  type QueryState, type FilterKey,
} from '../lib/query-state';

/**
 * The single date + comparison + granularity control for the whole dashboard.
 * It writes to the URL, so every tab reads the same range without prop drilling.
 */
export function DateRangePicker({ state, timezone }: { state: QueryState; timezone?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = PRESETS.find((p) => p.value === state.preset);
  const label = state.preset === 'custom' && state.from && state.to
    ? `${state.from} → ${state.to}`
    : current?.label || 'Last 7 days';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 bg-white border border-meadow-200 hover:border-meadow-400 rounded-full px-4 py-2 text-sm font-medium text-forest transition-colors"
      >
        <Calendar className="w-4 h-4 text-meadow-600" />
        {label}
        <ChevronDown className={`w-3.5 h-3.5 text-forest-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 bg-white border border-meadow-200 rounded-2xl shadow-lg p-4 space-y-4">
          <div>
            <div className="text-[11px] font-semibold text-forest-muted uppercase tracking-wide mb-2">Period</div>
            <div className="grid grid-cols-2 gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => {
                    state.setRange({ preset: p.value });
                    if (p.value !== 'custom') setOpen(false);
                  }}
                  className={`text-left text-xs px-3 py-2 rounded-lg transition-colors ${
                    state.preset === p.value
                      ? 'bg-forest text-white font-medium'
                      : 'bg-meadow-50 text-forest-muted hover:bg-meadow-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {state.preset === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] font-semibold text-forest-muted uppercase tracking-wide">From</span>
                <input
                  type="date"
                  value={state.from}
                  max={state.to || undefined}
                  onChange={(e) => state.setRange({ preset: 'custom', from: e.target.value })}
                  className="mt-1 w-full px-2 py-1.5 rounded-lg border border-meadow-200 bg-meadow-50 text-xs focus:outline-none focus:border-meadow-500"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-forest-muted uppercase tracking-wide">To</span>
                <input
                  type="date"
                  value={state.to}
                  min={state.from || undefined}
                  onChange={(e) => state.setRange({ preset: 'custom', to: e.target.value })}
                  className="mt-1 w-full px-2 py-1.5 rounded-lg border border-meadow-200 bg-meadow-50 text-xs focus:outline-none focus:border-meadow-500"
                />
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] font-semibold text-forest-muted uppercase tracking-wide">Interval</span>
              <select
                value={state.granularity}
                onChange={(e) => state.setRange({ granularity: e.target.value })}
                className="mt-1 w-full px-2 py-1.5 rounded-lg border border-meadow-200 bg-meadow-50 text-xs focus:outline-none focus:border-meadow-500"
              >
                {GRANULARITIES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-forest-muted uppercase tracking-wide">Compare</span>
              <select
                value={state.compare}
                onChange={(e) => state.setRange({ compare: e.target.value })}
                className="mt-1 w-full px-2 py-1.5 rounded-lg border border-meadow-200 bg-meadow-50 text-xs focus:outline-none focus:border-meadow-500"
              >
                {COMPARE_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
          </div>

          {timezone && (
            <p className="text-[11px] text-forest-muted border-t border-meadow-100 pt-3">
              Days are counted in <strong className="text-forest">{timezone}</strong>, the project timezone.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Active segment filters as removable chips, plus a manual add control.
 * Most filters get applied by clicking a row in a table rather than typed here.
 */
export function FilterBar({ state }: { state: QueryState }) {
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState<FilterKey>('path');
  const [value, setValue] = useState('');

  function apply() {
    if (value.trim()) state.setFilter(key, value.trim());
    setValue('');
    setAdding(false);
  }

  if (!state.filters.length && !adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-forest-muted hover:text-forest border border-dashed border-meadow-300 hover:border-meadow-400 rounded-full px-3 py-1.5 transition-colors"
      >
        <SlidersHorizontal className="w-3.5 h-3.5" /> Add filter
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {state.filters.map((f) => (
        <span
          key={f.key}
          className="inline-flex items-center gap-1.5 bg-forest text-white text-xs font-medium rounded-full pl-3 pr-1.5 py-1.5"
        >
          <span className="text-white/60">{FILTER_LABELS[f.key]}:</span>
          <span className="max-w-[180px] truncate">{f.value}</span>
          <button
            onClick={() => state.setFilter(f.key, null)}
            className="hover:bg-white/20 rounded-full p-0.5"
            aria-label={`Remove ${FILTER_LABELS[f.key]} filter`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}

      {adding ? (
        <span className="inline-flex items-center gap-1 bg-white border border-meadow-300 rounded-full pl-2 pr-1 py-1">
          <select
            value={key}
            onChange={(e) => setKey(e.target.value as FilterKey)}
            className="text-xs bg-transparent focus:outline-none text-forest-muted"
          >
            {(Object.keys(FILTER_LABELS) as FilterKey[]).map((k) => (
              <option key={k} value={k}>{FILTER_LABELS[k]}</option>
            ))}
          </select>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
              if (e.key === 'Escape') { setAdding(false); setValue(''); }
            }}
            placeholder="value…"
            className="text-xs w-32 bg-transparent focus:outline-none text-forest"
          />
          <button onClick={apply} className="text-xs font-semibold text-meadow-600 px-2">Add</button>
        </span>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-forest-muted hover:text-forest border border-dashed border-meadow-300 rounded-full px-3 py-1.5"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" /> Filter
        </button>
      )}

      {state.filters.length > 0 && (
        <button onClick={state.clearFilters} className="text-xs font-medium text-forest-muted hover:text-forest underline">
          Clear all
        </button>
      )}
    </div>
  );
}
