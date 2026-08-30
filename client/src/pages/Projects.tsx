import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Plus, Sparkles, LogOut, FolderOpen, Shield, X, Code, BarChart3, Zap, MessageSquare, Send } from 'lucide-react';

export default function Projects({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [projects, setProjects] = useState<any[]>(() => {
    try { return JSON.parse(sessionStorage.getItem('pulse_projects') || '[]'); } catch { return []; }
  });
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const [suggestionSent, setSuggestionSent] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const navigate = useNavigate();

  useEffect(() => {
    load();
    if (!localStorage.getItem('pulse_onboarded')) setShowOnboarding(true);
    // Live counts go stale fast; refresh the list while the page is open.
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);

  async function load() {
    try {
      const data = (await api.getProjects()).projects;
      setProjects(data);
      sessionStorage.setItem('pulse_projects', JSON.stringify(data));
    } catch {
      /* keep the cached list rather than blanking the page */
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    try {
      // Default to the browser's zone — far more often right than UTC.
      await api.createProject({ name, domain, timezone });
      setShowCreate(false);
      setName('');
      setDomain('');
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create project');
    }
  }

  return (
    <div className="min-h-screen bg-meadow-50">
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-meadow-200 px-4 sm:px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-meadow-600" />
            <span className="font-semibold text-forest">Pulse Analytics</span>
          </div>
          <div className="flex items-center gap-3">
            {user.role === 'admin' && <Link to="/admin" className="text-xs font-medium text-meadow-600 bg-meadow-100 px-3 py-1.5 rounded-full flex items-center gap-1"><Shield className="w-3 h-3" />Admin</Link>}
            <span className="text-sm text-forest-muted hidden sm:block">{user.email}</span>
            <button onClick={onLogout} className="text-forest-muted hover:text-forest p-2 rounded-lg hover:bg-meadow-100 transition-colors"><LogOut className="w-4 h-4" /></button>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-forest">Your Projects</h1>
            <p className="text-sm text-forest-muted mt-1">Select a project to view analytics</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="bg-forest hover:bg-forest-light text-white font-medium px-5 py-2.5 rounded-full transition-colors flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> Add Project
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} className="bg-white rounded-2xl p-6 border border-meadow-200 mb-6 flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-semibold text-forest-muted uppercase tracking-wide mb-1.5">Name</label>
              <input className="w-full px-4 py-2.5 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500" placeholder="My App" value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-semibold text-forest-muted uppercase tracking-wide mb-1.5">Domain</label>
              <input className="w-full px-4 py-2.5 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500" placeholder="myapp.com" value={domain} onChange={e => setDomain(e.target.value)} required />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-semibold text-forest-muted uppercase tracking-wide mb-1.5">Timezone</label>
              <input className="w-full px-4 py-2.5 rounded-lg border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500" value={timezone} onChange={e => setTimezone(e.target.value)} placeholder="Asia/Kolkata" required />
            </div>
            <button type="submit" className="bg-meadow-600 hover:bg-meadow-700 text-white font-medium px-5 py-2.5 rounded-full text-sm">Create</button>
            <button type="button" onClick={() => { setShowCreate(false); setCreateError(null); }} className="text-forest-muted hover:text-forest font-medium px-4 py-2.5 text-sm">Cancel</button>
            {createError && <p className="w-full text-xs text-red-600">{createError}</p>}
            <p className="w-full text-[11px] text-forest-muted">
              Every daily figure for this project is counted in the timezone you pick. It can be changed later in Setup.
            </p>
          </form>
        )}

        {projects.length === 0 ? (
          <div className="text-center py-20">
            <FolderOpen className="w-12 h-12 text-meadow-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-forest mb-2">No projects yet</h3>
            <p className="text-sm text-forest-muted">Add your first project to start tracking</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(p => (
              <div key={p.id} onClick={() => navigate(`/dashboard/${p.id}`)} className="bg-white rounded-2xl p-5 border border-meadow-200 cursor-pointer hover:border-meadow-400 hover:-translate-y-0.5 transition-all group">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-forest group-hover:text-meadow-700 transition-colors truncate">{p.name}</h3>
                  {p.liveVisitors > 0 && (
                    <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-meadow-700 bg-meadow-100 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-meadow-500 animate-pulse" />
                      {p.liveVisitors}
                    </span>
                  )}
                </div>
                <p className="text-sm text-forest-muted mt-1 truncate">{p.domain}</p>
                <div className="flex items-center justify-between mt-3">
                  <p className="text-xs text-meadow-400 font-mono">{p.id}</p>
                  <p className="text-[11px] text-forest-muted">
                    {p.lastEventAt ? `active ${new Date(p.lastEventAt).toLocaleDateString()}` : 'no data yet'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Suggestion Floating Button */}
        <button onClick={() => setShowSuggestion(true)} className="fixed bottom-6 right-6 bg-forest hover:bg-forest-light text-white w-12 h-12 rounded-full shadow-lg flex items-center justify-center z-40 transition-colors" title="Send a suggestion">
          <MessageSquare className="w-5 h-5" />
        </button>

        {/* Suggestion Modal */}
        {showSuggestion && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full relative shadow-2xl">
              <button onClick={() => { setShowSuggestion(false); setSuggestionSent(false); }} className="absolute top-4 right-4 text-forest-muted hover:text-forest"><X className="w-5 h-5" /></button>
              <h3 className="text-lg font-bold text-forest mb-2">💡 Send a Suggestion</h3>
              <p className="text-sm text-forest-muted mb-4">Help us improve Pulse. What feature or fix would you love?</p>
              {suggestionSent ? (
                <div className="text-center py-4"><p className="text-meadow-600 font-semibold">Thanks! We received your suggestion. 🎉</p></div>
              ) : (
                <form onSubmit={async (e) => { e.preventDefault(); try { await api.sendSuggestion(suggestion); setSuggestionSent(true); setSuggestion(''); } catch { /* leave the text for a retry */ } }}>
                  <textarea className="w-full px-4 py-3 rounded-xl border border-meadow-200 bg-meadow-50 text-sm focus:outline-none focus:border-meadow-500 resize-none h-28" placeholder="I wish Pulse could..." value={suggestion} onChange={e => setSuggestion(e.target.value)} required />
                  <button type="submit" className="mt-3 w-full bg-forest hover:bg-forest-light text-white font-semibold py-2.5 rounded-full transition-colors flex items-center justify-center gap-2 text-sm"><Send className="w-4 h-4" /> Submit</button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* Onboarding Modal */}
        {showOnboarding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl p-8 max-w-md w-full relative shadow-2xl">
              <button onClick={() => { setShowOnboarding(false); localStorage.setItem('pulse_onboarded', '1'); }} className="absolute top-4 right-4 text-forest-muted hover:text-forest"><X className="w-5 h-5" /></button>
              <h2 className="text-2xl font-bold text-forest mb-2">Welcome to Pulse! 🎉</h2>
              <p className="text-sm text-forest-muted mb-6">Here's how to get started in 3 simple steps:</p>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-meadow-100 flex items-center justify-center flex-shrink-0"><Plus className="w-4 h-4 text-meadow-700" /></div>
                  <div><h4 className="font-semibold text-forest text-sm">1. Add a project</h4><p className="text-xs text-forest-muted">Click "Add Project" and enter your site name + domain.</p></div>
                </div>
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-meadow-100 flex items-center justify-center flex-shrink-0"><Code className="w-4 h-4 text-meadow-700" /></div>
                  <div><h4 className="font-semibold text-forest text-sm">2. Copy the snippet</h4><p className="text-xs text-forest-muted">Go to your project → Snippet tab → paste the script in your site's {'<head>'}.</p></div>
                </div>
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-meadow-100 flex items-center justify-center flex-shrink-0"><BarChart3 className="w-4 h-4 text-meadow-700" /></div>
                  <div><h4 className="font-semibold text-forest text-sm">3. Watch data flow</h4><p className="text-xs text-forest-muted">Visit your site once — data appears in your dashboard within seconds.</p></div>
                </div>
              </div>
              <button onClick={() => { setShowOnboarding(false); localStorage.setItem('pulse_onboarded', '1'); }} className="mt-6 w-full bg-forest hover:bg-forest-light text-white font-semibold py-3 rounded-full transition-colors">
                Got it, let's go!
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
