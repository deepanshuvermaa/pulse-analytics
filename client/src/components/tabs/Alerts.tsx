import { useState } from 'react';
import { Bell, Plus, Trash2, Mail, Webhook } from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../lib/useReport';
import { type QueryState } from '../../lib/query-state';
import { Panel, EmptyState, ErrorNote, Spinner, DataTable, Pill } from '../ui';

export default function Alerts({ projectId, state: _state, canEdit }: { projectId: string; state: QueryState; canEdit: boolean }) {
  const list = useAsync(() => api.getAlerts(projectId), [projectId]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('traffic_drop');
  const [threshold, setThreshold] = useState(50);
  const [email, setEmail] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (list.error) return <ErrorNote message={list.error} onRetry={list.reload} />;

  const alerts = list.data?.alerts ?? [];
  const kinds: string[] = list.data?.kinds ?? ['traffic_spike', 'traffic_drop', 'error_spike', 'conversion_drop', 'no_data'];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.createAlert(projectId, { name, kind, threshold, email: email || null, webhookUrl: webhookUrl || null, enabled: true });
      setName(''); setEmail(''); setWebhookUrl(''); setCreating(false);
      list.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create alert');
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this alert?')) return;
    await api.deleteAlert(projectId, id);
    list.reload();
  }

  const baseColumns: any[] = [
    {
      key: 'name',
      header: 'Name',
      render: (r: any) => (
        <div>
          <div className="font-medium text-forest">{r.name}</div>
          <div className="text-xs text-forest-muted">{r.kind} · threshold {r.threshold}{r.kind === 'no_data' ? 'h' : '%'}</div>
        </div>
      ),
    },
    {
      key: 'channels',
      header: 'Channels',
      render: (r: any) => (
        <div className="flex gap-1.5">
          {r.email && <Pill tone="neutral"><Mail className="w-3 h-3 inline mr-0.5" />email</Pill>}
          {r.webhookUrl && <Pill tone="neutral"><Webhook className="w-3 h-3 inline mr-0.5" />webhook</Pill>}
        </div>
      ),
    },
    {
      key: 'last',
      header: 'Last fired',
      render: (r: any) => r.lastFiredAt
        ? <span className="text-xs text-amber-700">{new Date(r.lastFiredAt).toLocaleString()}</span>
        : <span className="text-xs text-forest-muted">Never</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r: any) => <Pill tone={r.enabled ? 'good' : 'neutral'}>{r.enabled ? 'Enabled' : 'Paused'}</Pill>,
    },
  ];
  if (canEdit) baseColumns.push({
    key: 'actions', header: '',
    render: (r: any) => (
      <button onClick={() => remove(r.id)} className="text-forest-muted hover:text-red-600 p-1" aria-label="Delete alert">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    ),
  });

  return (
    <div className="space-y-6">
      <Panel
        title="Alerts"
        action={canEdit ? (
          <button onClick={() => setCreating(true)} className="text-xs font-medium text-forest inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-meadow-100 hover:bg-meadow-200">
            <Plus className="w-3.5 h-3.5" /> New alert
          </button>
        ) : null}
      >
        {!alerts.length ? (
          <EmptyState
            icon={Bell}
            title="No alerts configured"
            hint={canEdit ? 'Get notified on Slack, Discord or email when traffic drops, errors spike, or conversions fall off a cliff.' : 'Only project admins can create alerts.'}
          />
        ) : (
          <DataTable rows={alerts} keyOf={(r: any) => r.id} columns={baseColumns} empty={<EmptyState title="No data" />} />
        )}
      </Panel>
      {list.loading && !list.data ? <Spinner /> : null}

      {creating && (
        <Panel title="New alert">
          <form onSubmit={save} className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label>
                <span className="text-xs font-semibold text-forest-muted uppercase tracking-wide">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full px-3 py-2 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500" />
              </label>
              <label>
                <span className="text-xs font-semibold text-forest-muted uppercase tracking-wide">Kind</span>
                <select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500">
                  {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
              <label>
                <span className="text-xs font-semibold text-forest-muted uppercase tracking-wide">Threshold</span>
                <input type="number" min="1" max="10000" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="mt-1 w-full px-3 py-2 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500" />
              </label>
              <label>
                <span className="text-xs font-semibold text-forest-muted uppercase tracking-wide">Email (optional)</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500" />
              </label>
              <label className="sm:col-span-2">
                <span className="text-xs font-semibold text-forest-muted uppercase tracking-wide">Webhook URL (optional)</span>
                <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://hooks.slack.com/…" className="mt-1 w-full px-3 py-2 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500" />
              </label>
            </div>
            {err && <p className="text-xs text-red-600">{err}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="bg-forest text-white text-sm font-medium px-5 py-2 rounded-full">
                {busy ? 'Saving…' : 'Create alert'}
              </button>
              <button type="button" onClick={() => setCreating(false)} className="text-sm text-forest-muted hover:text-forest px-4">Cancel</button>
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}