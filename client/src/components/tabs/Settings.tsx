import { useState } from 'react';
import {
  Check, Copy, RefreshCw, Trash2, Plus, Target, Bell, Users, Share2,
  CheckCircle2, AlertTriangle, Loader2, KeyRound, Radio,
} from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../lib/useReport';
import { formatNumber, type QueryState } from '../../lib/query-state';
import { Panel, EmptyState, ErrorNote, Spinner, Pill, DataTable } from '../ui';

/** Common IANA zones, plus whatever the browser reports, so the list is short but useful. */
const TIMEZONES = Array.from(new Set([
  Intl.DateTimeFormat().resolvedOptions().timeZone,
  'UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Australia/Sydney', 'Africa/Lagos', 'Africa/Johannesburg',
].filter(Boolean))) as string[];

export default function Settings({ projectId, state, canEdit, isOwner, onProjectChange }: {
  projectId: string;
  state: QueryState;
  canEdit: boolean;
  isOwner: boolean;
  onProjectChange: () => void;
}) {
  const detail = useAsync(() => api.getProject(projectId), [projectId]);
  const project = detail.data?.project;

  if (detail.error) return <ErrorNote message={detail.error} onRetry={detail.reload} />;
  if (!project) return <Panel><Spinner /></Panel>;

  return (
    <div className="space-y-6">
      <SetupStatus projectId={projectId} />
      <Snippet snippet={detail.data.snippet} project={project} serverExample={detail.data.serverExample} />
      <ProjectSettings project={project} canEdit={canEdit} onSaved={() => { detail.reload(); onProjectChange(); }} />
      <Goals projectId={projectId} state={state} canEdit={canEdit} />
      <Alerts projectId={projectId} canEdit={canEdit} />
      {isOwner && <Team projectId={projectId} />}
      {isOwner && <Sharing projectId={projectId} project={project} onSaved={detail.reload} />}
      {isOwner && <DangerZone projectId={projectId} onChanged={onProjectChange} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

function SetupStatus({ projectId }: { projectId: string }) {
  const status = useAsync(() => api.setupStatus(projectId), [projectId]);
  const d = status.data;

  return (
    <Panel
      title="Installation"
      action={
        <button onClick={status.reload} className="text-xs text-forest-muted hover:text-forest inline-flex items-center gap-1">
          <RefreshCw className={`w-3 h-3 ${status.loading ? 'animate-spin' : ''}`} /> Check now
        </button>
      }
    >
      <div className="p-5">
        {!d ? (
          <Spinner label="Checking for events…" />
        ) : !d.installed ? (
          <div className="flex items-start gap-3">
            <Loader2 className="w-5 h-5 text-meadow-500 animate-spin mt-0.5" />
            <div>
              <p className="text-sm font-medium text-forest">Waiting for your first event…</p>
              <p className="text-xs text-forest-muted mt-1">
                Paste the snippet below into your site's <code className="bg-meadow-50 px-1 rounded">&lt;head&gt;</code>,
                then load a page. This panel turns green within seconds.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className={`w-5 h-5 mt-0.5 ${d.receiving ? 'text-meadow-600' : 'text-amber-500'}`} />
              <div>
                <p className="text-sm font-medium text-forest">
                  {d.receiving ? 'Receiving events' : 'Installed, but quiet'}
                </p>
                <p className="text-xs text-forest-muted mt-1">
                  First event {new Date(d.firstEventAt).toLocaleString()} ·
                  {' '}last event {d.lastEventAt ? new Date(d.lastEventAt).toLocaleString() : 'never'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Last 5 min', value: d.liveNow },
                { label: 'Last 24 hours', value: d.last24h },
                { label: 'Distinct pages', value: d.distinctPaths },
                { label: 'Custom events', value: d.customEvents },
              ].map((m) => (
                <div key={m.label} className="bg-meadow-50 rounded-xl px-3 py-2">
                  <div className="text-[11px] text-forest-muted">{m.label}</div>
                  <div className="text-lg font-bold text-forest">{formatNumber(m.value)}</div>
                </div>
              ))}
            </div>

            {d.warnings?.map((w: string) => (
              <div key={w} className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-800">{w}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function CopyBox({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      {label && <div className="text-[11px] font-semibold text-forest-muted uppercase tracking-wide mb-1.5">{label}</div>}
      <div className="relative">
        <pre className="bg-forest/95 text-meadow-300 rounded-xl p-4 pr-12 text-xs overflow-x-auto whitespace-pre-wrap break-all">
          {value}
        </pre>
        <button
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
          className="absolute top-2 right-2 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"
          aria-label="Copy"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

function Snippet({ snippet, project, serverExample }: { snippet: string; project: any; serverExample: string }) {
  return (
    <Panel title="Tracking snippet">
      <div className="p-5 space-y-5">
        <CopyBox value={snippet} label="Paste inside <head>" />

        <div className="bg-meadow-50 rounded-xl p-4 text-xs text-forest space-y-1.5">
          <p className="font-semibold">Works with React, Next.js, Vue, Svelte, WordPress, Webflow, plain HTML.</p>
          <p className="text-forest-muted">
            The script is under 3&nbsp;KB gzipped, sets no cookies in cookieless mode, and tracks SPA route
            changes automatically.
          </p>
        </div>

        <CopyBox
          label="Track custom events from your app"
          value={`// Fire an event\npulse('event', 'signup_completed', { plan: 'pro' });\n\n// Identify a signed-in user (enables retention + cohorts)\npulse('identify', user.id);\n\n// Let a visitor opt out\npulse('opt_out');`}
        />

        <CopyBox label="Server-side events (secret write key)" value={serverExample} />

        {project.writeKey && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <KeyRound className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800">
              The write key is a secret. Use it only from your backend — never in browser code.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}

function ProjectSettings({ project, canEdit, onSaved }: { project: any; canEdit: boolean; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: project.name,
    domain: project.domain,
    timezone: project.timezone,
    identityMode: project.identityMode,
    retentionDays: project.retentionDays,
    excludedPaths: (project.excludedPaths ?? []).join('\n'),
    excludedIps: (project.excludedIps ?? []).join('\n'),
    clarityId: project.clarityId ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.updateProject(project.id, {
        name: form.name,
        domain: form.domain,
        timezone: form.timezone,
        identityMode: form.identityMode,
        retentionDays: Number(form.retentionDays) || 0,
        excludedPaths: lines(form.excludedPaths),
        excludedIps: lines(form.excludedIps),
        clarityId: form.clarityId || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const field = 'mt-1 w-full px-3 py-2 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500 disabled:opacity-60';
  const labelCls = 'text-[11px] font-semibold text-forest-muted uppercase tracking-wide';

  return (
    <Panel title="Project settings">
      <div className="p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className={labelCls}>Name</span>
            <input disabled={!canEdit} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
          </label>
          <label className="block">
            <span className={labelCls}>Domain</span>
            <input disabled={!canEdit} value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} className={field} />
          </label>

          <label className="block">
            <span className={labelCls}>Timezone</span>
            <select disabled={!canEdit} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={field}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
            <span className="text-[11px] text-forest-muted mt-1 block">
              Every "day" in every report is counted in this zone.
            </span>
          </label>

          <label className="block">
            <span className={labelCls}>Data retention</span>
            <select
              disabled={!canEdit}
              value={form.retentionDays}
              onChange={(e) => setForm({ ...form, retentionDays: Number(e.target.value) })}
              className={field}
            >
              <option value={0}>Keep forever</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>1 year</option>
              <option value={730}>2 years</option>
            </select>
          </label>
        </div>

        <div>
          <span className={labelCls}>Visitor identity</span>
          <div className="grid sm:grid-cols-2 gap-3 mt-1.5">
            {[
              {
                value: 'cookieless',
                title: 'Cookieless (recommended)',
                blurb: 'Daily-rotating salted hash. No cookie banner required. Retention across days is unavailable unless you call identify().',
              },
              {
                value: 'persistent',
                title: 'Persistent id',
                blurb: 'Stores a random id in localStorage. Enables retention and returning-visitor metrics. Requires consent in the EU.',
              },
            ].map((opt) => (
              <button
                key={opt.value}
                disabled={!canEdit}
                onClick={() => setForm({ ...form, identityMode: opt.value })}
                className={`text-left rounded-xl border p-3 transition-colors disabled:opacity-60 ${
                  form.identityMode === opt.value ? 'border-meadow-500 bg-meadow-50' : 'border-meadow-200 hover:border-meadow-300'
                }`}
              >
                <div className="text-sm font-medium text-forest flex items-center gap-2">
                  <Radio className={`w-3.5 h-3.5 ${form.identityMode === opt.value ? 'text-meadow-600' : 'text-meadow-300'}`} />
                  {opt.title}
                </div>
                <p className="text-[11px] text-forest-muted mt-1 leading-snug">{opt.blurb}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className={labelCls}>Excluded paths (one per line, * wildcard)</span>
            <textarea
              disabled={!canEdit}
              rows={3}
              value={form.excludedPaths}
              onChange={(e) => setForm({ ...form, excludedPaths: e.target.value })}
              placeholder={'/admin/*\n/preview/*'}
              className={`${field} font-mono text-xs`}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Excluded IPs (one per line)</span>
            <textarea
              disabled={!canEdit}
              rows={3}
              value={form.excludedIps}
              onChange={(e) => setForm({ ...form, excludedIps: e.target.value })}
              placeholder="203.0.113.10"
              className={`${field} font-mono text-xs`}
            />
          </label>
        </div>

        <label className="block max-w-sm">
          <span className={labelCls}>Microsoft Clarity project ID (optional)</span>
          <input
            disabled={!canEdit}
            value={form.clarityId}
            onChange={(e) => setForm({ ...form, clarityId: e.target.value })}
            placeholder="abc123xyz"
            className={field}
          />
          {form.clarityId && (
            <a
              href={`https://clarity.microsoft.com/projects/view/${form.clarityId}/dashboard`}
              target="_blank"
              rel="noopener"
              className="text-xs text-meadow-600 font-medium underline mt-1.5 inline-block"
            >
              Open session recordings in Clarity →
            </a>
          )}
        </label>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {canEdit && (
          <button
            onClick={save}
            disabled={saving}
            className="bg-forest hover:bg-forest-light disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-full"
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save settings'}
          </button>
        )}
      </div>
    </Panel>
  );
}

function Goals({ projectId, state, canEdit }: { projectId: string; state: QueryState; canEdit: boolean }) {
  const report = useAsync(() => api.goalReport(projectId, state.query), [projectId, state.signature]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'pageview', matchValue: '', matchType: 'exact', value: 0 });
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    try {
      await api.createGoal(projectId, { ...form, value: Number(form.value) || 0 });
      setAdding(false);
      setForm({ name: '', kind: 'pageview', matchValue: '', matchType: 'exact', value: 0 });
      report.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create goal');
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this goal? Past conversions will be recalculated.')) return;
    await api.deleteGoal(projectId, id);
    report.reload();
  }

  const field = 'px-3 py-2 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500';

  return (
    <Panel
      title="Goals"
      action={canEdit && !adding && (
        <button onClick={() => setAdding(true)} className="text-xs font-medium text-meadow-600 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" /> New goal
        </button>
      )}
    >
      {adding && (
        <div className="p-5 border-b border-meadow-100 space-y-3">
          <div className="flex flex-wrap gap-2">
            <input placeholder="Goal name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${field} flex-1 min-w-[140px]`} />
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={field}>
              <option value="pageview">Page visit</option>
              <option value="event">Custom event</option>
            </select>
            {form.kind === 'pageview' && (
              <select value={form.matchType} onChange={(e) => setForm({ ...form, matchType: e.target.value })} className={field}>
                <option value="exact">is</option>
                <option value="starts_with">starts with</option>
                <option value="contains">contains</option>
                <option value="regex">regex</option>
              </select>
            )}
            <input
              placeholder={form.kind === 'pageview' ? '/thank-you' : 'signup_completed'}
              value={form.matchValue}
              onChange={(e) => setForm({ ...form, matchValue: e.target.value })}
              className={`${field} flex-1 min-w-[140px]`}
            />
            <input
              type="number"
              placeholder="Value"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: Number(e.target.value) })}
              className={`${field} w-24`}
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={create} className="bg-forest text-white text-sm font-medium px-4 py-1.5 rounded-full">Create</button>
            <button onClick={() => setAdding(false)} className="text-sm text-forest-muted px-3">Cancel</button>
          </div>
          <p className="text-[11px] text-forest-muted">
            Adding a goal recalculates conversions for past days, so historical numbers stay correct.
          </p>
        </div>
      )}

      <DataTable
        rows={report.data?.goals ?? []}
        keyOf={(g: any) => g.id}
        empty={<EmptyState icon={Target} title="No goals defined" hint="A goal turns a page visit or custom event into a conversion, so every report can split by converted vs not." />}
        columns={[
          { key: 'name', header: 'Goal', render: (g: any) => <span className="font-medium text-forest">{g.name}</span> },
          { key: 'match', header: 'Matches', render: (g: any) => <code className="text-xs text-forest-muted">{g.kind === 'event' ? g.matchValue : `${g.matchType} ${g.matchValue}`}</code> },
          { key: 'conversions', header: 'Conversions', align: 'right', render: (g: any) => formatNumber(g.conversions) },
          { key: 'rate', header: 'Rate', align: 'right', render: (g: any) => <Pill>{g.conversionRate}%</Pill> },
          ...(canEdit ? [{
            key: 'actions', header: '', align: 'right' as const,
            render: (g: any) => (
              <button onClick={() => remove(g.id)} className="text-forest-muted hover:text-red-600" aria-label="Delete goal">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            ),
          }] : []),
        ]}
      />
    </Panel>
  );
}

const ALERT_LABELS: Record<string, string> = {
  traffic_spike: 'Traffic spike',
  traffic_drop: 'Traffic drop',
  error_spike: 'Error spike',
  conversion_drop: 'Conversion drop',
  no_data: 'No data received',
};

function Alerts({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const list = useAsync(() => api.getAlerts(projectId), [projectId]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'traffic_drop', threshold: 50, webhookUrl: '' });
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    try {
      await api.createAlert(projectId, { ...form, threshold: Number(form.threshold), webhookUrl: form.webhookUrl || null });
      setAdding(false);
      setForm({ name: '', kind: 'traffic_drop', threshold: 50, webhookUrl: '' });
      list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create alert');
    }
  }

  const field = 'px-3 py-2 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500';

  return (
    <Panel
      title="Alerts"
      action={canEdit && !adding && (
        <button onClick={() => setAdding(true)} className="text-xs font-medium text-meadow-600 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" /> New alert
        </button>
      )}
    >
      {adding && (
        <div className="p-5 border-b border-meadow-100 space-y-3">
          <div className="flex flex-wrap gap-2">
            <input placeholder="Alert name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${field} flex-1 min-w-[140px]`} />
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={field}>
              {Object.entries(ALERT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input
              type="number"
              value={form.threshold}
              onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })}
              className={`${field} w-24`}
              title={form.kind === 'no_data' ? 'Hours without data' : 'Percent change'}
            />
            <input
              placeholder="https://hooks.slack.com/…"
              value={form.webhookUrl}
              onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
              className={`${field} flex-1 min-w-[200px]`}
            />
          </div>
          <p className="text-[11px] text-forest-muted">
            {form.kind === 'no_data'
              ? 'Fires when no events arrive for this many hours.'
              : 'Fires when the last 24 hours differ from the previous 24 hours by this percentage. Checked every 10 minutes, at most once per 6 hours.'}
          </p>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={create} className="bg-forest text-white text-sm font-medium px-4 py-1.5 rounded-full">Create</button>
            <button onClick={() => setAdding(false)} className="text-sm text-forest-muted px-3">Cancel</button>
          </div>
        </div>
      )}

      <DataTable
        rows={list.data?.alerts ?? []}
        keyOf={(a: any) => a.id}
        empty={<EmptyState icon={Bell} title="No alerts configured" hint="Get a Slack or Discord webhook when traffic drops, errors spike, or data stops arriving." />}
        columns={[
          { key: 'name', header: 'Alert', render: (a: any) => <span className="font-medium text-forest">{a.name}</span> },
          { key: 'kind', header: 'Condition', render: (a: any) => `${ALERT_LABELS[a.kind] ?? a.kind} · ${a.threshold}${a.kind === 'no_data' ? 'h' : '%'}` },
          { key: 'last', header: 'Last fired', render: (a: any) => (a.lastFiredAt ? new Date(a.lastFiredAt).toLocaleString() : '—') },
          ...(canEdit ? [{
            key: 'actions', header: '', align: 'right' as const,
            render: (a: any) => (
              <button
                onClick={async () => { if (confirm('Delete this alert?')) { await api.deleteAlert(projectId, a.id); list.reload(); } }}
                className="text-forest-muted hover:text-red-600"
                aria-label="Delete alert"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            ),
          }] : []),
        ]}
      />
    </Panel>
  );
}

function Team({ projectId }: { projectId: string }) {
  const list = useAsync(() => api.getMembers(projectId), [projectId]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [error, setError] = useState<string | null>(null);

  async function invite() {
    setError(null);
    try {
      await api.addMember(projectId, { email, role });
      setEmail('');
      list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add member');
    }
  }

  const field = 'px-3 py-2 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500';

  return (
    <Panel title="Team">
      <div className="p-5 border-b border-meadow-100">
        <div className="flex flex-wrap gap-2">
          <input placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className={`${field} flex-1 min-w-[200px]`} />
          <select value={role} onChange={(e) => setRole(e.target.value)} className={field}>
            <option value="viewer">Viewer — read only</option>
            <option value="member">Member — can edit goals & funnels</option>
            <option value="admin">Admin — full settings</option>
          </select>
          <button onClick={invite} className="bg-forest text-white text-sm font-medium px-4 py-2 rounded-full">Add</button>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        <p className="text-[11px] text-forest-muted mt-2">They need an existing Pulse account first.</p>
      </div>

      <div className="divide-y divide-meadow-100">
        {list.data?.owner && (
          <div className="px-5 py-3 flex items-center justify-between">
            <div>
              <div className="text-sm text-forest">{list.data.owner.email}</div>
              <div className="text-[11px] text-forest-muted">{list.data.owner.name || '—'}</div>
            </div>
            <Pill>Owner</Pill>
          </div>
        )}
        {(list.data?.members ?? []).map((m: any) => (
          <div key={m.id} className="px-5 py-3 flex items-center justify-between">
            <div>
              <div className="text-sm text-forest">{m.email}</div>
              <div className="text-[11px] text-forest-muted">{m.name || '—'}</div>
            </div>
            <div className="flex items-center gap-3">
              <Pill>{m.role}</Pill>
              <button
                onClick={async () => { await api.removeMember(projectId, m.id); list.reload(); }}
                className="text-forest-muted hover:text-red-600"
                aria-label="Remove member"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        {!list.data?.members?.length && (
          <EmptyState icon={Users} title="No teammates yet" hint="Invite people to view or manage this project." />
        )}
      </div>
    </Panel>
  );
}

function Sharing({ projectId, project, onSaved }: { projectId: string; project: any; onSaved: () => void }) {
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState<string | null>(
    project.shareSlug ? `${window.location.origin}/share/${project.shareSlug}` : null,
  );
  const [busy, setBusy] = useState(false);

  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      const res = await api.setShare(projectId, { enabled, password: password || null });
      setUrl(res.shareSlug ? `${window.location.origin}/share/${res.shareSlug}` : null);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Public dashboard">
      <div className="p-5 space-y-4">
        <p className="text-sm text-forest-muted">
          Share a read-only dashboard with anyone — no account required. Segment filters are disabled on public views.
        </p>

        {url ? (
          <>
            <CopyBox value={url} label="Public link" />
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="password"
                placeholder="Set or change password (optional)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="px-3 py-2 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none flex-1 min-w-[200px]"
              />
              <button onClick={() => toggle(true)} disabled={busy} className="bg-meadow-600 text-white text-sm font-medium px-4 py-2 rounded-full">
                Update
              </button>
              <button onClick={() => toggle(false)} disabled={busy} className="text-sm text-red-600 hover:underline px-3">
                Disable sharing
              </button>
            </div>
          </>
        ) : (
          <button onClick={() => toggle(true)} disabled={busy} className="bg-forest text-white text-sm font-medium px-5 py-2 rounded-full inline-flex items-center gap-2">
            <Share2 className="w-4 h-4" /> Create public link
          </button>
        )}
      </div>
    </Panel>
  );
}

function DangerZone({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function rotateSnippet() {
    if (!confirm('Generate a new snippet ID?\n\nThe old snippet stops working immediately. All historical data is preserved and moved to the new ID.')) return;
    setBusy(true);
    try {
      await api.regenerateProject(projectId);
      setMessage('New snippet ID generated. History preserved — update the script tag on your site.');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function rotateKey() {
    if (!confirm('Rotate the server write key? Any backend using the old key will start failing.')) return;
    setBusy(true);
    try {
      await api.rotateWriteKey(projectId);
      setMessage('Write key rotated. Update your backend environment variables.');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={<h3 className="font-semibold text-red-700 text-sm">Danger zone</h3>}>
      <div className="p-5 space-y-3">
        {message && <p className="text-xs bg-meadow-50 text-meadow-700 rounded-lg px-3 py-2">{message}</p>}
        <div className="flex flex-wrap gap-2">
          <button onClick={rotateSnippet} disabled={busy} className="border border-meadow-300 text-forest text-sm font-medium px-4 py-2 rounded-full inline-flex items-center gap-2 hover:bg-meadow-50">
            <RefreshCw className="w-3.5 h-3.5" /> New snippet ID
          </button>
          <button onClick={rotateKey} disabled={busy} className="border border-meadow-300 text-forest text-sm font-medium px-4 py-2 rounded-full inline-flex items-center gap-2 hover:bg-meadow-50">
            <KeyRound className="w-3.5 h-3.5" /> Rotate write key
          </button>
        </div>
        <p className="text-[11px] text-forest-muted">
          Rotating the snippet ID preserves every event, session and rollup — it only invalidates the old script tag.
        </p>
      </div>
    </Panel>
  );
}
