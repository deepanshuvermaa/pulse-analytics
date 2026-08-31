import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  ArrowLeft, Users, FolderOpen, Activity, Sparkles, MessageSquare,
  Search, ExternalLink, HeartPulse, ChevronRight,
} from 'lucide-react';
import { api } from '../api';
import { useAsync } from '../lib/useReport';
import { formatNumber } from '../lib/query-state';
import { Panel, StatCard, DataTable, EmptyState, ErrorNote, Spinner, Pill } from '../components/ui';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'projects', label: 'Projects' },
  { key: 'users', label: 'Users' },
  { key: 'health', label: 'Pipeline' },
  { key: 'suggestions', label: 'Feedback' },
];

export default function Admin({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState('overview');

  return (
    <div className="min-h-screen bg-meadow-50">
      <nav className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-meadow-200 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/projects" className="text-forest-muted hover:text-forest p-2 rounded-lg hover:bg-meadow-100">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <Sparkles className="w-5 h-5 text-meadow-600" />
            <span className="font-semibold text-forest">Admin</span>
            <Pill>instance-wide</Pill>
          </div>
          <button onClick={onLogout} className="text-sm text-forest-muted hover:text-forest">Logout</button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t.key ? 'bg-forest text-white' : 'bg-white text-forest-muted border border-meadow-200 hover:border-meadow-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && <Overview />}
        {tab === 'projects' && <Projects />}
        {tab === 'users' && <UsersTab />}
        {tab === 'health' && <Health />}
        {tab === 'suggestions' && <Suggestions />}
      </div>
    </div>
  );
}

function Overview() {
  const stats = useAsync(() => api.adminStats(), []);
  const activity = useAsync(() => api.adminActivity(30), []);

  if (stats.error) return <ErrorNote message={stats.error} onRetry={stats.reload} />;

  const s = stats.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Users" value={s?.users ?? 0} loading={stats.loading && !s} />
        <StatCard label="Projects" value={s?.projects ?? 0} loading={stats.loading && !s} />
        <StatCard label="Events (est.)" value={s?.events ?? 0} loading={stats.loading && !s} hint="Planner estimate — an exact count would scan every partition" />
        <StatCard label="Sessions built" value={s?.sessions ?? 0} loading={stats.loading && !s} />
      </div>

      <Panel title="Instance activity — last 30 days">
        {activity.loading && !activity.data ? (
          <Spinner />
        ) : !(activity.data?.series ?? []).length ? (
          <EmptyState icon={Activity} title="No rollup data yet" />
        ) : (
          <div className="p-4">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={activity.data.series} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="admin-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3d8b42" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#3d8b42" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#dceede" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#4b5b47' }} tickFormatter={(d) => String(d).slice(5)} minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: '#4b5b47' }} width={48} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #dceede', fontSize: 12 }} />
                <Area type="monotone" dataKey="pageviews" name="Pageviews" stroke="#3d8b42" strokeWidth={2} fill="url(#admin-grad)" />
                <Area type="monotone" dataKey="sessions" name="Sessions" stroke="#85c488" strokeWidth={2} fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Projects() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const list = useAsync(() => api.adminProjects(query || undefined), [query]);

  return (
    <Panel
      title="All projects"
      action={
        <form
          onSubmit={(e) => { e.preventDefault(); setQuery(search); }}
          className="flex items-center gap-1.5 bg-meadow-50 border border-meadow-200 rounded-full px-3 py-1"
        >
          <Search className="w-3.5 h-3.5 text-forest-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="name, domain or owner email"
            className="bg-transparent text-xs focus:outline-none w-52 text-forest"
          />
        </form>
      }
    >
      {list.loading && !list.data ? (
        <Spinner />
      ) : list.error ? (
        <div className="p-4"><ErrorNote message={list.error} onRetry={list.reload} /></div>
      ) : (
        <DataTable
          rows={list.data?.projects ?? []}
          keyOf={(p: any) => p.id}
          empty={<EmptyState icon={FolderOpen} title="No projects match" />}
          columns={[
            {
              key: 'name',
              header: 'Project',
              render: (p: any) => (
                <Link to={`/dashboard/${p.id}`} className="group block max-w-[220px]">
                  <span className="font-medium text-forest group-hover:underline flex items-center gap-1">
                    {p.name}
                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                  </span>
                  <span className="block text-[11px] text-forest-muted truncate">{p.domain}</span>
                </Link>
              ),
            },
            {
              key: 'owner',
              header: 'Owner',
              render: (p: any) => (
                <span className="text-xs text-forest-muted truncate block max-w-[180px]">{p.owner?.email}</span>
              ),
            },
            {
              key: 'live',
              header: 'Live',
              align: 'right',
              render: (p: any) =>
                p.liveVisitors > 0
                  ? <span className="inline-flex items-center gap-1 font-semibold text-meadow-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-meadow-500 animate-pulse" />{p.liveVisitors}
                    </span>
                  : <span className="text-forest-muted">—</span>,
            },
            { key: 'sessions', header: 'Sessions 30d', align: 'right', render: (p: any) => formatNumber(p.sessions30d) },
            { key: 'pageviews', header: 'Pageviews 30d', align: 'right', render: (p: any) => formatNumber(p.pageviews30d) },
            { key: 'tz', header: 'Timezone', render: (p: any) => <span className="text-xs text-forest-muted">{p.timezone}</span> },
            {
              key: 'last',
              header: 'Last event',
              align: 'right',
              render: (p: any) =>
                p.lastEventAt
                  ? <span className="text-xs">{new Date(p.lastEventAt).toLocaleDateString()}</span>
                  : <Pill tone="warn">no data</Pill>,
            },
          ]}
        />
      )}
    </Panel>
  );
}

function UsersTab() {
  const list = useAsync(() => api.adminUsers(), []);
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useAsync(() => api.adminUser(selected!), [selected], { enabled: !!selected });

  async function setRole(userId: string, role: string) {
    if (!confirm(`Change this user's instance role to "${role}"?`)) return;
    try {
      await api.adminSetUserRole(userId, role);
      list.reload();
      if (selected === userId) detail.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not change role');
    }
  }

  return (
    <div className="space-y-6">
      <Panel title="Users">
        {list.loading && !list.data ? (
          <Spinner />
        ) : (
          <DataTable
            rows={list.data?.users ?? []}
            keyOf={(u: any) => u.id}
            empty={<EmptyState icon={Users} title="No users" />}
            columns={[
              {
                key: 'email',
                header: 'Email',
                render: (u: any) => (
                  <button onClick={() => setSelected(u.id)} className="text-left hover:underline text-forest flex items-center gap-1">
                    {u.email}
                    <ChevronRight className="w-3 h-3 text-forest-muted" />
                  </button>
                ),
              },
              { key: 'name', header: 'Name', render: (u: any) => <span className="text-forest-muted">{u.name || '—'}</span> },
              { key: 'projects', header: 'Projects', align: 'right', render: (u: any) => u.projectCount },
              {
                key: 'role',
                header: 'Role',
                render: (u: any) => (u.role === 'admin' ? <Pill tone="good">admin</Pill> : <Pill>user</Pill>),
              },
              { key: 'joined', header: 'Joined', align: 'right', render: (u: any) => new Date(u.createdAt).toLocaleDateString() },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (u: any) => (
                  <button
                    onClick={() => setRole(u.id, u.role === 'admin' ? 'user' : 'admin')}
                    className="text-[11px] font-medium text-forest-muted hover:text-forest underline whitespace-nowrap"
                  >
                    {u.role === 'admin' ? 'Demote' : 'Make admin'}
                  </button>
                ),
              },
            ]}
          />
        )}
      </Panel>

      {selected && (
        <Panel
          title={detail.data ? `${detail.data.user.email}` : 'Loading…'}
          action={<button onClick={() => setSelected(null)} className="text-xs text-forest-muted hover:text-forest">Close</button>}
        >
          {detail.loading && !detail.data ? (
            <Spinner />
          ) : (
            <div className="p-5 space-y-4">
              <DataTable
                rows={detail.data?.ownedProjects ?? []}
                keyOf={(p: any) => p.id}
                empty={<EmptyState title="This user owns no projects" />}
                columns={[
                  {
                    key: 'name',
                    header: 'Owned project',
                    render: (p: any) => <Link to={`/dashboard/${p.id}`} className="text-forest hover:underline">{p.name}</Link>,
                  },
                  { key: 'domain', header: 'Domain', render: (p: any) => <span className="text-forest-muted text-xs">{p.domain}</span> },
                  { key: 'sessions', header: 'Sessions 30d', align: 'right', render: (p: any) => formatNumber(p.sessions30d) },
                  { key: 'pageviews', header: 'Pageviews 30d', align: 'right', render: (p: any) => formatNumber(p.pageviews30d) },
                ]}
              />
              {!!(detail.data?.sharedProjects ?? []).length && (
                <div>
                  <h4 className="text-xs font-semibold text-forest-muted uppercase tracking-wide mb-2">Shared with this user</h4>
                  <div className="flex flex-wrap gap-2">
                    {detail.data.sharedProjects.map((p: any) => (
                      <Link key={p.id} to={`/dashboard/${p.id}`} className="text-xs bg-meadow-50 border border-meadow-200 rounded-full px-3 py-1 hover:border-meadow-400">
                        {p.name} <span className="text-forest-muted">({p.role})</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function Health() {
  const health = useAsync(() => api.adminHealth(), []);
  const d = health.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Ingest queue" value={d?.ingestQueue ?? 0} hint="Stream length (trimmed at 1M)" />
        <StatCard
          label="Unacked messages"
          value={d?.ingestPending ?? 0}
          hint="Sustained growth means the writer is stuck"
          invertColor
          change={undefined}
        />
        <StatCard label="Event partitions" value={d?.partitions?.length ?? 0} hint="One per month" />
      </div>

      <Panel title="Per-project pipeline lag">
        {health.loading && !d ? <Spinner /> : (
          <DataTable
            rows={d?.projects ?? []}
            keyOf={(p: any) => String(p.id)}
            empty={<EmptyState icon={HeartPulse} title="No projects" />}
            columns={[
              { key: 'name', header: 'Project', render: (p: any) => p.name },
              { key: 'tz', header: 'Timezone', render: (p: any) => <span className="text-xs text-forest-muted">{p.timezone}</span> },
              { key: 'last', header: 'Last event', render: (p: any) => (p.last_event ? new Date(p.last_event).toLocaleString() : '—') },
              { key: 'rollup', header: 'Last rollup', render: (p: any) => (p.last_rollup ? new Date(p.last_rollup).toLocaleString() : '—') },
              {
                key: 'open',
                header: 'Unsealed days',
                align: 'right',
                render: (p: any) => Number(p.open_days ?? 0),
              },
            ]}
          />
        )}
      </Panel>

      <Panel title="Event table partitions">
        {!d?.partitions?.length ? (
          <EmptyState title="Events table is not partitioned yet" hint="Partitioning is applied on first boot against an existing events table." />
        ) : (
          <div className="p-4 flex flex-wrap gap-2">
            {d.partitions.map((p: any) => (
              <span key={p.name} className="text-xs bg-meadow-50 border border-meadow-200 rounded-lg px-3 py-1.5">
                <span className="font-mono text-forest">{p.name}</span>
                <span className="text-forest-muted ml-2">{p.size}</span>
              </span>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Suggestions() {
  const list = useAsync(() => api.adminSuggestions(), []);

  return (
    <Panel title="User feedback">
      {list.loading && !list.data ? (
        <Spinner />
      ) : !(list.data?.suggestions ?? []).length ? (
        <EmptyState icon={MessageSquare} title="No suggestions yet" />
      ) : (
        <div className="divide-y divide-meadow-100">
          {list.data.suggestions.map((s: any) => (
            <div key={s.id} className="px-5 py-4">
              <div className="flex items-center justify-between mb-1 gap-3">
                <span className="text-sm font-semibold text-forest truncate">{s.email || s.name || 'Anonymous'}</span>
                <span className="text-xs text-forest-muted whitespace-nowrap">{new Date(s.created_at).toLocaleString()}</span>
              </div>
              <p className="text-sm text-forest-muted whitespace-pre-wrap">{s.message}</p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
