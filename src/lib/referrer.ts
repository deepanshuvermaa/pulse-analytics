/**
 * Referrer normalisation and channel grouping.
 *
 * Raw `document.referrer` strings are useless for aggregation: `l.facebook.com`,
 * `m.facebook.com` and `lm.facebook.com` are three rows for one source. We
 * collapse a referrer to a canonical source name, then bucket it into a marketing
 * channel using the referrer plus any UTM/click-id parameters.
 */

export type Channel =
  | 'Direct'
  | 'Organic Search'
  | 'Paid Search'
  | 'Paid Social'
  | 'Organic Social'
  | 'Email'
  | 'Referral'
  | 'Affiliate'
  | 'Display'
  | 'Video'
  | 'Other';

/** host suffix → canonical display name */
const SOURCES: Array<[string, string]> = [
  // Search
  ['google.', 'Google'],
  ['bing.com', 'Bing'],
  ['duckduckgo.com', 'DuckDuckGo'],
  ['yahoo.', 'Yahoo'],
  ['yandex.', 'Yandex'],
  ['baidu.com', 'Baidu'],
  ['ecosia.org', 'Ecosia'],
  ['brave.com', 'Brave Search'],
  ['search.marginalia.nu', 'Marginalia'],
  ['startpage.com', 'Startpage'],
  ['qwant.com', 'Qwant'],
  // Social
  ['facebook.com', 'Facebook'],
  ['fb.com', 'Facebook'],
  ['instagram.com', 'Instagram'],
  ['l.instagram.com', 'Instagram'],
  ['twitter.com', 'X (Twitter)'],
  ['x.com', 'X (Twitter)'],
  ['t.co', 'X (Twitter)'],
  ['linkedin.com', 'LinkedIn'],
  ['lnkd.in', 'LinkedIn'],
  ['reddit.com', 'Reddit'],
  ['out.reddit.com', 'Reddit'],
  ['pinterest.', 'Pinterest'],
  ['tiktok.com', 'TikTok'],
  ['snapchat.com', 'Snapchat'],
  ['whatsapp.com', 'WhatsApp'],
  ['telegram.org', 'Telegram'],
  ['t.me', 'Telegram'],
  ['discord.com', 'Discord'],
  ['quora.com', 'Quora'],
  ['medium.com', 'Medium'],
  ['threads.net', 'Threads'],
  ['mastodon.social', 'Mastodon'],
  ['bsky.app', 'Bluesky'],
  // Video
  ['youtube.com', 'YouTube'],
  ['youtu.be', 'YouTube'],
  ['vimeo.com', 'Vimeo'],
  ['twitch.tv', 'Twitch'],
  // Dev / community
  ['news.ycombinator.com', 'Hacker News'],
  ['github.com', 'GitHub'],
  ['stackoverflow.com', 'Stack Overflow'],
  ['dev.to', 'DEV'],
  ['producthunt.com', 'Product Hunt'],
  // Mail
  ['mail.google.com', 'Gmail'],
  ['outlook.live.com', 'Outlook'],
  ['outlook.office.com', 'Outlook'],
  ['mail.yahoo.com', 'Yahoo Mail'],
];

const SEARCH_SOURCES = new Set([
  'Google', 'Bing', 'DuckDuckGo', 'Yahoo', 'Yandex', 'Baidu', 'Ecosia',
  'Brave Search', 'Marginalia', 'Startpage', 'Qwant',
]);

const SOCIAL_SOURCES = new Set([
  'Facebook', 'Instagram', 'X (Twitter)', 'LinkedIn', 'Reddit', 'Pinterest',
  'TikTok', 'Snapchat', 'WhatsApp', 'Telegram', 'Discord', 'Quora', 'Medium',
  'Threads', 'Mastodon', 'Bluesky', 'Hacker News', 'Product Hunt', 'DEV',
]);

const VIDEO_SOURCES = new Set(['YouTube', 'Vimeo', 'Twitch']);
const EMAIL_SOURCES = new Set(['Gmail', 'Outlook', 'Yahoo Mail']);

const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paidsearch', 'paid-search', 'sem', 'adwords']);
const SOCIAL_MEDIUMS = new Set(['social', 'social-network', 'social-media', 'sm', 'social_network']);
const PAID_SOCIAL_MEDIUMS = new Set(['paidsocial', 'paid-social', 'cpm-social']);
const EMAIL_MEDIUMS = new Set(['email', 'e-mail', 'e_mail', 'newsletter', 'mail']);
const DISPLAY_MEDIUMS = new Set(['display', 'banner', 'cpm', 'expandable', 'interstitial']);
const AFFILIATE_MEDIUMS = new Set(['affiliate', 'affiliates', 'partner']);
const VIDEO_MEDIUMS = new Set(['video', 'youtube']);

export interface ReferrerInfo {
  /** Bare hostname, lowercased, `www.` stripped. Null for direct traffic. */
  host: string | null;
  /** Canonical display name — "Google", "Reddit", or the bare host. */
  source: string;
  channel: Channel;
}

export function parseHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  const raw = referrer.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

export function canonicalSource(host: string | null): string | null {
  if (!host) return null;

  // Longest matching rule wins, not list order — otherwise `mail.google.com`
  // is swallowed by the generic `google.` rule and lands in Organic Search.
  let best: string | null = null;
  let bestLength = -1;

  for (const [needle, name] of SOURCES) {
    if (host === needle || host.endsWith(needle) || host.includes(needle)) {
      if (needle.length > bestLength) {
        best = name;
        bestLength = needle.length;
      }
    }
  }

  return best ?? host;
}

export interface UtmSet {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  term?: string | null;
  content?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  msclkid?: string | null;
}

/**
 * Classify a visit. UTM parameters win over the referrer header, because the
 * marketer explicitly declared intent; click ids win over everything.
 */
export function classify(referrer: string | null | undefined, utm: UtmSet = {}): ReferrerInfo {
  const host = parseHost(referrer);
  const refSource = canonicalSource(host);
  const utmSource = clean(utm.source);
  const medium = (clean(utm.medium) || '').toLowerCase();
  const source = utmSource || refSource || 'Direct';

  // Click ids are unambiguous paid signals.
  if (utm.gclid || utm.msclkid) return { host, source, channel: 'Paid Search' };
  if (utm.fbclid && medium && PAID_SOCIAL_MEDIUMS.has(medium)) return { host, source, channel: 'Paid Social' };

  if (medium) {
    if (PAID_MEDIUMS.has(medium)) return { host, source, channel: 'Paid Search' };
    if (PAID_SOCIAL_MEDIUMS.has(medium)) return { host, source, channel: 'Paid Social' };
    if (SOCIAL_MEDIUMS.has(medium)) return { host, source, channel: 'Organic Social' };
    if (EMAIL_MEDIUMS.has(medium)) return { host, source, channel: 'Email' };
    if (DISPLAY_MEDIUMS.has(medium)) return { host, source, channel: 'Display' };
    if (AFFILIATE_MEDIUMS.has(medium)) return { host, source, channel: 'Affiliate' };
    if (VIDEO_MEDIUMS.has(medium)) return { host, source, channel: 'Video' };
    if (medium === 'organic') return { host, source, channel: 'Organic Search' };
    if (medium === 'referral') return { host, source, channel: 'Referral' };
  }

  if (!host && !utmSource) return { host: null, source: 'Direct', channel: 'Direct' };

  const named = refSource || utmSource || '';
  if (SEARCH_SOURCES.has(named)) return { host, source, channel: 'Organic Search' };
  if (SOCIAL_SOURCES.has(named)) return { host, source, channel: 'Organic Social' };
  if (VIDEO_SOURCES.has(named)) return { host, source, channel: 'Video' };
  if (EMAIL_SOURCES.has(named)) return { host, source, channel: 'Email' };

  return { host, source, channel: host ? 'Referral' : 'Other' };
}

/** Is this referrer the site tracking itself? Those are internal navigations, not sources. */
export function isSelfReferral(host: string | null, projectDomain: string): boolean {
  if (!host) return false;
  const domain = (parseHost(projectDomain) || projectDomain).toLowerCase().replace(/^www\./, '');
  if (!domain) return false;
  return host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`);
}

function clean(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = String(v).trim().slice(0, 255);
  return t || null;
}

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

/** Pull UTM + click-id params out of a query string or full URL. */
export function extractUtm(input: string | null | undefined): UtmSet {
  if (!input) return {};
  const qs = input.includes('?') ? input.slice(input.indexOf('?')) : input.startsWith('utm') ? `?${input}` : '';
  if (!qs) return {};
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(qs);
  } catch {
    return {};
  }
  return {
    source: clean(params.get('utm_source')),
    medium: clean(params.get('utm_medium')),
    campaign: clean(params.get('utm_campaign')),
    term: clean(params.get('utm_term')),
    content: clean(params.get('utm_content')),
    gclid: clean(params.get('gclid')),
    fbclid: clean(params.get('fbclid')),
    msclkid: clean(params.get('msclkid')),
  };
}
