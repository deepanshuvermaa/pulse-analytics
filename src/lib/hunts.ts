/**
 * Hunt plans: what to look for, where, and with which hunter.
 *
 * A plan is the one place a person decides "kirana stores and chemists across
 * Uttar Pradesh and Gujarat, pitch billing machines" — the Harvey discovery
 * agent, the Maps scraper checklist and the buyer-intent search all read the
 * same plan from the hub, so widening the hunt to a new region or a new kind
 * of business is an edit in the dashboard, not a code change.
 */

export const HUNTERS = ['harvey', 'maps_scraper', 'intent'] as const;
export type Hunter = (typeof HUNTERS)[number];

/** Harvey's discovery providers. osm is free; the rest need a key on Harvey's machine. */
export const DISCOVERY_PROVIDERS = ['osm', 'serper_places', 'dataforseo_listings', 'dataforseo_serp', 'serper'] as const;

/** Agent Reach channels the intent hunter can search (read-only). */
export const INTENT_CHANNELS = ['reddit', 'web', 'youtube', 'twitter', 'linkedin', 'facebook', 'instagram', 'github'] as const;

/** Pitches Harvey can infer from what it observes; anything else is a custom offer. */
export const BUILT_IN_OFFERS = ['website', 'seo_aeo', 'google_profile_reviews', 'billing_software', 'billing_machine', 'online_booking'] as const;

export interface HuntPlanFields {
  name: string;
  enabled: boolean;
  hunters: Hunter[];
  terms: string[];
  regions: string[];
  places: string[];
  country: string | null;
  provider: string;
  limitPerQuery: number;
  maxSpend: number;
  intentQueries: string[];
  intentChannels: string[];
  offers: string[];
  notes: string | null;
}

/** Trim, drop blanks and case-insensitive duplicates, keep the order the person typed. */
export function cleanList(values: readonly string[] | null | undefined, maxItems: number, maxLength: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values ?? []) {
    const value = String(raw).replace(/\s+/g, ' ').trim().slice(0, maxLength);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Offers become snake_case tags so a custom "Solar panels" matches across sources. */
export function offerTag(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

export function normalizePlan(input: HuntPlanFields): HuntPlanFields {
  return {
    name: input.name.replace(/\s+/g, ' ').trim().slice(0, 120),
    enabled: input.enabled,
    hunters: [...new Set(input.hunters)],
    terms: cleanList(input.terms, 50, 120),
    regions: cleanList(input.regions, 50, 160),
    places: cleanList(input.places, 500, 200),
    country: input.country ? input.country.trim().toLowerCase() : null,
    provider: input.provider,
    limitPerQuery: Math.min(Math.max(Math.round(input.limitPerQuery), 1), 500),
    maxSpend: Math.min(Math.max(input.maxSpend, 0), 1000),
    intentQueries: cleanList(input.intentQueries, 50, 200),
    intentChannels: [...new Set(input.intentChannels)],
    offers: [...new Set(input.offers.map(offerTag).filter(Boolean))].slice(0, 20),
    notes: input.notes?.trim() ? input.notes.trim().slice(0, 4000) : null,
  };
}

/**
 * Where each hunter will search: the reviewed place list when there is one,
 * otherwise the regions as typed (hunters expand a state into cities themselves).
 */
export function searchPlaces(plan: Pick<HuntPlanFields, 'places' | 'regions'>): string[] {
  return plan.places.length ? plan.places : plan.regions;
}

/** Searches one Harvey or scraper run makes: every term in every place. */
export function searchCount(plan: Pick<HuntPlanFields, 'terms' | 'places' | 'regions'>): number {
  return plan.terms.length * searchPlaces(plan).length;
}

/**
 * Intent searches: "{place}" in a query is filled with each place's first
 * segment ("Lucknow" from "Lucknow, Uttar Pradesh, India"); queries without it
 * run once.
 */
export function intentSearches(plan: Pick<HuntPlanFields, 'intentQueries' | 'places' | 'regions'>): string[] {
  const places = searchPlaces(plan).map((p) => p.split(',')[0].trim()).filter(Boolean);
  const out: string[] = [];
  for (const query of plan.intentQueries) {
    if (query.includes('{place}')) {
      for (const place of places) out.push(query.split('{place}').join(place));
    } else {
      out.push(query);
    }
  }
  return cleanList(out, 500, 240);
}
