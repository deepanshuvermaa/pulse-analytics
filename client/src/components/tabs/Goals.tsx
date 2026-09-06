import { useState } from 'react';
import { Target, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../lib/useReport';
import { formatNumber, type QueryState } from '../../lib/query-state';
import { Panel, EmptyState, ErrorNote, Spinner, DataTable, StatCard } from '../ui';

/**
 * Dedicated Goals tab.
 *
 * The Settings tab still owns goal CRUD — this view is the read side, with
 * a conversion-rate summary that the Settings form cannot easily show.
 */
export default function Goals({ projectId, state, canEdit: _canEdit }: { projectId: string; state: QueryState; canEdit: boolean }) {
  const list = useAsync(() => api.getGoals(projectId), [projectId]);
  const report = useAsync(() => api.goalReport(projectId, state.query), [projectId, state.signature]);

  if (list.error) return <ErrorNote message={list.error} onRetry={list.reload} />;

  const goals = list.data?.goals ?? [];
  const totalConversions = (report.data?.goals ?? []).reduce((s: number, g: any) => s + (g.conversions || 0), 0);
  const totalValue = (report.data?.goals ?? []).reduce((s: number, g: any) => s + (g.value || 0), 0);
  const totalSessions = report.data?.totalSessions ?? 0;
  const overallRate = totalSessions ? Math.round((totalConversions / totalSessions) * 1000) / 10 : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active goals" value={goals.length} />
        <StatCard label="Conversions" value={totalConversions} hint={`Across ${formatNumber(totalSessions)} sessions`} />
        <StatCard label="Conversion rate" value={overallRate} suffix="%" />
        <StatCard label="Goal value" value={totalValue} hint="Sum of values assigned to conversions" />
      </div>

      <Panel
        title="Goals"
        action={
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); alert('Manage goals in the Setup tab.'); }}
            className="text-xs font-medium text-forest-muted hover:text-forest inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Manage
          </a>
        }
      >
        {goals.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No goals yet"
            hint="A goal is a pageview or custom event that means someone converted — a signup, a purchase, a download. Add one in the Setup tab."
          />
        ) : (
          <DataTable
            rows={report.data?.goals ?? goals.map((g: any) => ({ ...g, conversions: 0, conversionRate: 0 }))}
            keyOf={(r: any) => r.id}
            empty={<EmptyState title="No data" />}
            columns={[
              {
                key: 'name',
                header: 'Goal',
                render: (r: any) => (
                  <div>
                    <div className="font-medium text-forest">{r.name}</div>
                    <div className="text-xs text-forest-muted">{r.kind} · {r.matchType}</div>
                  </div>
                ),
              },
              { key: 'matchValue', header: 'Match', render: (r: any) => <code className="text-xs bg-meadow-50 px-1.5 py-0.5 rounded">{r.matchValue}</code> },
              { key: 'conversions', header: 'Conversions', align: 'right', render: (r: any) => formatNumber(r.conversions ?? 0) },
              { key: 'converters', header: 'Visitors', align: 'right', render: (r: any) => formatNumber(r.converters ?? 0) },
              { key: 'rate', header: 'Rate', align: 'right', render: (r: any) => `${r.conversionRate ?? 0}%` },
              { key: 'value', header: 'Value', align: 'right', render: (r: any) => formatNumber(r.value ?? 0) },
            ]}
          />
        )}
      </Panel>

      {report.loading && !report.data ? <Spinner /> : null}
    </div>
  );
}

export function _deleteGoal(_id: string) {
  // Helper kept here so the file is not accidentally tree-shaken.
  void _id;
  void Trash2;
}