import { useEffect, useState } from 'react';
import { Globe, Plus, Download, Rocket, ExternalLink, ListOrdered } from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../lib/useReport';
import { Panel, EmptyState, ErrorNote, Spinner, Pill } from '../ui';

/**
 * Client websites built by ZeroBuild. "Build website" on a lead opens this tab
 * with ?lead=<id>, prefilling the form from that lead.
 */
export default function Sites({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const list = useAsync(() => api.getSites(projectId), [projectId]);
  const [creating, setCreating] = useState<Record<string, string> | null>(null);
  const [publishing, setPublishing] = useState<any>(null);
  const [catalogFor, setCatalogFor] = useState<any>(null);

  // Arriving from a lead: prefill and open the create form once.
  useEffect(() => {
    const leadId = new URLSearchParams(window.location.search).get('lead');
    if (!leadId || !canEdit) return;
    api.getLead(projectId, leadId).then(({ lead }: any) => setCreating({
      leadId, businessName: lead.business_name || lead.name || '', businessType: lead.business_type || '',
      city: lead.city || '', phone: lead.phone ? `+${lead.phone}` : '', address: lead.address || '', email: lead.email || '',
    })).catch(() => setCreating({ leadId }));
  }, [projectId, canEdit]);

  if (list.error) return <ErrorNote message={list.error} onRetry={list.reload} />;
  if (list.loading && !list.data) return <Spinner />;
  if (list.data && !list.data.configured) {
    return (
      <Panel title="Client websites">
        <div className="px-5 py-4 text-sm text-forest space-y-1.5">
          <p>Connect ZeroBuild to build websites from leads. On the hub (Railway) set:</p>
          <p><code>ZEROBUILD_URL</code> — your ZeroBuild server, <code>ZEROBUILD_TOKEN</code> — the same value as ZeroBuild's <code>AGENCY_API_TOKEN</code>.</p>
          <p className="text-forest-muted text-xs">On ZeroBuild also set AGENCY_USER_EMAIL (the account that owns client sites) and optionally PEXELS_API_KEY for photos that match each shop.</p>
        </div>
      </Panel>
    );
  }
  const sites = list.data?.sites ?? [];

  return (
    <div className="space-y-6">
      <Panel
        title="Client websites"
        action={canEdit && (
          <button onClick={() => setCreating({})} className="inline-flex items-center gap-1 text-xs font-semibold text-meadow-700 hover:text-forest">
            <Plus className="w-3.5 h-3.5" /> New site
          </button>
        )}
      >
        {list.data?.error && <p className="px-5 pt-3 text-xs text-red-600">{list.data.error}</p>}
        {!sites.length ? (
          <EmptyState icon={Globe} title="No websites yet" hint='Use "Build website" on a lead, or "New site" here. A 4-page site with WhatsApp, FAQ and Google-ready pages is created in seconds.' />
        ) : (
          <ul className="divide-y divide-meadow-100">
            {sites.map((s: any) => (
              <li key={s.id} className="px-5 py-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-forest">{s.name}</span>
                    <Pill tone={s.status === 'published' ? 'good' : 'neutral'}>{s.status}</Pill>
                  </div>
                  <p className="text-xs text-forest-muted">{s.pages} pages{s.liveUrl ? ` · ${s.liveUrl}` : ''}</p>
                </div>
                <a href={s.editorUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-meadow-700"><ExternalLink className="w-3.5 h-3.5" /> Edit</a>
                <button onClick={() => void api.downloadSite(projectId, s.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-meadow-700"><Download className="w-3.5 h-3.5" /> Zip</button>
                {canEdit && <button onClick={() => setCatalogFor(s)} className="inline-flex items-center gap-1 text-xs font-semibold text-meadow-700"><ListOrdered className="w-3.5 h-3.5" /> Price list</button>}
                {canEdit && <button onClick={() => setPublishing(s)} className="inline-flex items-center gap-1 text-xs font-semibold text-meadow-700"><Rocket className="w-3.5 h-3.5" /> Publish</button>}
                {s.liveUrl && <a href={s.liveUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline text-forest-muted">Visit</a>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {creating && <CreateSite projectId={projectId} initial={creating} onClose={() => setCreating(null)} onDone={() => { setCreating(null); list.reload(); }} />}
      {publishing && <PublishSite projectId={projectId} site={publishing} onClose={() => setPublishing(null)} onDone={() => { setPublishing(null); list.reload(); }} />}
      {catalogFor && <CatalogSync projectId={projectId} site={catalogFor} onClose={() => setCatalogFor(null)} />}
    </div>
  );
}

const input = 'w-full border border-meadow-200 rounded-lg px-2.5 py-1.5 text-sm text-forest';
const label = 'block text-xs font-semibold text-forest-muted mb-1';

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-lg h-full bg-white overflow-y-auto shadow-xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-forest">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function CreateSite({ projectId, initial, onClose, onDone }: { projectId: string; initial: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Record<string, string>>({ businessName: '', businessType: '', city: '', phone: '', whatsapp: '', address: '', email: '', description: '', services: '', ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = (k: string, l: string, ph = '') => (
    <div><label className={label}>{l}</label><input className={input} value={f[k] ?? ''} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  );
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const services = (f.services || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const body: Record<string, unknown> = Object.fromEntries(Object.entries(f).filter(([k, v]) => v && k !== 'services'));
      if (services.length) body.services = services;
      const site = await api.createSite(projectId, body);
      if (site.editorUrl) window.open(site.editorUrl, '_blank', 'noopener');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the site');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer title={initial.leadId ? 'Build website for this lead' : 'New website'} onClose={onClose}>
      {field('businessName', 'Business name *', 'Gupta Medical Store')}
      {field('businessType', 'Type of business', 'Pharmacy')}
      <div className="grid grid-cols-2 gap-3">{field('city', 'City', 'Lucknow')}{field('phone', 'Phone *', '+91 98765 43210')}</div>
      <div className="grid grid-cols-2 gap-3">{field('whatsapp', 'WhatsApp (if different)')}{field('email', 'Email')}</div>
      {field('address', 'Address', 'Shop no., area, city, PIN')}
      <div><label className={label}>About the business</label><textarea className={`${input} h-20`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div><label className={label}>Products / services — one per line</label><textarea className={`${input} h-20`} value={f.services} onChange={(e) => setF({ ...f, services: e.target.value })} /></div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs">Cancel</button>
        <button disabled={busy || !f.businessName || !(f.phone || f.whatsapp)} onClick={() => void save()} className="px-3 py-1.5 rounded-lg bg-forest text-white text-xs font-semibold disabled:opacity-50">{busy ? 'Building…' : 'Build site & open editor'}</button>
      </div>
    </Drawer>
  );
}

function PublishSite({ projectId, site, onClose, onDone }: { projectId: string; site: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ siteUrl: site.liveUrl || '', host: '', user: '', password: '', dir: '/public_html' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const publish = async () => {
    setBusy(true); setResult(null);
    try {
      const r = await api.deploySite(projectId, site.id, { siteUrl: f.siteUrl || undefined, cpanel: { host: f.host, user: f.user, password: f.password, dir: f.dir } });
      setResult(`Published: ${r.url}`);
      onDone();
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setBusy(false);
    }
  };
  const field = (k: keyof typeof f, l: string, type = 'text') => (
    <div><label className={label}>{l}</label><input type={type} className={input} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  );
  return (
    <Drawer title={`Publish ${site.name}`} onClose={onClose}>
      {field('siteUrl', 'Website address (https://shop.in) — for Google sitemap & canonical')}
      {field('host', 'FTP host')}
      <div className="grid grid-cols-2 gap-3">{field('user', 'FTP user')}{field('password', 'FTP password', 'password')}</div>
      {field('dir', 'Folder')}
      <p className="text-[11px] text-forest-muted">FTP details go straight to ZeroBuild over an encrypted connection and are not saved here. No FTP? Use "Zip" and upload it in your host's file manager.</p>
      {result && <p className="text-xs text-forest">{result}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={() => void api.downloadSite(projectId, site.id, f.siteUrl)} className="px-3 py-1.5 text-xs">Download zip instead</button>
        <button disabled={busy || !f.host || !f.user || !f.password} onClick={() => void publish()} className="px-3 py-1.5 rounded-lg bg-forest text-white text-xs font-semibold disabled:opacity-50">{busy ? 'Publishing…' : 'Publish'}</button>
      </div>
    </Drawer>
  );
}

/** "Name, price, note" per line or a CSV export from the billing software. */
export function parseCatalog(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .filter((line, i) => !(i === 0 && /^(name|item|product)\b/i.test(line)))
    .map((line) => {
      const [name, price, ...rest] = line.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, '').trim());
      const n = Number(String(price ?? '').replace(/[₹,\s]/g, ''));
      return { name, ...(price && Number.isFinite(n) ? { price: n } : {}), ...(rest.join(' ') ? { description: rest.join(' ') } : {}) };
    })
    .filter((p) => p.name);
}

function CatalogSync({ projectId, site, onClose }: { projectId: string; site: any; onClose: () => void }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const items = parseCatalog(text);
  const sync = async () => {
    try {
      await api.syncCatalog(projectId, site.id, items);
      setResult(`Price list updated with ${items.length} items. Publish again to put it live.`);
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Sync failed');
    }
  };
  const loadFile = async (file: File) => setText(await file.text());
  return (
    <Drawer title={`Price list — ${site.name}`} onClose={onClose}>
      <p className="text-xs text-forest-muted">Paste items from the billing software (one per line: <code>Name, Price, Note</code>) or choose its CSV export. Replaces the "Price list" on the Products page.</p>
      <input type="file" accept=".csv,.txt" onChange={(e) => e.target.files?.[0] && void loadFile(e.target.files[0])} className="text-xs" />
      <textarea className={`${input} h-48 font-mono`} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Paracetamol 500mg, 30\nBP monitor, 1450, Omron\nThermometer, 199'} />
      <p className="text-xs text-forest">{items.length} items ready{items.length ? ` — e.g. ${items[0].name}${'price' in items[0] ? ` ₹${items[0].price}` : ''}` : ''}</p>
      {result && <p className="text-xs text-forest">{result}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs">Close</button>
        <button disabled={!items.length} onClick={() => void sync()} className="px-3 py-1.5 rounded-lg bg-forest text-white text-xs font-semibold disabled:opacity-50">Update price list</button>
      </div>
    </Drawer>
  );
}
