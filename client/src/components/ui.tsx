import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { formatNumber } from '../lib/query-state';

export function Panel({ title, action, children, className = '' }: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-2xl border border-meadow-200 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-meadow-100">
          {typeof title === 'string' ? <h3 className="font-semibold text-forest text-sm">{title}</h3> : title}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * Stat tile with an optional period-over-period delta.
 *
 * `invertColor` flips the good/bad colouring for metrics where down is good —
 * bounce rate, error count, load time.
 */
export function StatCard({
  label, value, change, suffix, hint, accent, invertColor, loading,
}: {
  label: string;
  value: number | string;
  change?: number | null;
  suffix?: string;
  hint?: string;
  accent?: boolean;
  invertColor?: boolean;
  loading?: boolean;
}) {
  const display = typeof value === 'number' ? formatNumber(value) : value;
  const positive = change !== null && change !== undefined && change > 0;
  const negative = change !== null && change !== undefined && change < 0;
  const good = invertColor ? negative : positive;
  const bad = invertColor ? positive : negative;

  return (
    <div className={`rounded-2xl p-5 border ${accent ? 'bg-forest border-forest' : 'bg-white border-meadow-200'}`}>
      <div className={`text-xs font-medium uppercase tracking-wide ${accent ? 'text-white/60' : 'text-forest-muted'}`}>
        {label}
      </div>

      <div className="flex items-end gap-2 mt-2">
        <div className={`text-3xl font-bold leading-none ${accent ? 'text-white' : 'text-forest'}`}>
          {loading ? <span className="inline-block w-16 h-7 rounded bg-meadow-100 animate-pulse" /> : display}
          {!loading && suffix && <span className="text-base font-medium ml-1">{suffix}</span>}
        </div>

        {change !== null && change !== undefined && !loading && (
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-semibold pb-1 ${
              good ? 'text-meadow-600' : bad ? 'text-red-600' : accent ? 'text-white/50' : 'text-forest-muted'
            }`}
            title="vs. previous period"
          >
            {positive ? <ArrowUp className="w-3 h-3" /> : negative ? <ArrowDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            {Math.abs(change)}%
          </span>
        )}
      </div>

      {hint && <div className={`text-xs mt-2 ${accent ? 'text-white/50' : 'text-forest-muted'}`}>{hint}</div>}
    </div>
  );
}

export function EmptyState({ title, hint, icon: Icon }: { title: string; hint?: string; icon?: any }) {
  return (
    <div className="px-5 py-12 text-center">
      {Icon && <Icon className="w-10 h-10 text-meadow-300 mx-auto mb-3" />}
      <p className="text-sm font-medium text-forest">{title}</p>
      {hint && <p className="text-xs text-forest-muted mt-1 max-w-md mx-auto">{hint}</p>}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
      <p className="text-sm text-red-700">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-xs font-semibold text-red-700 underline whitespace-nowrap">
          Retry
        </button>
      )}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  width?: string;
  render: (row: T) => ReactNode;
  /** Optional click handler — used to drill a row into a filter. */
  onClick?: (row: T) => void;
}

export function DataTable<T>({ columns, rows, empty, keyOf }: {
  columns: Array<Column<T>>;
  rows: T[];
  empty: ReactNode;
  keyOf: (row: T, index: number) => string;
}) {
  if (!rows.length) return <>{empty}</>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px]">
        <thead>
          <tr className="bg-meadow-50 text-[11px] font-semibold text-forest-muted uppercase tracking-wide">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-5 py-2.5 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={keyOf(row, i)} className="border-t border-meadow-100 hover:bg-meadow-50/60">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-5 py-2.5 text-sm ${col.align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${
                    col.onClick ? 'cursor-pointer' : ''
                  }`}
                  onClick={col.onClick ? () => col.onClick!(row) : undefined}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Horizontal proportion bar used behind breakdown rows. */
export function BarRow({ label, value, max, secondary, onClick }: {
  label: ReactNode;
  value: number;
  max: number;
  secondary?: ReactNode;
  onClick?: () => void;
}) {
  const pct = max > 0 ? Math.max((value / max) * 100, 1.5) : 0;
  return (
    <div
      className={`relative px-4 py-2 border-t border-meadow-100 first:border-t-0 ${onClick ? 'cursor-pointer hover:bg-meadow-50/60' : ''}`}
      onClick={onClick}
    >
      <div className="absolute inset-y-0 left-0 bg-meadow-100/70 rounded-r" style={{ width: `${pct}%` }} aria-hidden />
      <div className="relative flex items-center justify-between gap-3">
        <span className="text-sm text-forest truncate">{label}</span>
        <span className="text-sm font-semibold text-forest tabular-nums whitespace-nowrap">
          {formatNumber(value)}
          {secondary && <span className="ml-2 text-xs font-normal text-forest-muted">{secondary}</span>}
        </span>
      </div>
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <div className="inline-block w-6 h-6 border-2 border-meadow-300 border-t-meadow-600 rounded-full animate-spin" />
      <p className="text-xs text-forest-muted mt-3">{label}</p>
    </div>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const tones = {
    neutral: 'bg-meadow-100 text-meadow-700',
    good: 'bg-meadow-100 text-meadow-700',
    warn: 'bg-amber-100 text-amber-700',
    bad: 'bg-red-100 text-red-700',
  };
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${tones[tone]}`}>{children}</span>;
}
