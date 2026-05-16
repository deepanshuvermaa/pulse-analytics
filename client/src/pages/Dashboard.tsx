import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ArrowLeft, Copy, Check, Users, Eye, MousePointer, Activity, Sparkles, LogOut, RefreshCw, AlertTriangle, Zap, MousePointerClick, UserCheck } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

export default function Dashboard({ user, onLogout }: { user: any; onLogout: () => void }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<any>(null);
  const [pageviews, setPageviews] = useState<any[]>([]);
  const [pages, setPages] = useState<any[]>([]);
  const [referrers, setReferrers] = useState<any[]>([]);
  const [devices, setDevices] = useState<any>(null);
  const [engagement, setEngagement] = useState<any>(null);
  const [errors, setErrors] = useState<any>(null);
  const [snippet, setSnippet] = useState('');
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState('overview');

  useEffect(() => { if (id) load(); }, [id]);

  async function load() {
    const [ov, pv, pg, ref, dev, eng, err, proj] = await Promise.all([
      api.getOverview(id!), api.getPageviews(id!), api.getPages(id!),
      api.getReferrers(id!), api.getDevices(id!), api.getEngagement(id!),
      api.getErrors(id!), api.getProject(id!),
    ]);
    if (ov.ok) setOverview(await ov.json());
    if (pv.ok) setPageviews((await pv.json()).data);
    if (pg.ok) setPages((await pg.json()).data);
    if (ref.ok) setReferrers((await ref.json()).data);
    if (dev.ok) setDevices(await dev.json());
    if (eng.ok) setEngagement(await eng.json());
    if (err.ok) setErrors(await err.json());
    if (proj.ok) setSnippet((await proj.json()).snippet);
  }

  function copySnippet() { navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 2000); }

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'engagement', label: 'Engagement' },
    { key: 'pages', label: 'Pages' },
    { key: 'referrers', label: 'Referrers' },
    { key: 'devices', label: 'Devices' },
    { key: 'errors', label: 'Errors' },
    { key: 'clarity', label: 'Clarity' },
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

        {/* Engagement */}
        {tab === 'engagement' && engagement && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={Users} label="DAU (Today)" value={engagement.dau} />
              <StatCard icon={Users} label="WAU (7 days)" value={engagement.wau} />
              <StatCard icon={Users} label="MAU (30 days)" value={engagement.mau} />
              <StatCard icon={UserCheck} label="Returning Visitors" value={engagement.returningVisitors} accent />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-white rounded-2xl p-5 border border-meadow-200">
                <div className="text-sm text-forest-muted mb-1">DAU/WAU Ratio</div>
                <div className="text-2xl font-bold text-forest">{engagement.dauWauRatio}%</div>
                <div className="text-xs text-forest-muted mt-1">Higher = stickier product (20%+ is good)</div>
              </div>
              <div className="bg-red-50 rounded-2xl p-5 border border-red-200">
                <MousePointerClick className="w-5 h-5 text-red-500 mb-2" />
                <div className="text-sm text-red-700 mb-1">Rage Clicks (7d)</div>
                <div className="text-2xl font-bold text-red-700">{engagement.rageClicks}</div>
                <div className="text-xs text-red-500 mt-1">Users frustrated — clicking repeatedly</div>
              </div>
              <div className="bg-amber-50 rounded-2xl p-5 border border-amber-200">
                <MousePointer className="w-5 h-5 text-amber-600 mb-2" />
                <div className="text-sm text-amber-700 mb-1">Dead Clicks (7d)</div>
                <div className="text-2xl font-bold text-amber-700">{engagement.deadClicks}</div>
                <div className="text-xs text-amber-500 mt-1">Clicks on non-interactive elements</div>
              </div>
            </div>
          </div>
        )}

        {/* Errors */}
        {tab === 'errors' && errors && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-forest">JS Errors (Last 7 days)</h3>
              <span className="bg-red-100 text-red-700 text-xs font-bold px-3 py-1 rounded-full">{errors.total} total</span>
            </div>
            <div className="bg-white rounded-2xl border border-meadow-200 overflow-hidden">
              {errors.errors.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-forest-muted">No errors captured 🎉</p>
              ) : (
                <div className="divide-y divide-meadow-100">
                  {errors.errors.map((e: any) => (
                    <div key={e.id} className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-forest truncate">{e.payload?.message || 'Unknown error'}</p>
                          <div className="flex gap-3 mt-1 text-xs text-forest-muted">
                            <span>{e.path}</span>
                            {e.payload?.source && <span>{e.payload.source}:{e.payload.line}</span>}
                            <span>{new Date(e.timestamp).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Clarity Integration */}
        {tab === 'clarity' && (
          <div>
            <div className="bg-forest rounded-2xl p-6 mb-6">
              <h3 className="text-xl font-bold text-white mb-2">🔥 Microsoft Clarity — Free Heatmaps & Session Recordings</h3>
              <p className="text-white/70 text-sm">Clarity gives you heatmaps, session recordings, and scroll maps — completely free. Here's how to set it up:</p>
            </div>
            <div className="bg-white rounded-2xl p-6 border border-meadow-200 space-y-6">
              <div>
                <h4 className="font-semibold text-forest mb-2 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-meadow-100 text-meadow-700 text-xs font-bold flex items-center justify-center">1</span> Create a Clarity account</h4>
                <p className="text-sm text-forest-muted ml-8">Go to <a href="https://clarity.microsoft.com" target="_blank" rel="noopener" className="text-meadow-600 font-medium underline">clarity.microsoft.com</a> → Sign up with Microsoft/Google/Facebook.</p>
              </div>
              <div>
                <h4 className="font-semibold text-forest mb-2 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-meadow-100 text-meadow-700 text-xs font-bold flex items-center justify-center">2</span> Create a new project</h4>
                <p className="text-sm text-forest-muted ml-8">Click "Add new project" → Enter your site name and URL → Click "Create".</p>
              </div>
              <div>
                <h4 className="font-semibold text-forest mb-2 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-meadow-100 text-meadow-700 text-xs font-bold flex items-center justify-center">3</span> Copy the tracking code</h4>
                <p className="text-sm text-forest-muted ml-8">Clarity gives you a script like this — paste it in your site's {'<head>'}:</p>
                <div className="ml-8 mt-2 bg-forest/95 rounded-xl p-4 font-mono text-xs text-meadow-300 overflow-x-auto">
                  {`<script type="text/javascript">\n  (function(c,l,a,r,i,t,y){\n    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};\n    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;\n    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);\n  })(window,document,"clarity","script","YOUR_CLARITY_ID");\n</script>`}
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-forest mb-2 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-meadow-100 text-meadow-700 text-xs font-bold flex items-center justify-center">4</span> You get (for free)</h4>
                <div className="ml-8 grid sm:grid-cols-2 gap-3">
                  <div className="bg-meadow-50 rounded-xl p-3 border border-meadow-200"><span className="text-sm font-medium text-forest">🖱️ Heatmaps</span><p className="text-xs text-forest-muted mt-1">See where users click, scroll, and move</p></div>
                  <div className="bg-meadow-50 rounded-xl p-3 border border-meadow-200"><span className="text-sm font-medium text-forest">🎬 Session Recordings</span><p className="text-xs text-forest-muted mt-1">Watch real user sessions frame by frame</p></div>
                  <div className="bg-meadow-50 rounded-xl p-3 border border-meadow-200"><span className="text-sm font-medium text-forest">📊 Scroll Maps</span><p className="text-xs text-forest-muted mt-1">See how far users scroll on each page</p></div>
                  <div className="bg-meadow-50 rounded-xl p-3 border border-meadow-200"><span className="text-sm font-medium text-forest">⚡ Rage Click Detection</span><p className="text-xs text-forest-muted mt-1">Identify frustrated users automatically</p></div>
                </div>
              </div>
              <div className="bg-meadow-50 rounded-xl p-4 border border-meadow-200">
                <p className="text-sm text-forest"><strong>💡 Pro tip:</strong> Use Pulse for quantitative data (numbers, trends, funnels) and Clarity for qualitative data (watching WHY users behave a certain way). Together they give you the full picture.</p>
              </div>
            </div>
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
              <p className="text-white/70 text-sm">Add this to your website to start tracking automatically.</p>
            </div>
            <div className="bg-white rounded-2xl p-6 border border-meadow-200 mb-4">
              <h4 className="font-semibold text-forest mb-3">Where to put it:</h4>
              <div className="bg-forest/95 rounded-xl p-4 font-mono text-xs text-meadow-300 overflow-x-auto leading-relaxed">
                <span className="text-white/40">{'<!DOCTYPE html>'}</span>{'\n'}
                <span className="text-white/40">{'<html>'}</span>{'\n'}
                <span className="text-white/40">{'<head>'}</span>{'\n'}
                {'  '}<span className="text-white/40">{'<title>Your Site</title>'}</span>{'\n'}
                {'  '}<span className="text-meadow-300 font-bold bg-meadow-900/50 px-1 rounded">{'<!-- ✅ PASTE HERE (inside <head>) -->'}</span>{'\n'}
                {'  '}<span className="text-white">{snippet}</span>{'\n'}
                <span className="text-white/40">{'</head>'}</span>{'\n'}
                <span className="text-white/40">{'<body>...</body>'}</span>{'\n'}
                <span className="text-white/40">{'</html>'}</span>
              </div>
              <p className="text-xs text-forest-muted mt-3">Works in: React, Next.js, Vue, Svelte, HTML, WordPress — any site that renders HTML.</p>
            </div>
            <div className="bg-forest/95 rounded-2xl p-5 font-mono text-sm text-meadow-300 overflow-x-auto">{snippet}</div>
            <button onClick={copySnippet} className="mt-4 bg-meadow-600 hover:bg-meadow-700 text-white font-medium px-5 py-2.5 rounded-full transition-colors flex items-center gap-2 text-sm">
              {copied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Snippet</>}
            </button>
            <button onClick={async () => { if(!confirm('This will invalidate the old snippet. Continue?')) return; const r = await api.regenerateProject(id!); if(r.ok){ const d = await r.json(); navigate(`/dashboard/${d.project.id}`); }}} className="mt-4 ml-3 border border-meadow-300 text-forest-muted hover:text-forest font-medium px-5 py-2.5 rounded-full transition-colors inline-flex items-center gap-2 text-sm">
              <RefreshCw className="w-4 h-4" /> Regenerate ID
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
