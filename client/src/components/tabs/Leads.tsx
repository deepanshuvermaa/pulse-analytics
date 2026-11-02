import { useState } from 'react';
import { Users, Download, Plus, X, Phone, MessageCircle, Globe, Bot } from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../lib/useReport';
import { Panel, StatCard, EmptyState, ErrorNote, Spinner, DataTable, Pill } from '../ui';

const STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost', 'junk'];
const STATUS_TONE: Record<string, 'neutral' | 'good' | 'warn' | 'bad'> = {
  new: 'warn', contacted: 'neutral', qualified: 'good', won: 'good', lost: 'bad', junk: 'bad',
};

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function display(phone: string | null): string {
  if (!phone) return '';
  return phone.startsWith('91') && phone.length === 12 ? `+91 ${phone.slice(2, 7)} ${phone.slice(7)}` : `+${phone}`;
}

/**
 * Lead inbox: every source (site forms, Maps scraper sync, Harvey, manual entry)
 * merged by phone number and ranked by score. Not filtered by the date range —
 * an old lead is still a lead.
 */
export default function Leads({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [filters, setFilters] = useState({ status: 'open', source: '', q: '' });
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const query = { status: filters.status, source: filters.source || undefined, q: filters.q || undefined };
  const signature = JSON.stringify(query);
  const summary = useAsync(() => api.leadSummary(projectId), [projectId]);
  const list = useAsync(() => api.getLeads(projectId, query), [projectId, signature]);

  if (summary.error) return <ErrorNote message={summary.error} onRetry={summary.reload} />;
  const s = summary.data;
  const reload = () => { summary.reload(); list.reload(); };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Hot leads" value={s?.hot ?? 0} accent hint={`Open leads scoring ${s?.hotScore ?? 50}+`} loading={summary.loading && !s} />
        <StatCard label="New this week" value={s?.last_7_days ?? 0} loading={summary.loading && !s} />
        <StatCard label="Untouched" value={s?.new ?? 0} hint="Status still new" loading={summary.loading && !s} />
        <StatCard label="Won" value={s?.won ?? 0} hint={`of ${s?.total ?? 0} leads`} loading={summary.loading && !s} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="Leads by source">
          <Breakdown rows={(s?.bySource ?? []).map((r: any) => ({ label: r.source, leads: r.leads, won: r.won }))} />
        </Panel>
        <Panel title="Leads by channel (first visit)">
          <Breakdown rows={(s?.byChannel ?? []).map((r: any) => ({ label: r.channel, leads: r.leads, won: r.won }))} />
        </Panel>
      </div>

      <Panel
        title="Inbox"
        action={
          <div className="flex items-center gap-2">
            {canEdit && (
              <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-meadow-700 hover:text-forest">
                <Plus className="w-3.5 h-3.5" /> Add lead
              </button>
            )}
            <button onClick={() => void api.exportLeads(projectId, query)} className="inline-flex items-center gap-1 text-xs font-semibold text-meadow-700 hover:text-forest">
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </div>
        }
      >
        <div className="flex flex-wrap gap-2 px-5 py-3 border-b border-meadow-100">
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="text-sm border border-meadow-200 rounded-lg px-2 py-1.5">
            <option value="open">Open (new, contacted, qualified)</option>
            <option value="all">All statuses</option>
            {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
          <select value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })} className="text-sm border border-meadow-200 rounded-lg px-2 py-1.5">
            <option value="">All sources</option>
            {(s?.bySource ?? []).map((r: any) => <option key={r.source} value={r.source}>{r.source}</option>)}
          </select>
          <input
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            placeholder="Search name, shop, phone, email"
            className="text-sm border border-meadow-200 rounded-lg px-3 py-1.5 flex-1 min-w-[200px]"
          />
        </div>

        {list.error ? <ErrorNote message={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <Spinner /> : (
          <DataTable
            rows={list.data?.leads ?? []}
            keyOf={(r: any) => r.id}
            empty={<EmptyState icon={Users} title="No leads here yet" hint="Website forms post to /api/leads/capture; the scraper and Harvey push to /api/leads/ingest with this project's write key." />}
            columns={[
              { key: 'score', header: 'Score', width: '70px', render: (r: any) => <span className={`font-bold tabular-nums ${r.score >= (s?.hotScore ?? 50) ? 'text-red-600' : 'text-forest'}`}>{r.score}</span> },
              { key: 'who', header: 'Lead', render: (r: any) => (
                <button onClick={() => setSelected(r.id)} className="text-left">
                  <div className="font-semibold text-forest hover:underline">{r.business_name || r.name || display(r.phone) || r.email}</div>
                  <div className="text-xs text-forest-muted">{[r.name && r.business_name ? r.name : null, r.business_type, r.city].filter(Boolean).join(' · ')}</div>
                </button>
              ) },
              { key: 'contact', header: 'Contact', render: (r: any) => (
                <div className="text-xs space-y-0.5">
                  {r.phone && <div className="tabular-nums">{display(r.phone)}</div>}
                  {r.email && <div className="text-forest-muted">{r.email}</div>}
                </div>
              ) },
              { key: 'source', header: 'Source', render: (r: any) => (
                <div className="text-xs">
                  <div>{(r.sources ?? [r.source]).join(' + ')}</div>
                  {r.channel && <div className="text-forest-muted">{r.channel}{r.touches > 1 ? ` · ${r.touches} touches` : ''}</div>}
                </div>
              ) },
              { key: 'status', header: 'Status', render: (r: any) => <Pill tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Pill> },
              { key: 'seen', header: 'Last seen', align: 'right', render: (r: any) => <span className="text-xs text-forest-muted">{when(r.last_seen_at)}</span> },
            ]}
          />
        )}
        {(list.data?.total ?? 0) > (list.data?.leads?.length ?? 0) && (
          <p className="text-[11px] text-forest-muted px-5 py-3">Showing top {list.data.leads.length} of {list.data.total}. Narrow with filters or export CSV for the full list.</p>
        )}
      </Panel>

      {selected && <LeadDrawer projectId={projectId} leadId={selected} canEdit={canEdit} onClose={() => setSelected(null)} onChanged={reload} />}
      {adding && <AddLead projectId={projectId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </div>
  );
}

function Breakdown({ rows }: { rows: Array<{ label: string; leads: number; won: number }> }) {
  if (!rows.length) return <p className="text-sm text-forest-muted px-5 py-4">No leads yet.</p>;
  const max = Math.max(...rows.map((r) => r.leads), 1);
  return (
    <div className="px-5 py-3 space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="text-sm">
          <div className="flex justify-between mb-1"><span className="text-forest">{r.label}</span><span className="tabular-nums text-forest-muted">{r.leads}{r.won ? ` · ${r.won} won` : ''}</span></div>
          <div className="h-1.5 bg-meadow-100 rounded-full"><div className="h-1.5 bg-meadow-600 rounded-full" style={{ width: `${(r.leads / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function LeadDrawer({ projectId, leadId, canEdit, onClose, onChanged }: { projectId: string; leadId: string; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const detail = useAsync(() => api.getLead(projectId, leadId), [projectId, leadId]);
  const [notes, setNotes] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lead = detail.data?.lead;
  // AI calls run on the agency PC (local runner); the hub only queues them.
  const calls = useAsync(() => api.getJobs(projectId, { kind: 'voice_call', leadId }), [projectId, leadId]);
  const [callNote, setCallNote] = useState<string | null>(null);
  const aiCall = async () => {
    setCallNote(null);
    try {
      await api.queueJob(projectId, 'voice_call', {
        phone: `+${lead.phone}`, leadId, name: lead.name || lead.business_name || '',
        need: (lead.attributes?.pitch ?? [])[0] || lead.business_type || '',
        // Consent: only leads that came in themselves (forms, WhatsApp, callbacks) may be called.
        source: lead.source, consentAt: lead.last_seen_at,
      });
      setCallNote('Queued — the agency PC will place the call and log the outcome here.');
      calls.reload();
    } catch (e) {
      setCallNote(e instanceof Error ? e.message : 'Could not queue the call');
    }
  };

  const save = async (change: { status?: string; notes?: string | null }) => {
    setSaving(true);
    try {
      await api.updateLead(projectId, leadId, change);
      detail.reload();
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-white overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-meadow-100">
          <h3 className="font-semibold text-forest">{lead?.business_name || lead?.name || 'Lead'}</h3>
          <button onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        {detail.error ? <ErrorNote message={detail.error} onRetry={detail.reload} /> : !lead ? <Spinner /> : (
          <div className="p-5 space-y-5 text-sm">
            <div className="flex gap-2">
              {lead.phone && <a href={`tel:+${lead.phone}`} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-meadow-200"><Phone className="w-3.5 h-3.5" /> Call</a>}
              {lead.phone && <a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-meadow-200"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</a>}
              {canEdit && <a href={`?tab=sites&lead=${lead.id}`} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-meadow-200"><Globe className="w-3.5 h-3.5" /> Build website</a>}
              {canEdit && lead.phone && <button onClick={() => void aiCall()} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-meadow-200"><Bot className="w-3.5 h-3.5" /> AI call</button>}
            </div>
            <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5">
              {[
                ['Score', lead.score], ['Name', lead.name], ['Phone', display(lead.phone)], ['Email', lead.email],
                ['Business', lead.business_type], ['City', lead.city], ['Address', lead.address], ['Website', lead.website],
                ['Sources', (lead.sources ?? []).join(', ')], ['Channel', lead.channel], ['Landing page', lead.landing_path],
                ['Campaign', lead.utm_campaign], ['First seen', new Date(lead.first_seen_at).toLocaleString('en-IN')],
              ].filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
                <div key={String(k)} className="contents"><dt className="text-forest-muted">{k}</dt><dd className="col-span-2 break-words">{String(v)}</dd></div>
              ))}
            </dl>
            {lead.message && <div><p className="text-forest-muted mb-1">Message</p><p className="whitespace-pre-wrap">{lead.message}</p></div>}

            {canEdit && (
              <div className="space-y-2">
                <p className="text-forest-muted">Status</p>
                <div className="flex flex-wrap gap-1.5">
                  {STATUSES.map((st) => (
                    <button key={st} disabled={saving} onClick={() => void save({ status: st })}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${lead.status === st ? 'bg-forest text-white border-forest' : 'border-meadow-200 text-forest'}`}>{st}</button>
                  ))}
                </div>
                <textarea
                  value={notes ?? lead.notes ?? ''}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes — call outcome, demo date, objections"
                  className="w-full border border-meadow-200 rounded-lg p-2 h-24"
                />
                <button disabled={saving || notes === null} onClick={() => void save({ notes })} className="px-3 py-1.5 rounded-lg bg-forest text-white text-xs font-semibold disabled:opacity-50">Save notes</button>
              </div>
            )}

            <div>
              {callNote && <p className="text-xs text-forest mb-2">{callNote}</p>}
              {(calls.data?.jobs ?? []).length > 0 && (
                <div className="mb-4">
                  <p className="text-forest-muted mb-1">AI calls</p>
                  <ul className="space-y-1 text-xs">
                    {calls.data.jobs.map((j: any) => (
                      <li key={j.id} className="border-l-2 border-meadow-200 pl-3">
                        <span className="font-semibold">{j.status}</span> · {new Date(j.created_at).toLocaleString('en-IN')}
                        {j.result?.output?.reason ? ` · ${j.result.output.reason}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-forest-muted mb-2">Timeline</p>
              <ul className="space-y-2">
                {(detail.data?.events ?? []).map((e: any, i: number) => (
                  <li key={i} className="text-xs border-l-2 border-meadow-200 pl-3">
                    <div className="font-semibold text-forest">
                      {e.kind === 'touch' ? `Came in via ${e.source}` : e.kind === 'status' ? `Status ${e.detail?.from} → ${e.detail?.to}` : 'Note updated'}
                    </div>
                    <div className="text-forest-muted">{new Date(e.created_at).toLocaleString('en-IN')}{e.actor ? ` · ${e.actor}` : ''}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddLead({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', business_name: '', phone: '', email: '', city: '', source: 'manual', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof typeof form, label: string) => (
    <label className="block text-xs text-forest-muted">{label}
      <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="mt-1 w-full border border-meadow-200 rounded-lg px-2 py-1.5 text-sm text-forest" />
    </label>
  );
  const submit = async () => {
    setError(null);
    try {
      await api.addLead(projectId, Object.fromEntries(Object.entries(form).filter(([, v]) => v)));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-forest">Add a lead</h3>
        {field('name', 'Name')}
        {field('business_name', 'Business')}
        {field('phone', 'Phone')}
        {field('email', 'Email')}
        {field('city', 'City')}
        <label className="block text-xs text-forest-muted">Source
          <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="mt-1 w-full border border-meadow-200 rounded-lg px-2 py-1.5 text-sm text-forest">
            {['manual', 'referral', 'whatsapp', 'harvey', 'walk_in', 'phone_call'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {field('notes', 'Notes')}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-xs">Cancel</button>
          <button onClick={() => void submit()} className="px-3 py-1.5 rounded-lg bg-forest text-white text-xs font-semibold">Save</button>
        </div>
      </div>
    </div>
  );
}
