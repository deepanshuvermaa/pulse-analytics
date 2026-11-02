import { describe, it, expect } from 'vitest';
import { cleanList, offerTag, normalizePlan, searchPlaces, searchCount, intentSearches, type HuntPlanFields } from '../hunts.js';
import { rankPlaces } from '../regions.js';

function plan(overrides: Partial<HuntPlanFields> = {}): HuntPlanFields {
  return {
    name: 'UP kirana', enabled: true, hunters: ['harvey'], terms: [], regions: [], places: [],
    country: null, provider: 'osm', limitPerQuery: 60, maxSpend: 1, intentQueries: [],
    intentChannels: ['reddit'], offers: [], notes: null, ...overrides,
  };
}

describe('hunt plan normalisation', () => {
  it('cleans lists the way a person types them', () => {
    expect(cleanList(['  Kirana  store', 'kirana store', '', 'Chemist'], 10, 50)).toEqual(['Kirana store', 'Chemist']);
    expect(cleanList(['a', 'b', 'c'], 2, 50)).toEqual(['a', 'b']);
  });

  it('turns any offer into a stable tag', () => {
    expect(offerTag('Solar Panels')).toBe('solar_panels');
    expect(offerTag('billing_machine')).toBe('billing_machine');
  });

  it('clamps numbers and lowercases the country', () => {
    const p = normalizePlan(plan({ limitPerQuery: 5000, maxSpend: -3, country: 'IN', offers: ['Website', 'website'] }));
    expect(p.limitPerQuery).toBe(500);
    expect(p.maxSpend).toBe(0);
    expect(p.country).toBe('in');
    expect(p.offers).toEqual(['website']);
  });
});

describe('where a plan searches', () => {
  it('uses reviewed places when present, otherwise the regions as typed', () => {
    expect(searchPlaces(plan({ regions: ['Gujarat'] }))).toEqual(['Gujarat']);
    expect(searchPlaces(plan({ regions: ['Gujarat'], places: ['Surat, Gujarat'] }))).toEqual(['Surat, Gujarat']);
  });

  it('counts every term in every place', () => {
    expect(searchCount(plan({ terms: ['kirana', 'chemist'], places: ['Lucknow', 'Kanpur', 'Agra'] }))).toBe(6);
  });

  it('fills {place} in intent searches with each city name', () => {
    const searches = intentSearches(plan({
      intentQueries: ['billing machine dealer {place}', 'Vyapar alternative'],
      places: ['Lucknow, Uttar Pradesh, India', 'Kanpur, Uttar Pradesh, India'],
    }));
    expect(searches).toEqual(['billing machine dealer Lucknow', 'billing machine dealer Kanpur', 'Vyapar alternative']);
  });
});

describe('region ranking', () => {
  it('puts the biggest places first, drops duplicates, keeps the region in the label', () => {
    expect(rankPlaces('Uttar Pradesh', [
      { name: 'Agra', population: 1_500_000 },
      { name: 'Prayagraj', population: 5_959_798 },
      { name: 'agra', population: 10 },
      { name: '', population: 1 },
    ])).toEqual(['Prayagraj, Uttar Pradesh', 'Agra, Uttar Pradesh']);
  });
});
