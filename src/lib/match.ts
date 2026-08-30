/**
 * Pattern matching shared by goals, funnels and path exclusions.
 * All matching is done in JS (never interpolated into SQL) so user-supplied
 * patterns can never widen a query.
 */

export type MatchType = 'exact' | 'contains' | 'starts_with' | 'regex';

const regexCache = new Map<string, RegExp | null>();

function compile(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern)!;
  let re: RegExp | null = null;
  try {
    // Bound the pattern length; a pathological regex on every event is a DoS.
    re = pattern.length <= 200 ? new RegExp(pattern) : null;
  } catch {
    re = null;
  }
  if (regexCache.size > 500) regexCache.clear();
  regexCache.set(pattern, re);
  return re;
}

export function matches(value: string | null | undefined, pattern: string, type: MatchType = 'exact'): boolean {
  if (value === null || value === undefined) return false;
  switch (type) {
    case 'contains':
      return value.includes(pattern);
    case 'starts_with':
      return value.startsWith(pattern);
    case 'regex': {
      const re = compile(pattern);
      return re ? re.test(value) : false;
    }
    default:
      // `exact` still honours a single trailing `*` so `/blog/*` behaves as expected.
      if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
      return value === pattern;
  }
}

/** Path exclusion: supports `*` prefix/suffix wildcards. */
export function pathExcluded(path: string | null, patterns: string[]): boolean {
  if (!path || !patterns?.length) return false;
  for (const raw of patterns) {
    const p = raw.trim();
    if (!p) continue;
    if (p.startsWith('*') && p.endsWith('*')) {
      if (path.includes(p.slice(1, -1))) return true;
    } else if (p.endsWith('*')) {
      if (path.startsWith(p.slice(0, -1))) return true;
    } else if (p.startsWith('*')) {
      if (path.endsWith(p.slice(1))) return true;
    } else if (path === p) {
      return true;
    }
  }
  return false;
}

/** Stable short fingerprint for grouping JS errors. */
export function errorFingerprint(message: string, source?: string | null, line?: number | null): string {
  // Strip volatile parts: numbers in messages, cache-busting query strings.
  const normalisedMessage = String(message || '')
    .slice(0, 500)
    .replace(/\d+/g, 'N')
    .replace(/0x[0-9a-f]+/gi, 'H')
    .trim();
  const normalisedSource = String(source || '').split('?')[0].split('/').pop() || '';
  const basis = `${normalisedMessage}|${normalisedSource}|${line ?? ''}`;
  // FNV-1a, hex — short, stable, and collision-safe enough for grouping.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < basis.length; i++) {
    h1 ^= basis.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ basis.charCodeAt(i), 0x85ebca6b);
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
}
