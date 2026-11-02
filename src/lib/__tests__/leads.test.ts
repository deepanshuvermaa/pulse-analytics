import { describe, it, expect } from 'vitest';
import {
  normalizePhone, normalizeEmail, isIndianMobile, scoreLead, mergeStatus,
  createRecord, mergeRecord, HOT_SCORE, type LeadInput,
} from '../leads.js';

function input(overrides: Partial<LeadInput> = {}): LeadInput {
  return {
    phone: '919876543210', email: null, name: null, businessName: null, businessType: null,
    city: null, address: null, website: null, message: null,
    source: 'website_form', ref: null, status: null, notes: null,
    channel: null, referrerSource: null, landingPath: null,
    utmSource: null, utmMedium: null, utmCampaign: null, sessionId: null, visitorId: null,
    attributes: {}, occurredAt: new Date('2026-10-20T10:00:00Z'),
    ...overrides,
  };
}

describe('phone normalisation', () => {
  it('collapses the ways one Indian mobile number gets written', () => {
    for (const raw of ['9876543210', '+91 98765 43210', '+91-98765-43210', '098765 43210', '00919876543210', '919876543210']) {
      expect(normalizePhone(raw)).toBe('919876543210');
    }
  });

  it('keeps landlines and foreign numbers but rejects junk', () => {
    expect(normalizePhone('0522 2345678')).toBe('915222345678');
    expect(normalizePhone('+44 20 7946 0958')).toBe('442079460958');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it('knows which numbers WhatsApp outreach can reach', () => {
    expect(isIndianMobile('919876543210')).toBe(true);
    expect(isIndianMobile('915222345678')).toBe(false);
    expect(isIndianMobile(null)).toBe(false);
  });
});

describe('email normalisation', () => {
  it('lowercases valid addresses and drops invalid ones', () => {
    expect(normalizeEmail('  Owner@Shop.IN ')).toBe('owner@shop.in');
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
});

describe('scoring', () => {
  it('ranks an inbound form lead above a cold scraped lead', () => {
    const form = scoreLead({ phone: '919876543210', email: 'a@b.in', source: 'website_form', channel: 'Organic Search', message: 'Need billing for 2 counters in my store' });
    const scraped = scoreLead({ phone: '919876543210', email: null, source: 'maps_scraper', channel: null, message: null });
    expect(form).toBeGreaterThanOrEqual(HOT_SCORE);
    expect(scraped).toBeLessThan(HOT_SCORE);
    expect(form).toBeGreaterThan(scraped);
  });

  it('rewards a lead that keeps coming back through different sources', () => {
    const once = scoreLead({ phone: '919876543210', email: null, source: 'maps_scraper', channel: null, message: null });
    const again = scoreLead({ phone: '919876543210', email: null, source: 'maps_scraper', sources: ['maps_scraper', 'whatsapp'], channel: null, message: null, touches: 2 });
    expect(again).toBeGreaterThan(once);
  });

  it('never exceeds 100', () => {
    expect(scoreLead({
      phone: '919876543210', email: 'a@b.in', source: 'website_form', sources: ['website_form', 'whatsapp', 'referral'],
      channel: 'AI Assistant', message: 'x'.repeat(50), touches: 5, attributes: { rating: 4.8, reviews_count: 300 },
    })).toBeLessThanOrEqual(100);
  });
});

describe('merging', () => {
  it('lets a source move a lead out of new but never override a person', () => {
    expect(mergeStatus('new', 'contacted')).toBe('contacted');
    expect(mergeStatus('qualified', 'contacted')).toBe('qualified');
    expect(mergeStatus('won', null)).toBe('won');
  });

  it('turns a scraped lead that later fills the form into one lead with two touches', () => {
    const scraped = createRecord(input({ source: 'maps_scraper', ref: 'maps_scraper:42', businessName: 'Sharma Kirana', city: 'Lucknow', attributes: { rating: 4.2 } }));
    const merged = mergeRecord(scraped, input({
      source: 'website_form', name: 'Ravi Sharma', email: 'ravi@shop.in', businessName: 'Sharma General Store',
      channel: 'AI Assistant', message: 'Want a demo', occurredAt: new Date('2026-10-24T09:00:00Z'),
    }));
    expect(merged.touches).toBe(2);
    expect(merged.sources).toEqual(['maps_scraper', 'website_form']);
    expect(merged.businessName).toBe('Sharma Kirana'); // first value kept
    expect(merged.name).toBe('Ravi Sharma'); // gap filled
    expect(merged.email).toBe('ravi@shop.in');
    expect(merged.channel).toBe('AI Assistant');
    expect(merged.lastSeenAt.toISOString()).toBe('2026-10-24T09:00:00.000Z');
    expect(merged.score).toBeGreaterThan(scraped.score);
  });

  it('does not count a re-sync of the same source record as a new touch', () => {
    const first = createRecord(input({ source: 'maps_scraper', ref: 'maps_scraper:7' }));
    const resynced = mergeRecord(first, input({ source: 'maps_scraper', ref: 'maps_scraper:7', status: 'contacted' }));
    expect(resynced.touches).toBe(1);
    expect(resynced.status).toBe('contacted');
  });

  it('keeps a second phone number instead of losing it', () => {
    const first = createRecord(input({ email: 'owner@shop.in' }));
    const merged = mergeRecord(first, input({ phone: '919000000001', email: 'owner@shop.in' }));
    expect(merged.phone).toBe('919876543210');
    expect(merged.attributes.alt_phones).toEqual(['919000000001']);
  });
});

describe('hot lead alert text', () => {
  it('fits a phone notification and links straight to WhatsApp', async () => {
    const { hotLeadText } = await import('../leads-store.js');
    const text = hotLeadText('Go2', input({
      name: 'Ravi Sharma', businessName: 'Sharma Kirana', businessType: 'Kirana', city: 'Lucknow',
      source: 'trial', channel: 'AI Assistant', landingPath: '/best-billing-software-india/', message: 'Need billing for 2 counters',
    }), 90);
    expect(text.split('\n')).toEqual([
      '🔥 [Go2] Hot lead (90/100)',
      'Ravi Sharma · Sharma Kirana',
      '📞 +919876543210  ·  https://wa.me/919876543210',
      'Kirana · Lucknow',
      'Came in: trial via AI Assistant (/best-billing-software-india/)',
      '“Need billing for 2 counters”',
    ]);
  });
});
