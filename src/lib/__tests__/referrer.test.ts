import { describe, it, expect } from 'vitest';
import { classify, parseHost, canonicalSource, extractUtm, isSelfReferral } from '../referrer.js';
import { pathExcluded, matches, errorFingerprint } from '../match.js';
import { parseFilters, filterFingerprint, canUseRollups, hasAnyFilter } from '../filters.js';

describe('referrer normalisation', () => {
  it('extracts a bare hostname', () => {
    expect(parseHost('https://www.google.com/search?q=test')).toBe('google.com');
    expect(parseHost('http://Example.COM:8080/path')).toBe('example.com');
    expect(parseHost('')).toBeNull();
    expect(parseHost(null)).toBeNull();
    expect(parseHost('not a url at all !!')).toBeNull();
  });

  it('collapses the many faces of one source into a single row', () => {
    // The whole point: these used to be four separate rows in the referrers table.
    for (const host of ['facebook.com', 'l.facebook.com', 'm.facebook.com', 'lm.facebook.com']) {
      expect(canonicalSource(host)).toBe('Facebook');
    }
    expect(canonicalSource('google.co.uk')).toBe('Google');
    expect(canonicalSource('t.co')).toBe('X (Twitter)');
    expect(canonicalSource('news.ycombinator.com')).toBe('Hacker News');
  });

  it('passes unknown hosts through unchanged', () => {
    expect(canonicalSource('some-blog.example')).toBe('some-blog.example');
  });
});

describe('channel grouping', () => {
  it('treats a missing referrer as direct', () => {
    expect(classify(null)).toMatchObject({ source: 'Direct', channel: 'Direct' });
  });

  it('separates organic search from paid search', () => {
    expect(classify('https://google.com/search').channel).toBe('Organic Search');
    expect(classify('https://google.com', { medium: 'cpc' }).channel).toBe('Paid Search');
    // A click id is unambiguous even without a medium.
    expect(classify('https://google.com', { gclid: 'abc123' }).channel).toBe('Paid Search');
  });

  it('classifies social, video and email', () => {
    expect(classify('https://reddit.com/r/x').channel).toBe('Organic Social');
    expect(classify('https://youtube.com/watch').channel).toBe('Video');
    expect(classify('https://mail.google.com/').channel).toBe('Email');
    expect(classify(null, { medium: 'newsletter', source: 'March Digest' }).channel).toBe('Email');
  });

  it('lets UTM parameters override the referrer header', () => {
    const info = classify('https://google.com', { source: 'partner-site', medium: 'affiliate' });
    expect(info.source).toBe('partner-site');
    expect(info.channel).toBe('Affiliate');
  });

  it('classifies an unknown external site as a referral', () => {
    expect(classify('https://some-blog.example/post').channel).toBe('Referral');
  });
});

describe('self referral detection', () => {
  it('recognises the customer navigating within their own site', () => {
    expect(isSelfReferral('example.com', 'example.com')).toBe(true);
    expect(isSelfReferral('blog.example.com', 'example.com')).toBe(true);
    expect(isSelfReferral('example.com', 'https://www.example.com')).toBe(true);
  });

  it('does not swallow genuine external referrers', () => {
    expect(isSelfReferral('google.com', 'example.com')).toBe(false);
    expect(isSelfReferral(null, 'example.com')).toBe(false);
    expect(isSelfReferral('notexample.com', 'example.com')).toBe(false);
  });
});

describe('UTM extraction', () => {
  it('pulls campaign parameters out of a path with a query string', () => {
    const utm = extractUtm('/pricing?utm_source=twitter&utm_medium=social&utm_campaign=launch');
    expect(utm.source).toBe('twitter');
    expect(utm.medium).toBe('social');
    expect(utm.campaign).toBe('launch');
  });

  it('captures click ids', () => {
    expect(extractUtm('/?gclid=xyz').gclid).toBe('xyz');
    expect(extractUtm('/?fbclid=abc').fbclid).toBe('abc');
  });

  it('returns nothing for a plain path', () => {
    expect(extractUtm('/pricing')).toEqual({});
    expect(extractUtm(null)).toEqual({});
  });
});

describe('pattern matching', () => {
  it('supports exact, prefix, contains and regex', () => {
    expect(matches('/pricing', '/pricing')).toBe(true);
    expect(matches('/pricing', '/pric', 'starts_with')).toBe(true);
    expect(matches('/a/b/c', 'b', 'contains')).toBe(true);
    expect(matches('/blog/2024/post', '^/blog/\\d{4}/', 'regex')).toBe(true);
    expect(matches('/blog/post', '^/blog/\\d{4}/', 'regex')).toBe(false);
  });

  it('treats a trailing star as a prefix wildcard', () => {
    expect(matches('/blog/hello', '/blog/*')).toBe(true);
    expect(matches('/shop/hello', '/blog/*')).toBe(false);
  });

  it('never throws on an invalid regex', () => {
    expect(matches('/anything', '([unclosed', 'regex')).toBe(false);
  });

  it('excludes paths by glob', () => {
    expect(pathExcluded('/admin/users', ['/admin/*'])).toBe(true);
    expect(pathExcluded('/health', ['/health'])).toBe(true);
    expect(pathExcluded('/a/preview/b', ['*preview*'])).toBe(true);
    expect(pathExcluded('/page.json', ['*.json'])).toBe(true);
    expect(pathExcluded('/public', ['/admin/*'])).toBe(false);
    expect(pathExcluded(null, ['/admin/*'])).toBe(false);
  });
});

describe('error fingerprinting', () => {
  it('groups the same error regardless of volatile numbers', () => {
    const a = errorFingerprint('Cannot read property x of undefined at line 42', 'app.js', 10);
    const b = errorFingerprint('Cannot read property x of undefined at line 99', 'app.js', 10);
    expect(a).toBe(b);
  });

  it('ignores cache-busting query strings on the source file', () => {
    expect(errorFingerprint('Boom', 'https://x.com/app.js?v=1', 5))
      .toBe(errorFingerprint('Boom', 'https://x.com/app.js?v=2', 5));
  });

  it('separates genuinely different errors', () => {
    expect(errorFingerprint('TypeError: a', 'app.js', 1))
      .not.toBe(errorFingerprint('ReferenceError: b', 'app.js', 1));
  });
});

describe('filter parsing', () => {
  const from = (obj: Record<string, string>) => (k: string) => obj[k];

  it('parses and normalises the segment filters', () => {
    const f = parseFilters(from({ path: '/pricing', country: 'in', device: 'mobile', visitorType: 'new' }));
    expect(f.path).toBe('/pricing');
    expect(f.country).toBe('IN'); // upper-cased for the ISO column
    expect(f.visitorType).toBe('new');
  });

  it('drops values outside the allowed set', () => {
    const f = parseFilters(from({ visitorType: 'banana', conversion: 'maybe' }));
    expect(f.visitorType).toBeUndefined();
    expect(f.conversion).toBeUndefined();
  });

  it('routes unfiltered queries to the rollup fast path', () => {
    const none = parseFilters(() => undefined);
    expect(hasAnyFilter(none)).toBe(false);
    expect(canUseRollups(none)).toBe(true);

    const filtered = parseFilters(from({ device: 'mobile' }));
    expect(canUseRollups(filtered)).toBe(false);
  });

  it('produces a stable cache fingerprint independent of key order', () => {
    const a = filterFingerprint(parseFilters(from({ device: 'mobile', path: '/x' })));
    const b = filterFingerprint(parseFilters(from({ path: '/x', device: 'mobile' })));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
