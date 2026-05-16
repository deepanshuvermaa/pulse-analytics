import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function Dashboard({ projectId, onBack, onLogout }: { projectId: string; onBack: () => void; onLogout: () => void }) {
  const [overview, setOverview] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [referrers, setReferrers] = useState<any[]>([]);
  const [devices, setDevices] = useState<any>(null);
  const [snippet, setSnippet] = useState('');
  const [tab, setTab] = useState<'overview' | 'pages' | 'referrers' | 'devices' | 'snippet'>('overview');

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    const [ovRes, pgRes, refRes, devRes, projRes] = await Promise.all([
      api.getOverview(projectId), api.getPages(projectId), api.getReferrers(projectId),
      api.getDevices(projectId), api.getProject(projectId),
    ]);
    if (ovRes.ok) setOverview(await ovRes.json());
    if (pgRes.ok) setPages((await pgRes.json()).data);
    if (refRes.ok) setReferrers((await refRes.json()).data);
    if (devRes.ok) setDevices(await devRes.json());
    if (projRes.ok) setSnippet((await projRes.json()).snippet);
  }

  const tabs = ['overview', 'pages', 'referrers', 'devices', 'snippet'] as const;

  return (
    <div className="page">
      <nav className="nav">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="btn btn-sm" onClick={onBack}>← Back</button>
          <div className="nav-brand">🔮 <span>Pulse</span> Analytics</div>
        </div>
        <button className="btn btn-sm" onClick={onLogout}>Logout</button>
      </nav>

      <div className="container" style={{ paddingTop: 48, paddingBottom: 48 }}>
        <div className="tabs">
          {tabs.map(t => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'overview' && overview && (
          <div className="grid-stats">
            <div className="stat-card live">
              <div className="stat-num">{overview.liveVisitors}</div>
              <div className="stat-label">Live Now</div>
            </div>
            <div className="stat-card">
              <div className="stat-num">{overview.pageviews}</div>
              <div className="stat-label">Pageviews</div>
            </div>
            <div className="stat-card">
              <div className="stat-num">{overview.visitors}</div>
              <div className="stat-label">Unique Visitors</div>
            </div>
            <div className="stat-card">
              <div className="stat-num">{overview.sessions}</div>
              <div className="stat-label">Sessions</div>
            </div>
          </div>
        )}

        {tab === 'pages' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Page</th><th>Views</th><th>Visitors</th></tr></thead>
              <tbody>
                {pages.map((p, i) => (
                  <tr key={i}><td>{p.path}</td><td><strong>{p.views}</strong></td><td>{p.visitors}</td></tr>
                ))}
                {pages.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: '#6d6868' }}>No data yet</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'referrers' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Source</th><th>Visits</th></tr></thead>
              <tbody>
                {referrers.map((r, i) => (
                  <tr key={i}><td>{r.referrer || <span className="tag">Direct</span>}</td><td><strong>{r.count}</strong></td></tr>
                ))}
                {referrers.length === 0 && <tr><td colSpan={2} style={{ textAlign: 'center', color: '#6d6868' }}>No data yet</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'devices' && devices && (
          <div className="grid">
            <div className="card-sm">
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Devices</h3>
              {devices.devices?.map((d: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #d4d4d0' }}>
                  <span>{d.device || 'desktop'}</span><strong>{d.count}</strong>
                </div>
              ))}
            </div>
            <div className="card-sm">
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Browsers</h3>
              {devices.browsers?.map((b: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #d4d4d0' }}>
                  <span>{b.browser}</span><strong>{b.count}</strong>
                </div>
              ))}
            </div>
            <div className="card-sm">
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Countries</h3>
              {devices.countries?.map((c: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #d4d4d0' }}>
                  <span>{c.country || '—'}</span><strong>{c.count}</strong>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'snippet' && (
          <div>
            <div className="card-blue" style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 25, fontWeight: 700, marginBottom: 8 }}>Tracking Snippet</h3>
              <p style={{ opacity: 0.8 }}>Add this to your website's &lt;head&gt; or before &lt;/body&gt; — that's it.</p>
            </div>
            <div className="snippet">{snippet}</div>
            <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={() => { navigator.clipboard.writeText(snippet); }}>
              Copy to Clipboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
