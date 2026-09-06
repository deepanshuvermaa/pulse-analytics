import { useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, LogOut, Sparkles, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useAsync } from '../lib/useReport';
import { useQueryState } from '../lib/query-state';
import { DateRangePicker, FilterBar } from '../components/RangeControls';
import { ErrorNote, Spinner } from '../components/ui';
import Overview from '../components/tabs/Overview';
import Behaviour from '../components/tabs/Behaviour';
import Funnels from '../components/tabs/Funnels';
import Settings from '../components/tabs/Settings';
import Heatmap from '../components/tabs/Heatmap';
import Goals from '../components/tabs/Goals';
import Alerts from '../components/tabs/Alerts';
import Revenue from '../components/tabs/Revenue';
import { Pages, Sources, Performance, Errors, Retention } from '../components/tabs/Reports';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'behaviour', label: 'Behaviour' },
  { key: 'funnels', label: 'Funnels' },
  { key: 'retention', label: 'Retention' },
  { key: 'pages', label: 'Pages' },
  { key: 'sources', label: 'Sources' },
  { key: 'heatmap', label: 'Heatmap' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'performance', label: 'Performance' },
  { key: 'errors', label: 'Errors' },
  { key: 'goals', label: 'Goals' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'settings', label: 'Setup' },
];

export default function Dashboard({ user, onLogout }: { user: any; onLogout: () => void }) {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const state = useQueryState();
  const [reloadKey, setReloadKey] = useState(0);

  const tab = params.get('tab') || 'overview';
  const setTab = (key: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    setParams(next, { replace: true });
  };

  const detail = useAsync(() => api.getProject(id!), [id, reloadKey], { enabled: !!id });
  const project = detail.data?.project;
  const role = detail.data?.role ?? 'viewer';
  const canEdit = role === 'owner' || role === 'admin' || role === 'member';
  const isOwner = role === 'owner' || role === 'admin';

  if (detail.error) {
    return (
      <Shell user={user} onLogout={onLogout}>
        <ErrorNote message={detail.error} onRetry={detail.reload} />
      </Shell>
    );
  }

  if (!project || !id) {
    return <Shell user={user} onLogout={onLogout}><Spinner label="Loading project…" /></Shell>;
  }

  return (
    <Shell user={user} onLogout={onLogout} projectName={project.name} domain={project.domain}>
      {/* Sticky control bar: range and filters apply to every tab. */}
      <div className="sticky top-[57px] z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-meadow-50/95 backdrop-blur-sm border-b border-meadow-200 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 order-2 sm:order-1">
            <FilterBar state={state} />
          </div>
          <div className="flex items-center gap-2 order-1 sm:order-2 ml-auto">
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="p-2 rounded-full border border-meadow-200 bg-white text-forest-muted hover:text-forest"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <DateRangePicker state={state} timezone={project.timezone} />
          </div>
        </div>
      </div>

      <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.key
                ? 'bg-forest text-white'
                : 'bg-white text-forest-muted border border-meadow-200 hover:border-meadow-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div key={`${tab}-${reloadKey}`}>
        {tab === 'overview' && <Overview projectId={id} state={state} />}
        {tab === 'behaviour' && <Behaviour projectId={id} state={state} />}
        {tab === 'funnels' && <Funnels projectId={id} state={state} canEdit={canEdit} />}
        {tab === 'retention' && <Retention projectId={id} state={state} />}
        {tab === 'pages' && <Pages projectId={id} state={state} />}
        {tab === 'sources' && <Sources projectId={id} state={state} />}
        {tab === 'heatmap' && <Heatmap projectId={id} state={state} />}
        {tab === 'revenue' && <Revenue projectId={id} state={state} />}
        {tab === 'performance' && <Performance projectId={id} state={state} />}
        {tab === 'errors' && <Errors projectId={id} state={state} canEdit={canEdit} />}
        {tab === 'goals' && <Goals projectId={id} state={state} canEdit={canEdit} />}
        {tab === 'alerts' && <Alerts projectId={id} state={state} canEdit={canEdit} />}
        {tab === 'settings' && (
          <Settings
            projectId={id}
            state={state}
            canEdit={canEdit}
            isOwner={isOwner}
            onProjectChange={() => setReloadKey((k) => k + 1)}
          />
        )}
      </div>
    </Shell>
  );
}

function Shell({ user, onLogout, projectName, domain, children }: {
  user: any;
  onLogout: () => void;
  projectName?: string;
  domain?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-meadow-50">
      <nav className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-meadow-200 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/projects" className="text-forest-muted hover:text-forest p-2 rounded-lg hover:bg-meadow-100 shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <Sparkles className="w-5 h-5 text-meadow-600 shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold text-forest truncate leading-tight">{projectName || 'Pulse Analytics'}</div>
              {domain && <div className="text-[11px] text-forest-muted truncate">{domain}</div>}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-sm text-forest-muted hidden sm:block">{user?.email}</span>
            <button onClick={onLogout} className="text-forest-muted hover:text-forest p-2 rounded-lg hover:bg-meadow-100">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">{children}</div>
    </div>
  );
}
