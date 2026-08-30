/**
 * User-agent parsing plus bot filtering.
 *
 * Bot traffic is dropped at the collector, not filtered at query time — once a
 * crawler's pageviews are in the rollups every number downstream is wrong.
 */

import UAParser from 'ua-parser-js';

const BOT_PATTERNS = [
  'bot', 'crawler', 'spider', 'crawling', 'slurp', 'mediapartners',
  'facebookexternalhit', 'ia_archiver', 'headlesschrome', 'phantomjs',
  'python-requests', 'python-urllib', 'curl/', 'wget/', 'go-http-client',
  'java/', 'okhttp', 'apache-httpclient', 'axios/', 'node-fetch', 'got (',
  'postmanruntime', 'insomnia', 'lighthouse', 'pagespeed', 'gtmetrix',
  'pingdom', 'uptimerobot', 'statuscake', 'datadog', 'newrelic',
  'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'petalbot', 'bytespider',
  'applebot', 'linkedinbot', 'whatsapp', 'telegrambot', 'discordbot',
  'slackbot', 'twitterbot', 'embedly', 'quora link preview', 'skypeuripreview',
  'gptbot', 'ccbot', 'anthropic-ai', 'claudebot', 'perplexitybot', 'chatgpt-user',
  'google-extended', 'amazonbot', 'yandexbot', 'baiduspider', 'duckduckbot',
  'archive.org_bot', 'screaming frog', 'siteauditbot', 'seokicks',
];

export interface ParsedAgent {
  device: 'desktop' | 'mobile' | 'tablet';
  browser: string;
  browserVersion: string | null;
  os: string;
  isBot: boolean;
}

const cache = new Map<string, ParsedAgent>();
const CACHE_MAX = 5000;

export function isBot(userAgent: string): boolean {
  if (!userAgent) return true; // no UA at all is a script, not a person
  const ua = userAgent.toLowerCase();
  return BOT_PATTERNS.some((p) => ua.includes(p));
}

export function parseAgent(userAgent: string): ParsedAgent {
  const key = userAgent || '-';
  const hit = cache.get(key);
  if (hit) return hit;

  const bot = isBot(userAgent);
  let result: ParsedAgent;

  if (bot) {
    result = { device: 'desktop', browser: 'Bot', browserVersion: null, os: 'Bot', isBot: true };
  } else {
    const ua = new UAParser(userAgent);
    const type = ua.getDevice().type;
    result = {
      device: type === 'mobile' ? 'mobile' : type === 'tablet' ? 'tablet' : 'desktop',
      browser: ua.getBrowser().name || 'Unknown',
      browserVersion: (ua.getBrowser().version || '').split('.')[0] || null,
      os: ua.getOS().name || 'Unknown',
      isBot: false,
    };
  }

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, result);
  return result;
}

/** ISO-3166 alpha-2 country from whichever edge proxy is in front of us. */
export function countryFrom(headers: { get(name: string): string | undefined }): string | null {
  const raw =
    headers.get('cf-ipcountry') ||
    headers.get('x-vercel-ip-country') ||
    headers.get('x-country-code') ||
    headers.get('fly-client-country') ||
    null;
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1' ? code : null;
}

export function regionFrom(headers: { get(name: string): string | undefined }): string | null {
  const raw = headers.get('cf-region-code') || headers.get('x-vercel-ip-country-region') || null;
  return raw ? raw.trim().slice(0, 8).toUpperCase() : null;
}

export function cityFrom(headers: { get(name: string): string | undefined }): string | null {
  const raw = headers.get('cf-ipcity') || headers.get('x-vercel-ip-city') || null;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw).trim().slice(0, 80) || null;
  } catch {
    return raw.trim().slice(0, 80) || null;
  }
}
