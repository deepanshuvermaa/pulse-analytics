import { useState } from 'react';
import { Crosshair, Plus, Trash2, MapPin, Pencil } from 'lucide-react';
import { api } from '../../api';
import { useAsync } from '../../lib/useReport';
import { Panel, EmptyState, ErrorNote, Spinner, Pill } from '../ui';

/**
 * Hunt plans: what to look for and where. Harvey, the Maps scraper and the
 * intent search read enabled plans from the hub, so a new region or a new kind
 * of business is an edit here — nothing in any hunter is hard-coded.
 */

const HUNTER_LABELS: Record<string, string> = {
  harvey: 'Harvey (map discovery + website signals)',
  maps_scraper: 'Maps scraper (phones, local PC)',
  intent: 'Buyer posts (Reddit, web …)',
};

const PROVIDER_LABELS: Record<string, string> = {
  osm: 'OpenStreetMap — free, common shop types',
  serper_places: 'Google Maps via Serper — any search, 2,500 free',
  dataforseo_listings: 'DataForSEO listings — paid, bulk',
  dataforseo_serp: 'DataForSEO search ranks — paid',
  serper: 'Google search ranks via Serper',
};

const OFFER_LABELS: Record<string, string> = {
  website: 'Website', seo_aeo: 'SEO / AI search', google_profile_reviews: 'Google profile & reviews',
  billing_software: 'Billing software', billing_machine: 'Billing machine', online_booking: 'Online booking',
};

interface Draft {
  id?: string;
  name: string;
  enabled: boolean;
  hunters: string[];
  terms: string;
  regions: string;
  places: string[];
  country: string;
  provider: string;
  limitPerQuery: number;
  maxSpend: number;
  intentQueries: string;
  intentChannels: string[];
  offers: string[];
  customOffers: string;
  notes: string;
}

const lines = (text: string) => text.split(/\n/).map((s) => s.trim()).filter(Boolean);

function emptyDraft(): Draft {
  return {
    name: '', enabled: true, hunters: ['harvey'], terms: '', regions: '', places: [], country: 'in',
    provider: 'osm', limitPerQuery: 60, maxSpend: 1, intentQueries: '', intentChannels: ['reddit', 'web'],
    offers: [], customOffers: '', notes: '',
  };
}

function toDraft(plan: any, builtIn: string[]): Draft {
  return {
    id: plan.id, name: plan.name, enabled: plan.enabled, hunters: plan.hunters,
    terms: plan.terms.join('\n'), regions: plan.regions.join('\n'), places: plan.places,
    country: plan.country ?? '', provider: plan.provider, limitPerQuery: plan.limitPerQuery, maxSpend: plan.maxSpend,
    intentQueries: plan.intentQueries.join('\n'), intentChannels: plan.intentChannels,
    offers: plan.offers.filter((o: string) => builtIn.includes(o)),
    customOffers: plan.offers.filter((o: string) => !builtIn.includes(o)).join(', '),
    notes: plan.notes ?? '',
  };
}

export default function Hunts({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const list = useAsync(() => api.getHunts(projectId), [projectId]);
  const [draft, setDraft] = useState<Draft | null>(null);

  if (list.error) return <ErrorNote message={list.error} onRetry={list.reload} />;
  if (list.loading && !list.data) return <Spinner />;
  const plans = list.data?.plans ?? [];
  const options = list.data?.options ?? { hunters: [], providers: [], intentChannels: [], offers: [] };

  const remove = async (planId: string) => {
    if (!confirm('Delete this hunt plan? Leads it already found stay in the inbox.')) return;
    await api.deleteHunt(projectId, planId);
    list.reload();
  };

  return (
    <div className="space-y-6">
      <Panel
        title="Hunt plans"
        action={canEdit && (
          <button onClick={() => setDraft(emptyDraft())} className="inline-flex items-center gap-1 text-xs font-semibold text-meadow-700 hover:text-forest">
            <Plus className="w-3.5 h-3.5" /> New plan
          </button>
        )}
      >
        {!plans.length ? (
          <EmptyState icon={Crosshair} title="No hunt plans yet" hint="Create one: pick the kinds of business, the regions (a city, a state or a whole country) and which hunters should work it." />
        ) : (
          <ul className="divide-y divide-meadow-100">
            {plans.map((p: any) => (
              <li key={p.id} className="px-5 py-4 flex gap-4 items-start">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-forest">{p.name}</span>
                    <Pill tone={p.enabled ? 'good' : 'neutral'}>{p.enabled ? 'on' : 'paused'}</Pill>
                    {p.hunters.map((h: string) => <Pill key={h}>{h}</Pill>)}
                  </div>
                  {p.terms.length > 0 && <p className="text-sm text-forest"><span className="text-forest-muted">Looking for:</span> {p.terms.join(', ')}</p>}
                  {p.searchPlaces.length > 0 && (
                    <p className="text-sm text-forest"><span className="text-forest-muted">Where:</span> {p.searchPlaces.slice(0, 8).map((s: string) => s.split(',')[0]).join(', ')}{p.searchPlaces.length > 8 ? ` +${p.searchPlaces.length - 8} more` : ''}</p>
                  )}
                  {p.intentSearches.length > 0 && <p className="text-sm text-forest"><span className="text-forest-muted">Buyer-post searches:</span> {p.intentSearches.length}</p>}
                  {p.offers.length > 0 && <p className="text-xs text-forest-muted">Pitch: {p.offers.map((o: string) => OFFER_LABELS[o] ?? o).join(', ')}</p>}
                  <p className="text-xs text-forest-muted">
                    {p.searches ? `${p.searches} map searches per run · ` : ''}
                    {p.lastRunAt ? `last run ${new Date(p.lastRunAt).toLocaleString('en-IN')}` : 'not run yet'}
                    {p.lastRun && Object.entries(p.lastRun).map(([h, r]: [string, any]) => ` · ${h}: ${r.leads ?? 0} leads`).join('')}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex gap-2">
                    <button onClick={() => setDraft(toDraft(p, options.offers))} aria-label="Edit"><Pencil className="w-4 h-4 text-forest-muted" /></button>
                    <button onClick={() => void remove(p.id)} aria-label="Delete"><Trash2 className="w-4 h-4 text-red-500" /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="How hunters use these plans">
        <div className="px-5 py-4 text-sm text-forest space-y-1.5">
          <p><b>Harvey:</b> <code>harvey hunt</code> runs every enabled plan with the "harvey" hunter and pushes leads here.</p>
          <p><b>Maps scraper:</b> <code>node scripts/hunt-checklist.js</code> prints each search to run in the scraper app, then <code>sync-leads.js</code> sends the results.</p>
          <p><b>Buyer posts:</b> <code>python hunt.py --from-hub</code> runs each plan's searches through Agent Reach.</p>
          <p className="text-forest-muted text-xs">All three use this project's write key (Setup tab) as LEADHUB_KEY.</p>
        </div>
      </Panel>

      {draft && <PlanEditor projectId={projectId} draft={draft} options={options} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); list.reload(); }} />}
    </div>
  );
}

function PlanEditor({ projectId, draft: initial, options, onClose, onSaved }: {
  projectId: string; draft: Draft; options: any; onClose: () => void; onSaved: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ loading: boolean; results: any[] }>({ loading: false, results: [] });
  const [maxPerRegion, setMaxPerRegion] = useState(25);
  const [includeTowns, setIncludeTowns] = useState(false);

  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const toggle = (key: 'hunters' | 'intentChannels' | 'offers', value: string) =>
    set({ [key]: d[key].includes(value) ? d[key].filter((v) => v !== value) : [...d[key], value] } as Partial<Draft>);
  const searchesPlaces = d.hunters.includes('harvey') || d.hunters.includes('maps_scraper');

  const expand = async () => {
    const regions = lines(d.regions);
    if (!regions.length) return;
    setPreview({ loading: true, results: [] });
    try {
      const res = await api.previewPlaces(projectId, { regions, maxPerRegion, includeTowns });
      setPreview({ loading: false, results: res.results });
      set({ places: [...new Set(res.results.flatMap((r: any) => r.places))] as string[] });
    } catch (e) {
      setPreview({ loading: false, results: [] });
      setError(e instanceof Error ? e.message : 'Could not expand regions');
    }
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    const custom = d.customOffers.split(',').map((s) => s.trim()).filter(Boolean);
    const body = {
      name: d.name, enabled: d.enabled, hunters: d.hunters, terms: lines(d.terms), regions: lines(d.regions),
      places: d.places, country: d.country.trim() || null, provider: d.provider,
      limitPerQuery: Number(d.limitPerQuery), maxSpend: Number(d.maxSpend),
      intentQueries: lines(d.intentQueries), intentChannels: d.intentChannels,
      offers: [...d.offers, ...custom], notes: d.notes || null,
    };
    try {
      if (d.id) await api.updateHunt(projectId, d.id, body);
      else await api.createHunt(projectId, body);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const label = 'block text-xs font-semibold text-forest-muted mb-1';
  const input = 'w-full border border-meadow-200 rounded-lg px-2.5 py-1.5 text-sm text-forest';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-xl h-full bg-white overflow-y-auto shadow-xl p-5 space-y-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-forest">{d.id ? 'Edit hunt plan' : 'New hunt plan'}</h3>

        <div>
          <label className={label}>Name</label>
          <input className={input} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Kirana & chemists — UP and Gujarat" />
        </div>

        <div>
          <span className={label}>Hunters</span>
          {options.hunters.map((h: string) => (
            <label key={h} className="flex items-center gap-2 text-sm text-forest py-0.5">
              <input type="checkbox" checked={d.hunters.includes(h)} onChange={() => toggle('hunters', h)} /> {HUNTER_LABELS[h] ?? h}
            </label>
          ))}
        </div>

        {searchesPlaces && (
          <>
            <div>
              <label className={label}>Kinds of business — one per line, anything Google Maps would understand</label>
              <textarea className={`${input} h-24`} value={d.terms} onChange={(e) => set({ terms: e.target.value })}
                placeholder={'kirana store\nmedical store\nsaree shop\nCA firm\ndental clinic'} />
              <p className="text-[11px] text-forest-muted mt-1">OpenStreetMap knows common shop types; for anything else use Google Maps via Serper, or write OSM tags like <code>shop=fabric</code>.</p>
            </div>

            <div>
              <label className={label}>Regions — one per line: a city, an area, a state or a country</label>
              <textarea className={`${input} h-20`} value={d.regions} onChange={(e) => set({ regions: e.target.value })}
                placeholder={'Uttar Pradesh, India\nGujarat, India\nHazratganj, Lucknow\nDubai, UAE'} />
              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-forest">
                <label>Max cities per region <input type="number" min={1} max={200} value={maxPerRegion} onChange={(e) => setMaxPerRegion(Number(e.target.value))} className="w-16 border border-meadow-200 rounded px-1.5 py-0.5 ml-1" /></label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={includeTowns} onChange={(e) => setIncludeTowns(e.target.checked)} /> include towns</label>
                <button onClick={() => void expand()} disabled={preview.loading} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-meadow-200 font-semibold">
                  <MapPin className="w-3.5 h-3.5" /> {preview.loading ? 'Looking up…' : 'Expand into cities'}
                </button>
              </div>
              {preview.results.map((r: any) => (
                <p key={r.region} className="text-[11px] text-forest-muted mt-1">{r.region}: {r.kind}{r.available > r.places.length ? ` · ${r.places.length} of ${r.available}` : ` · ${r.places.length}`}{r.error ? ` · ${r.error}` : ''}</p>
              ))}
            </div>

            {d.places.length > 0 && (
              <div>
                <span className={label}>Places to search ({d.places.length}) — remove any you don't want</span>
                <div className="flex flex-wrap gap-1.5">
                  {d.places.map((p) => (
                    <button key={p} onClick={() => set({ places: d.places.filter((x) => x !== p) })}
                      className="text-xs px-2 py-0.5 rounded-full border border-meadow-200 text-forest hover:border-red-300" title="Remove">
                      {p.split(',')[0]} ×
                    </button>
                  ))}
                  <button onClick={() => set({ places: [] })} className="text-xs px-2 py-0.5 text-forest-muted underline">clear (search regions as typed)</button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Country code (biases Maps results)</label>
                <input className={input} value={d.country} onChange={(e) => set({ country: e.target.value.slice(0, 2) })} placeholder="in" />
              </div>
              <div>
                <label className={label}>Harvey source</label>
                <select className={input} value={d.provider} onChange={(e) => set({ provider: e.target.value })}>
                  {options.providers.map((p: string) => <option key={p} value={p}>{PROVIDER_LABELS[p] ?? p}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Results per search</label>
                <input type="number" min={1} max={500} className={input} value={d.limitPerQuery} onChange={(e) => set({ limitPerQuery: Number(e.target.value) })} />
              </div>
              <div>
                <label className={label}>Spend cap per run (USD)</label>
                <input type="number" min={0} step={0.5} className={input} value={d.maxSpend} onChange={(e) => set({ maxSpend: Number(e.target.value) })} />
              </div>
            </div>
          </>
        )}

        {d.hunters.includes('intent') && (
          <div>
            <label className={label}>Buyer-post searches — one per line; {'{place}'} becomes each city</label>
            <textarea className={`${input} h-24`} value={d.intentQueries} onChange={(e) => set({ intentQueries: e.target.value })}
              placeholder={'need billing software for my shop {place}\nPOS software recommendation India\nwebsite designer for small business {place}'} />
            <div className="flex flex-wrap gap-3 mt-2">
              {options.intentChannels.map((ch: string) => (
                <label key={ch} className="flex items-center gap-1 text-xs text-forest">
                  <input type="checkbox" checked={d.intentChannels.includes(ch)} onChange={() => toggle('intentChannels', ch)} /> {ch}
                </label>
              ))}
            </div>
          </div>
        )}

        <div>
          <span className={label}>What we'll pitch</span>
          <div className="flex flex-wrap gap-3">
            {options.offers.map((o: string) => (
              <label key={o} className="flex items-center gap-1 text-xs text-forest">
                <input type="checkbox" checked={d.offers.includes(o)} onChange={() => toggle('offers', o)} /> {OFFER_LABELS[o] ?? o}
              </label>
            ))}
          </div>
          <input className={`${input} mt-2`} value={d.customOffers} onChange={(e) => set({ customOffers: e.target.value })} placeholder="Other offers, comma-separated (e.g. solar panels, CCTV)" />
        </div>

        <div>
          <label className={label}>Notes for whoever works these leads</label>
          <textarea className={`${input} h-16`} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>

        <label className="flex items-center gap-2 text-sm text-forest"><input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Enabled (hunters pick it up)</label>

        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs">Cancel</button>
          <button onClick={() => void save()} disabled={saving} className="px-3 py-1.5 rounded-lg bg-forest text-white text-xs font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save plan'}</button>
        </div>
      </div>
    </div>
  );
}
