import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { ArrowLeft, Copy, Check, Users, Eye, MousePointer, Activity, Sparkles, LogOut } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

export default function Dashboard({ user, onLogout }: { user: any; onLogout: () => void }) {
  const { id } = useParams<{ id: string }>();
  const [overview, setOverview] = useState<any>(null);
  const [pageviews, setPageviews] = useState<any[]>([]);
  const [pages, setPages] = useState<any[]>([]);
  const [referrers, setReferrers] = useState<any[]>([]);
  const [devices, setDevices] = useState<any>(null);
  const [snippet, setSnippet] = useState('');
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState('overview');

  useEffect(() => { if (id) load(); }, [id]);

  async function load() {
    const [ov, pv, pg, ref, dev, proj] = await Promise.all([
      api.getOverview(id!), api.getPageviews(id!), api.getPages(id!),
      api.getReferrers(id!), api.getDevices(id!), api.getProject(id!),
    ]);
    if (ov.ok) setOverview(await ov.json());
    if (pv.ok) setPageviews((await pv.json()).data);
    if (pg.ok) setPages((await pg.json()).data);
    if (ref.ok) setReferrers((await ref.json()).data);
    if (dev.ok) setDevices(await dev.json());
    if (proj.ok) setSnippet((await proj.json()).snippet);
  }

  function copySnippet() { navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 2000); }

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'pages', label: 'Pages' },
    { key: 'referrers', label: 'Referrers' },
    { key: 'devices', label: 'Devices' },
    { key: 'snippet', label: 'Snippet' },
  ];

  return (
    <div className="min-h-screen bg-meadow-50">
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-meadow-200 px-4 sm:px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/projects" className="text-forest-muted hover:text-forest p-2 rounded-lg hover:bg-meadow-100 transition-colors"><ArrowLeft className="w-4 h-4" /></Link>
            <Sparkles className="w-5 h-5 text-meadow-600" />
            <span className="font-semibold text-forest">Pulse Analytics</span>
          </div>
          <button onClick={onLogout} className="text-forest-muted hover:text-forest p-2 rounded-lg hover:bg-meadow-100"><LogOut className="w-4 h-4" /></button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-2 mb-8 flex-wrap">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${tab === t.key ? 'bg-forest text-white' : 'bg-white text-forest-muted border border-meadow-200 hover:border-meadow-400'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Overview */}
        {tab === 'overview' && overview && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={Activity} label="Live Now" value={overview.liveVisitors} accent />
              <StatCard icon={Eye} label="Pageviews" value={overview.pageviews} />
              <StatCard icon={Users} label="Visitors" value={overview.visitors} />
              <StatCard icon={MousePointer} label="Sessions" value={overview.sessions} />
            </div>
            {pageviews.length > 0 && (
              <div className="bg-white rounded-2xl p-6 border border-meadow-200">
                <h3 className="font-semibold text-forest mb-4">Pageviews (Last 7 days)</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={pageviews}>
                    <defs><linearGradient id="grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3d8b42" stopOpacity={0.3} /><stop offset="100%" stopColor="#3d8b42" stopOpacity={0} /></linearGradient></defs>
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#4b5b47' }} tickFormatter={d => d?.slice(5)} />
                    <YAxis tick={{ fontSize: 11, fill: '#4b5b47' }} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #dceede', fontSize: 13 }} />
                    <Area type="monotone" dataKey="pageviews" stroke="#3d8b42" strokeWidth={2} fill="url(#grad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Pages */}
        {tab === 'pages' && (
          <div className="bg-white rounded-2xl border border-meadow-200 overflow-hidden">
            <table className="w-full">
              <thead><tr className="bg-meadow-50 text-xs font-semibold text-forest-muted uppercase tracking-wide"><th className="text-left px-5 py-3">Page</th><th className="text-right px-5 py-3">Views</th><th className="text-right px-5 py-3">Visitors</th></tr></thead>
              <tbody>{pages.map((p, i) => (
                <tr key={i} className="border-t border-meadow-100 hover:bg-meadow-50/50"><td className="px-5 py-3 text-sm text-forest">{p.path}</td><td className="px-5 py-3 text-sm text-right font-semibold text-forest">{p.views}</td><td className="px-5 py-3 text-sm text-right text-forest-muted">{p.visitors}</td></tr>
              ))}{pages.length === 0 && <tr><td colSpan={3} className="px-5 py-8 text-center text-sm text-forest-muted">No data yet</td></tr>}</tbody>
            </table>
          </div>
        )}

        {/* Referrers */}
        {tab === 'referrers' && (
          <div className="bg-white rounded-2xl border border-meadow-200 overflow-hidden">
            <table className="w-full">
              <thead><tr className="bg-meadow-50 text-xs font-semibold text-forest-muted uppercase tracking-wide"><th className="text-left px-5 py-3">Source</th><th className="text-right px-5 py-3">Visits</th></tr></thead>
              <tbody>{referrers.map((r, i) => (
                <tr key={i} className="border-t border-meadow-100 hover:bg-meadow-50/50"><td className="px-5 py-3 text-sm text-forest">{r.referrer || 'Direct'}</td><td className="px-5 py-3 text-sm text-right font-semibold text-forest">{r.count}</td></tr>
              ))}{referrers.length === 0 && <tr><td colSpan={2} className="px-5 py-8 text-center text-sm text-forest-muted">No data yet</td></tr>}</tbody>
            </table>
          </div>
        )}

        {/* Devices */}
        {tab === 'devices' && devices && (
          <div className="grid sm:grid-cols-3 gap-4">
            <DeviceCard title="Devices" data={devices.devices} keyName="device" />
            <DeviceCard title="Browsers" data={devices.browsers} keyName="browser" />
            <DeviceCard title="Countries" data={devices.countries} keyName="country" />
          </div>
        )}

        {/* Snippet */}
        {tab === 'snippet' && (
          <div>
            <div className="bg-forest rounded-2xl p-6 mb-6">
              <h3 className="text-xl font-bold text-white mb-2">Your Tracking Snippet</h3>
              <p className="text-white/70 text-sm">Add this to your website's &lt;head&gt; or before &lt;/body&gt;</p>
            </div>
            <div className="bg-forest/95 rounded-2xl p-5 font-mono text-sm text-meadow-300 overflow-x-auto">{snippet}</div>
            <button onClick={copySnippet} className="mt-4 bg-meadow-600 hover:bg-meadow-700 text-white font-medium px-5 py-2.5 rounded-full transition-colors flex items-center gap-2 text-sm">
              {copied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Snippet</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }: { icon: any; label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-5 border ${accent ? 'bg-forest text-white border-forest' : 'bg-white border-meadow-200'}`}>
      <Icon className={`w-5 h-5 mb-3 ${accent ? 'text-meadow-300' : 'text-meadow-500'}`} />
      <div className={`text-3xl font-bold ${accent ? 'text-white' : 'text-forest'}`}>{value}</div>
      <div className={`text-xs mt-1 ${accent ? 'text-white/60' : 'text-forest-muted'}`}>{label}</div>
    </div>
  );
}

function DeviceCard({ title, data, keyName }: { title: string; data: any[]; keyName: string }) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-meadow-200">
      <h3 className="font-semibold text-forest mb-4">{title}</h3>
      {data?.length ? (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} layout="vertical">
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey={keyName} tick={{ fontSize: 11 }} width={70} />
            <Bar dataKey="count" fill="#3d8b42" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : <p className="text-sm text-forest-muted">No data yet</p>}
    </div>
  );
}
