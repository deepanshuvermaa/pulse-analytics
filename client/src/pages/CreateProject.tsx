import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Sparkles, Globe, ArrowRight } from 'lucide-react';
import { api } from '../api';

export default function CreateProject({ user }: { user: any }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Get domain from sessionStorage or location state
    const pendingDomain = sessionStorage.getItem('pulse_pending_domain') || location.state?.domain || '';
    setDomain(pendingDomain);
    
    // Auto-generate name from domain
    if (pendingDomain && !name) {
      const cleanName = pendingDomain.replace(/^www\./, '').split('.')[0];
      setName(cleanName.charAt(0).toUpperCase() + cleanName.slice(1));
    }
    
    // Clear pending domain
    sessionStorage.removeItem('pulse_pending_domain');
  }, [location.state]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.createProject({ name, domain, timezone });
      // Get the created project and navigate to its dashboard
      const projects = await api.getProjects();
      const newProject = projects.projects.find((p: any) => p.domain === domain);
      if (newProject) {
        navigate(`/dashboard/${newProject.id}?tab=settings`);
      } else {
        navigate('/projects');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create project');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-meadow-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-xl font-semibold text-forest mb-2">
            <Sparkles className="w-5 h-5 text-meadow-600" /> Pulse Analytics
          </div>
          <h1 className="text-2xl font-bold text-forest">Create your project</h1>
          <p className="text-sm text-forest-muted mt-1">One more step to start tracking</p>
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-lg border border-meadow-100">
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-forest-muted uppercase tracking-wide mb-1.5">Project Name</label>
              <input
                className="w-full px-4 py-2.5 rounded-lg border border-meadow-200 bg-meadow-50 text-forest text-sm focus:outline-none focus:border-meadow-500 focus:ring-2 focus:ring-meadow-500/20"
                placeholder="My Website"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-forest-muted uppercase tracking-wide mb-1.5">Domain</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-forest-muted" />
                <input
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-meadow-200 bg-meadow-50 text-forest text-sm focus:outline-none focus:border-meadow-500 focus:ring-2 focus:ring-meadow-500/20"
                  placeholder="yourwebsite.com"
                  value={domain}
                  onChange={e => setDomain(e.target.value)}
                  required
                />
              </div>
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-forest hover:bg-forest-light text-white font-semibold py-3 rounded-full transition-colors flex items-center justify-center gap-2"
            >
              {loading ? 'Creating...' : (
                <>Create Project <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </form>
          <p className="text-center text-xs text-forest-muted mt-4">
            You'll get your tracking script immediately after
          </p>
        </div>
      </div>
    </div>
  );
}