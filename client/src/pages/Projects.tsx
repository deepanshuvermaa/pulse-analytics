import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Plus, Sparkles, LogOut, FolderOpen, Shield } from 'lucide-react';

export default function Projects({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const navigate = useNavigate();

  useEffect(() => { load(); }, []);
  async function load() { const r = await api.getProjects(); if (r.ok) setProjects((await r.json()).projects); }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const r = await api.createProject({ name, domain });
    if (r.ok) { setShowCreate(false); setName(''); setDomain(''); load(); }
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
            <button type="submit" className="bg-meadow-600 hover:bg-meadow-700 text-white font-medium px-5 py-2.5 rounded-full text-sm">Create</button>
            <button type="button" onClick={() => setShowCreate(false)} className="text-forest-muted hover:text-forest font-medium px-4 py-2.5 text-sm">Cancel</button>
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
                <h3 className="font-semibold text-forest group-hover:text-meadow-700 transition-colors">{p.name}</h3>
                <p className="text-sm text-forest-muted mt-1">{p.domain}</p>
                <p className="text-xs text-meadow-400 font-mono mt-3">{p.id}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
