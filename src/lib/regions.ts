/**
 * Region → places, for previewing a hunt plan before anyone runs it.
 *
 * "Uttar Pradesh" has to become "Prayagraj, Lucknow, Varanasi, …" because
 * listings searches work around a point. OpenStreetMap answers that for free:
 * Nominatim resolves the name, Overpass lists the cities inside the boundary,
 * and population tags put the biggest markets first. A city or neighbourhood
 * passes through as typed. Harvey runs the same expansion on its side, so a
 * plan saved with regions only still works; this preview lets a person see
 * and trim the list first.
 */

import { redis } from './redis.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
// OSM's usage policy asks for an identifying user agent.
const USER_AGENT = 'pulse-analytics lead hub (region preview)';
const EXPANDABLE = new Set(['country', 'state', 'region', 'province', 'state_district', 'district', 'county']);
const CACHE_TTL_SEC = 30 * 24 * 3600;

export interface RegionExpansion {
  /** What the region resolved to, e.g. "state" or "city". */
  kind: string;
  /** Places to search, biggest first. The region itself when it is already a place. */
  places: string[];
  /** Total places found before the cap, so the UI can say "showing 25 of 75". */
  available: number;
  error?: string;
}

/** Biggest-first unique names, labelled with the region so geocoding can't pick a namesake abroad. */
export function rankPlaces(region: string, found: Array<{ name: string; population: number }>): string[] {
  const seen = new Set<string>();
  return [...found]
    .sort((a, b) => b.population - a.population)
    .filter((p) => {
      const key = p.name.toLowerCase();
      if (!p.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => `${p.name}, ${region}`);
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function placesInArea(areaId: number, includeTowns: boolean): Promise<Array<{ name: string; population: number }>> {
  const kinds = includeTowns ? 'city|town' : 'city';
  const query = `[out:json][timeout:90];area(${areaId})->.a;node["place"~"^(${kinds})$"](area.a);out tags;`;
  let lastError: unknown;
  for (const endpoint of OVERPASS) {
    try {
      const body = (await fetchJson(endpoint, { method: 'POST', body: query }, 100_000)) as { elements?: Array<{ tags?: Record<string, string> }> };
      return (body.elements ?? []).map((el) => {
        const tags = el.tags ?? {};
        return {
          name: tags['name:en'] || tags.name || '',
          population: Number(String(tags.population ?? '').replace(/\D/g, '')) || 0,
        };
      });
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`Could not list places: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function expandRegion(region: string, maxPlaces = 25, includeTowns = false): Promise<RegionExpansion> {
  const name = region.trim();
  if (!name) return { kind: 'empty', places: [], available: 0 };
  const cacheKey = `region:${name.toLowerCase()}|${includeTowns ? 1 : 0}`;

  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    const hit = JSON.parse(cached) as { kind: string; places: string[] };
    return { kind: hit.kind, places: hit.places.slice(0, maxPlaces), available: hit.places.length };
  }

  try {
    const hits = (await fetchJson(`${NOMINATIM}?${new URLSearchParams({ q: name, format: 'json', limit: '1' })}`, {}, 15_000)) as Array<{
      osm_type: string; osm_id: number | string; addresstype?: string;
    }>;
    const hit = hits[0];
    if (!hit) return { kind: 'unknown', places: [name], available: 1, error: 'Not found on the map — will be searched as typed' };

    const kind = hit.addresstype ?? 'place';
    let places = [name];
    if (EXPANDABLE.has(kind) && hit.osm_type === 'relation') {
      // Overpass addresses an administrative boundary relation as 3600000000 + id.
      const found = await placesInArea(3_600_000_000 + Number(hit.osm_id), includeTowns);
      const ranked = rankPlaces(name, found);
      if (ranked.length) places = ranked;
    }
    await redis.set(cacheKey, JSON.stringify({ kind, places }), 'EX', CACHE_TTL_SEC).catch(() => undefined);
    return { kind, places: places.slice(0, maxPlaces), available: places.length };
  } catch (e) {
    return { kind: 'unknown', places: [name], available: 1, error: e instanceof Error ? e.message : 'Lookup failed' };
  }
}
