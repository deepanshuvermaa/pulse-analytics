import 'dotenv/config';

/**
 * Missing configuration is collected and reported all at once.
 *
 * Throwing from module scope on the first missing variable produced a container
 * that died before binding a port, so the platform healthcheck only ever
 * reported "service unavailable" with no clue why. Now the process names every
 * missing variable on stderr before exiting.
 */
const missing: string[] = [];

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    missing.push(name);
    return '';
  }
  return v;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

function int(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const NODE_ENV = process.env.NODE_ENV || 'development';

export const env = {
  NODE_ENV,
  IS_PROD: NODE_ENV === 'production',

  DATABASE_URL: required('DATABASE_URL'),
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  JWT_SECRET: required('JWT_SECRET'),
  JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET'),

  PORT: int('PORT', 3000),
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',

  /** Email that is force-promoted to admin on boot. Optional. */
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',

  /**
   * Server-side secret mixed into the daily visitor salt. Rotating this
   * invalidates all cookieless visitor identities immediately.
   */
  IDENTITY_PEPPER: process.env.IDENTITY_PEPPER || required('JWT_SECRET'),

  /** Ingest pipeline. */
  INGEST_STREAM: 'pulse:events',
  INGEST_GROUP: 'writers',
  INGEST_MAXLEN: int('INGEST_MAXLEN', 1_000_000),
  INGEST_BATCH: int('INGEST_BATCH', 500),
  INGEST_BLOCK_MS: int('INGEST_BLOCK_MS', 2000),

  /** Background workers. Disable on read-only replicas. */
  RUN_INGEST_WORKER: bool('RUN_INGEST_WORKER', true),
  RUN_ROLLUP_WORKER: bool('RUN_ROLLUP_WORKER', true),
  RUN_ALERT_WORKER: bool('RUN_ALERT_WORKER', true),

  /** How often the rollup worker re-materialises the current (open) day. */
  ROLLUP_HOT_INTERVAL_MS: int('ROLLUP_HOT_INTERVAL_MS', 5 * 60 * 1000),
  ALERT_INTERVAL_MS: int('ALERT_INTERVAL_MS', 10 * 60 * 1000),

  /** Session inactivity window, in seconds. */
  SESSION_TIMEOUT_SEC: int('SESSION_TIMEOUT_SEC', 30 * 60),

  /** Per-visitor collector rate limit. */
  RATE_LIMIT_EVENTS: int('RATE_LIMIT_EVENTS', 240),
  RATE_LIMIT_WINDOW_SEC: int('RATE_LIMIT_WINDOW_SEC', 60),

  /** Default project data retention. 0 = keep forever. */
  DEFAULT_RETENTION_DAYS: int('DEFAULT_RETENTION_DAYS', 0),

  /** Free-plan project cap for non-admin users. */
  MAX_PROJECTS_FREE: int('MAX_PROJECTS_FREE', 5),

  /** Analytics query cache TTLs, in seconds. */
  CACHE_TTL_OPEN: int('CACHE_TTL_OPEN', 60),
  CACHE_TTL_CLOSED: int('CACHE_TTL_CLOSED', 3600),
} as const;

if (missing.length) {
  console.error(
    `\nFATAL: missing required environment variable${missing.length > 1 ? 's' : ''}:\n` +
      missing.map((m) => `  - ${m}`).join('\n') +
      `\n\nSet ${missing.length > 1 ? 'them' : 'it'} in your deployment environment and redeploy.\n`,
  );
  process.exit(1);
}
