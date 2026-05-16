import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function Projects({ onSelect, onLogout }: { onSelect: (id: string) => void; onLogout: () => void }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');

  useEffect(() => { loadProjects(); }, []);

  async function loadProjects() {
    const res = await api.getProjects();
    if (res.ok) { const d = await res.json(); setProjects(d.projects); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const res = await api.createProject({ name, domain });
    if (res.ok) { setShowCreate(false); setName(''); setDomain(''); loadProjects(); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this project and all its data?')) return;
    await api.deleteProject(id);
    loadProjects();
  }

  return (
    <div className="page">
      <nav className="nav">
        <div className="nav-brand">🔮 <span>Pulse</span> Analytics</div>
        <button className="btn btn-sm" onClick={onLogout}>Logout</button>
      </nav>
      <div className="container" style={{ paddingTop: 48, paddingBottom: 48 }}>
        <div className="section-header">
          <div>
            <h2>Your Projects</h2>
            <p>Select a project to view analytics</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Add Project</button>
        </div>

        {showCreate && (
          <div className="card" style={{ marginBottom: 24 }}>
            <form onSubmit={handleCreate} style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6d6868', marginBottom: 6 }}>Project Name</label>
                <input placeholder="My SaaS App" value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div className="form-group" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6d6868', marginBottom: 6 }}>Domain</label>
                <input placeholder="myapp.com" value={domain} onChange={e => setDomain(e.target.value)} required />
              </div>
              <button className="btn btn-primary" type="submit">Create</button>
              <button className="btn" type="button" onClick={() => setShowCreate(false)}>Cancel</button>
            </form>
          </div>
        )}

        {projects.length === 0 ? (
          <div className="empty">
            <h3>No projects yet</h3>
            <p>Add your first project to start tracking analytics</p>
          </div>
        ) : (
          <div className="grid">
            {projects.map(p => (
              <div key={p.id} className="project-card" onClick={() => onSelect(p.id)}>
                <h3>{p.name}</h3>
                <div className="domain">{p.domain}</div>
                <div className="id">{p.id}</div>
                <button className="btn btn-sm btn-danger" style={{ marginTop: 14 }}
                  onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
