import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ArrowLeft, Users, FolderOpen, Activity, Sparkles, MessageSquare } from 'lucide-react';

export default function Admin({ onLogout }: { onLogout: () => void }) {
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [tab, setTab] = useState<'users' | 'suggestions'>('users');

  useEffect(() => { load(); }, []);
  async function load() {
    const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` };
    const [s, u, sg] = await Promise.all([
      fetch('/api/admin/stats', { headers }),
      fetch('/api/admin/users', { headers }),
      fetch('/api/suggestions', { headers }),
    ]);
    if (s.ok) setStats(await s.json());
    if (u.ok) setUsers((await u.json()).users);
    if (sg.ok) setSuggestions((await sg.json()).suggestions);
  }

  return (
    <div className="min-h-screen bg-meadow-50">
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-meadow-200 px-4 sm:px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/projects" className="text-forest-muted hover:text-forest p-2 rounded-lg hover:bg-meadow-100"><ArrowLeft className="w-4 h-4" /></Link>
            <Sparkles className="w-5 h-5 text-meadow-600" />
            <span className="font-semibold text-forest">Admin Panel</span>
          </div>
          <button onClick={onLogout} className="text-sm text-forest-muted hover:text-forest">Logout</button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {stats && (
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-2xl p-5 border border-meadow-200 text-center">
              <Users className="w-6 h-6 text-meadow-500 mx-auto mb-2" />
              <div className="text-3xl font-bold text-forest">{stats.users}</div>
              <div className="text-xs text-forest-muted mt-1">Total Users</div>
            </div>
            <div className="bg-white rounded-2xl p-5 border border-meadow-200 text-center">
              <FolderOpen className="w-6 h-6 text-meadow-500 mx-auto mb-2" />
              <div className="text-3xl font-bold text-forest">{stats.projects}</div>
              <div className="text-xs text-forest-muted mt-1">Total Projects</div>
            </div>
            <div className="bg-white rounded-2xl p-5 border border-meadow-200 text-center">
              <Activity className="w-6 h-6 text-meadow-500 mx-auto mb-2" />
              <div className="text-3xl font-bold text-forest">{stats.events}</div>
              <div className="text-xs text-forest-muted mt-1">Total Events</div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-meadow-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-meadow-100 flex gap-3">
            <button onClick={() => setTab('users')} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${tab === 'users' ? 'bg-forest text-white' : 'text-forest-muted hover:text-forest'}`}>Users</button>
            <button onClick={() => setTab('suggestions')} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1 ${tab === 'suggestions' ? 'bg-forest text-white' : 'text-forest-muted hover:text-forest'}`}><MessageSquare className="w-3 h-3" />Suggestions ({suggestions.length})</button>
          </div>

          {tab === 'users' && (
          <table className="w-full">
            <thead><tr className="bg-meadow-50 text-xs font-semibold text-forest-muted uppercase tracking-wide"><th className="text-left px-5 py-3">Email</th><th className="text-left px-5 py-3">Name</th><th className="text-center px-5 py-3">Projects</th><th className="text-center px-5 py-3">Role</th><th className="text-right px-5 py-3">Joined</th></tr></thead>
            <tbody>{users.map(u => (
              <tr key={u.id} className="border-t border-meadow-100 hover:bg-meadow-50/50">
                <td className="px-5 py-3 text-sm text-forest">{u.email}</td>
                <td className="px-5 py-3 text-sm text-forest-muted">{u.name || '—'}</td>
                <td className="px-5 py-3 text-sm text-center font-semibold text-forest">{u.projectCount}</td>
                <td className="px-5 py-3 text-center"><span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${u.role === 'admin' ? 'bg-meadow-100 text-meadow-700' : 'bg-gray-100 text-gray-600'}`}>{u.role}</span></td>
                <td className="px-5 py-3 text-sm text-right text-forest-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}</tbody>
          </table>
          )}

          {tab === 'suggestions' && (
          <div className="divide-y divide-meadow-100">
            {suggestions.length === 0 ? <p className="px-5 py-8 text-center text-sm text-forest-muted">No suggestions yet</p> : suggestions.map((s: any) => (
              <div key={s.id} className="px-5 py-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-forest">{s.email || s.name || 'Anonymous'}</span>
                  <span className="text-xs text-forest-muted">{new Date(s.created_at).toLocaleDateString()}</span>
                </div>
                <p className="text-sm text-forest-muted">{s.message}</p>
              </div>
            ))}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
