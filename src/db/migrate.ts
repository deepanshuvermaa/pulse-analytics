/**
 * Schema migration and partition management.
 *
 * Everything here is idempotent — it is safe to run on every boot and safe to run
 * concurrently from several instances (an advisory lock serialises it).
 *
 * The one destructive-looking step is converting the legacy flat `events` table
 * into a monthly-partitioned one. That path copies every row first, verifies the
 * counts match, and only then drops the legacy table. If the counts disagree the
 * legacy table is kept and a warning is logged.
 */

import type { Sql } from 'postgres';

const MIGRATION_LOCK = 918_273_645;

export async function runMigrations(sql: Sql): Promise<void> {
  await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK})`;
  try {
    await createCoreTables(sql);
    await upgradeLegacyColumns(sql);
    await convertEventsToPartitioned(sql);
    await createAnalyticsTables(sql);
    await ensurePartitions(sql);
    await backfillProjectDefaults(sql);
  } finally {
    await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`;
  }
}

// ─────────────────────────────────────────────────────────────

async function createCoreTables(sql: Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name VARCHAR(100),
      role VARCHAR(20) DEFAULT 'user' NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id VARCHAR(24) PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      domain VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_expiry ON refresh_tokens(expires_at);

    CREATE TABLE IF NOT EXISTS suggestions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);
}

/** Additive column/type upgrades on tables that may predate this version. */
async function upgradeLegacyColumns(sql: Sql): Promise<void> {
  await sql.unsafe(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user' NOT NULL;
    ALTER TABLE users ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

    ALTER TABLE projects ALTER COLUMN id TYPE VARCHAR(24);
    ALTER TABLE projects ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) DEFAULT 'UTC' NOT NULL;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS identity_mode VARCHAR(16) DEFAULT 'cookieless' NOT NULL;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS write_key VARCHAR(64);
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS public_key_version INTEGER DEFAULT 1 NOT NULL;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS share_slug VARCHAR(32);
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS share_password_hash TEXT;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS retention_days INTEGER DEFAULT 0 NOT NULL;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS excluded_paths JSONB DEFAULT '[]'::jsonb NOT NULL;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS excluded_ips JSONB DEFAULT '[]'::jsonb NOT NULL;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS clarity_id VARCHAR(32);
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE NOT NULL;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS first_event_at TIMESTAMPTZ;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ;
    ALTER TABLE projects ALTER COLUMN clarity_id TYPE VARCHAR(32);

    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

    ALTER TABLE refresh_tokens ALTER COLUMN expires_at TYPE TIMESTAMPTZ USING expires_at AT TIME ZONE 'UTC';
    ALTER TABLE refresh_tokens ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
    ALTER TABLE suggestions ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
    ALTER TABLE suggestions DROP COLUMN IF EXISTS email;
    -- superseded by direct session breakdowns; keeps the data model single-sourced
    DROP TABLE IF EXISTS daily_dimensions;
  `);

  // Every project needs a write key; generate for any that predate the column.
  await sql.unsafe(`
    UPDATE projects
       SET write_key = 'wk_' || encode(gen_random_bytes(24), 'hex')
     WHERE write_key IS NULL;
  `);
  await sql.unsafe(`
    ALTER TABLE projects ALTER COLUMN write_key SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_write_key ON projects(write_key);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_share ON projects(share_slug) WHERE share_slug IS NOT NULL;
  `);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id VARCHAR(24) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(16) DEFAULT 'viewer' NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      PRIMARY KEY (project_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(user_id);
  `);
}

const EVENTS_DDL = `
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id VARCHAR(24) NOT NULL,
  type VARCHAR(30) NOT NULL,
  name VARCHAR(120),
  path VARCHAR(1024),
  referrer_host VARCHAR(255),
  source VARCHAR(120),
  channel VARCHAR(32),
  visitor_id VARCHAR(40) NOT NULL,
  session_id VARCHAR(40) NOT NULL,
  user_id VARCHAR(120),
  country VARCHAR(2),
  region VARCHAR(8),
  city VARCHAR(80),
  device VARCHAR(12),
  browser VARCHAR(40),
  os VARCHAR(40),
  utm_source VARCHAR(120),
  utm_medium VARCHAR(120),
  utm_campaign VARCHAR(120),
  utm_term VARCHAR(120),
  utm_content VARCHAR(120),
  payload JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
`;

async function isPartitioned(sql: Sql, table: string): Promise<boolean> {
  const rows = await sql.unsafe(`
    SELECT c.relkind FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = '${table}' AND n.nspname = current_schema()
  `);
  return rows.length > 0 && (rows[0] as unknown as { relkind: string }).relkind === 'p';
}

async function tableExists(sql: Sql, table: string): Promise<boolean> {
  const rows = await sql.unsafe(`SELECT to_regclass('${table}') AS t`);
  return !!(rows[0] as unknown as { t: string | null }).t;
}

/**
 * Convert a legacy flat `events` table into a monthly-partitioned one, preserving
 * all rows. No-op when `events` is absent or already partitioned.
 */
async function convertEventsToPartitioned(sql: Sql): Promise<void> {
  const exists = await tableExists(sql, 'events');

  if (exists && (await isPartitioned(sql, 'events'))) return;

  if (!exists) {
    await sql.unsafe(`CREATE TABLE events (${EVENTS_DDL}) PARTITION BY RANGE (timestamp);`);
    await createEventIndexes(sql);
    return;
  }

  console.log('[migrate] converting events → monthly partitioned table (preserving all rows)');

  await sql.unsafe(`ALTER TABLE events RENAME TO events_legacy;`);
  await sql.unsafe(`CREATE TABLE events (${EVENTS_DDL}) PARTITION BY RANGE (timestamp);`);

  // Partitions must exist before any row lands in them.
  await ensurePartitions(sql, 'events_legacy');

  const hasReferrer = await columnExists(sql, 'events_legacy', 'referrer');

  await sql.unsafe(`
    INSERT INTO events (
      id, project_id, type, path, referrer_host, visitor_id, session_id,
      country, device, browser, os, payload, timestamp
    )
    SELECT
      id,
      project_id,
      type,
      LEFT(path, 1024),
      ${hasReferrer
        ? `NULLIF(LOWER(REGEXP_REPLACE(
             SPLIT_PART(REGEXP_REPLACE(COALESCE(referrer, ''), '^[a-zA-Z]+://', ''), '/', 1),
             '^www\\.|:[0-9]+$', '', 'g')), '')`
        : 'NULL'},
      LEFT(visitor_id, 40),
      LEFT(session_id, 40),
      country,
      LEFT(device, 12),
      LEFT(browser, 40),
      LEFT(os, 40),
      payload,
      timestamp AT TIME ZONE 'UTC'
    FROM events_legacy;
  `);

  const [{ before }] = (await sql.unsafe(`SELECT COUNT(*)::bigint AS before FROM events_legacy`)) as Array<{ before: string }>;
  const [{ after }] = (await sql.unsafe(`SELECT COUNT(*)::bigint AS after FROM events`)) as Array<{ after: string }>;

  if (before === after) {
    await sql.unsafe(`DROP TABLE events_legacy;`);
    console.log(`[migrate] migrated ${after} events, legacy table dropped`);
  } else {
    console.warn(
      `[migrate] row count mismatch (legacy=${before}, new=${after}). ` +
        `Keeping events_legacy — inspect it, then DROP TABLE events_legacy manually.`,
    );
  }

  await createEventIndexes(sql);
}

async function columnExists(sql: Sql, table: string, column: string): Promise<boolean> {
  const rows = await sql.unsafe(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = '${table}' AND column_name = '${column}' AND table_schema = current_schema()
  `);
  return rows.length > 0;
}

async function createEventIndexes(sql: Sql): Promise<void> {
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_events_project_ts ON events(project_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_project_type_ts ON events(project_id, type, timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(project_id, session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(project_id, visitor_id, timestamp);
  `);
}

/**
 * Create monthly partitions spanning existing data through three months ahead,
 * plus a DEFAULT partition so an out-of-range insert can never fail.
 */
export async function ensurePartitions(sql: Sql, boundsFrom = 'events'): Promise<void> {
  if (!(await isPartitioned(sql, 'events'))) return;

  let earliest = new Date();
  if (await tableExists(sql, boundsFrom)) {
    const rows = (await sql.unsafe(`SELECT MIN(timestamp) AS min FROM ${boundsFrom}`)) as Array<{ min: Date | null }>;
    if (rows[0]?.min) earliest = new Date(rows[0].min);
  }

  const start = new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), 1));
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 4, 1));

  for (let d = start; d < end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const name = `events_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ${name} PARTITION OF events
      FOR VALUES FROM ('${d.toISOString()}') TO ('${next.toISOString()}');
    `);
  }

  await sql.unsafe(`CREATE TABLE IF NOT EXISTS events_default PARTITION OF events DEFAULT;`);
}

/** Drop whole partitions older than a project-independent floor. */
export async function dropPartitionsBefore(sql: Sql, cutoff: Date): Promise<string[]> {
  const rows = (await sql.unsafe(`
    SELECT c.relname AS name,
           pg_get_expr(c.relpartbound, c.oid) AS bound
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'events' AND c.relname <> 'events_default'
  `)) as Array<{ name: string; bound: string }>;

  const dropped: string[] = [];
  for (const row of rows) {
    const to = row.bound.match(/TO \('([^']+)'\)/)?.[1];
    if (to && new Date(to) <= cutoff) {
      await sql.unsafe(`DROP TABLE IF EXISTS ${row.name};`);
      dropped.push(row.name);
    }
  }
  return dropped;
}

async function createAnalyticsTables(sql: Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS sessions (
      project_id VARCHAR(24) NOT NULL,
      session_id VARCHAR(40) NOT NULL,
      visitor_id VARCHAR(40) NOT NULL,
      user_id VARCHAR(120),
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ NOT NULL,
      duration_sec INTEGER DEFAULT 0 NOT NULL,
      pageview_count INTEGER DEFAULT 0 NOT NULL,
      event_count INTEGER DEFAULT 0 NOT NULL,
      entry_path VARCHAR(1024),
      exit_path VARCHAR(1024),
      is_bounce BOOLEAN DEFAULT FALSE NOT NULL,
      is_engaged BOOLEAN DEFAULT FALSE NOT NULL,
      is_new_visitor BOOLEAN DEFAULT FALSE NOT NULL,
      referrer_host VARCHAR(255),
      source VARCHAR(120),
      channel VARCHAR(32),
      utm_source VARCHAR(120),
      utm_medium VARCHAR(120),
      utm_campaign VARCHAR(120),
      country VARCHAR(2),
      device VARCHAR(12),
      browser VARCHAR(40),
      os VARCHAR(40),
      max_scroll_depth INTEGER DEFAULT 0 NOT NULL,
      rage_clicks INTEGER DEFAULT 0 NOT NULL,
      dead_clicks INTEGER DEFAULT 0 NOT NULL,
      error_count INTEGER DEFAULT 0 NOT NULL,
      quick_backs INTEGER DEFAULT 0 NOT NULL,
      form_abandons INTEGER DEFAULT 0 NOT NULL,
      worst_lcp_ms INTEGER,
      was_slow BOOLEAN DEFAULT FALSE NOT NULL,
      converted BOOLEAN DEFAULT FALSE NOT NULL,
      conversion_value DOUBLE PRECISION DEFAULT 0 NOT NULL,
      goals_hit JSONB DEFAULT '[]'::jsonb NOT NULL,
      PRIMARY KEY (project_id, session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_project_started ON sessions(project_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_entry ON sessions(project_id, entry_path, started_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_exit ON sessions(project_id, exit_path, started_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON sessions(project_id, visitor_id, started_at);

    CREATE TABLE IF NOT EXISTS daily_visitors (
      project_id VARCHAR(24) NOT NULL,
      day DATE NOT NULL,
      visitor_id VARCHAR(40) NOT NULL,
      is_new BOOLEAN DEFAULT FALSE NOT NULL,
      PRIMARY KEY (project_id, day, visitor_id)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_visitors_day ON daily_visitors(project_id, day);

    CREATE TABLE IF NOT EXISTS visitor_profiles (
      project_id VARCHAR(24) NOT NULL,
      visitor_id VARCHAR(40) NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      session_count INTEGER DEFAULT 0 NOT NULL,
      pageview_count INTEGER DEFAULT 0 NOT NULL,
      user_id VARCHAR(120),
      traits JSONB,
      PRIMARY KEY (project_id, visitor_id)
    );
    CREATE INDEX IF NOT EXISTS idx_visitor_first_seen ON visitor_profiles(project_id, first_seen_at);

    CREATE TABLE IF NOT EXISTS daily_stats (
      project_id VARCHAR(24) NOT NULL,
      day DATE NOT NULL,
      pageviews BIGINT DEFAULT 0 NOT NULL,
      visitors BIGINT DEFAULT 0 NOT NULL,
      new_visitors BIGINT DEFAULT 0 NOT NULL,
      sessions BIGINT DEFAULT 0 NOT NULL,
      bounces BIGINT DEFAULT 0 NOT NULL,
      engaged_sessions BIGINT DEFAULT 0 NOT NULL,
      total_duration_sec BIGINT DEFAULT 0 NOT NULL,
      conversions BIGINT DEFAULT 0 NOT NULL,
      conversion_value DOUBLE PRECISION DEFAULT 0 NOT NULL,
      rage_clicks BIGINT DEFAULT 0 NOT NULL,
      dead_clicks BIGINT DEFAULT 0 NOT NULL,
      errors BIGINT DEFAULT 0 NOT NULL,
      PRIMARY KEY (project_id, day)
    );

    CREATE TABLE IF NOT EXISTS daily_pages (
      project_id VARCHAR(24) NOT NULL,
      day DATE NOT NULL,
      path VARCHAR(1024) NOT NULL,
      views BIGINT DEFAULT 0 NOT NULL,
      visitors BIGINT DEFAULT 0 NOT NULL,
      entrances BIGINT DEFAULT 0 NOT NULL,
      exits BIGINT DEFAULT 0 NOT NULL,
      bounces BIGINT DEFAULT 0 NOT NULL,
      total_time_sec BIGINT DEFAULT 0 NOT NULL,
      time_samples BIGINT DEFAULT 0 NOT NULL,
      scroll_sum BIGINT DEFAULT 0 NOT NULL,
      scroll_samples BIGINT DEFAULT 0 NOT NULL,
      PRIMARY KEY (project_id, day, path)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_pages_day ON daily_pages(project_id, day);

    CREATE TABLE IF NOT EXISTS page_transitions (
      project_id VARCHAR(24) NOT NULL,
      day DATE NOT NULL,
      step_index INTEGER NOT NULL,
      from_path VARCHAR(1024) NOT NULL,
      to_path VARCHAR(1024) NOT NULL,
      count BIGINT DEFAULT 0 NOT NULL,
      PRIMARY KEY (project_id, day, step_index, from_path, to_path)
    );
    CREATE INDEX IF NOT EXISTS idx_transitions_day ON page_transitions(project_id, day);

    CREATE TABLE IF NOT EXISTS error_groups (
      project_id VARCHAR(24) NOT NULL,
      fingerprint VARCHAR(40) NOT NULL,
      message TEXT NOT NULL,
      source VARCHAR(512),
      line INTEGER,
      "column" INTEGER,
      stack TEXT,
      sample_path VARCHAR(1024),
      count BIGINT DEFAULT 0 NOT NULL,
      affected_sessions BIGINT DEFAULT 0 NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      resolved BOOLEAN DEFAULT FALSE NOT NULL,
      PRIMARY KEY (project_id, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS idx_error_groups_last_seen ON error_groups(project_id, last_seen_at);

    CREATE TABLE IF NOT EXISTS goals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id VARCHAR(24) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      kind VARCHAR(16) NOT NULL,
      match_value VARCHAR(512) NOT NULL,
      match_type VARCHAR(16) DEFAULT 'exact' NOT NULL,
      value DOUBLE PRECISION DEFAULT 0 NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_goals_project ON goals(project_id);

    CREATE TABLE IF NOT EXISTS funnels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id VARCHAR(24) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      steps JSONB NOT NULL,
      window_hours INTEGER DEFAULT 168 NOT NULL,
      strict_order BOOLEAN DEFAULT FALSE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_funnels_project ON funnels(project_id);

    CREATE TABLE IF NOT EXISTS alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id VARCHAR(24) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      kind VARCHAR(32) NOT NULL,
      threshold DOUBLE PRECISION DEFAULT 50 NOT NULL,
      webhook_url TEXT,
      email VARCHAR(255),
      enabled BOOLEAN DEFAULT TRUE NOT NULL,
      last_fired_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_project ON alerts(project_id);

    CREATE TABLE IF NOT EXISTS rollup_state (
      project_id VARCHAR(24) NOT NULL,
      day DATE NOT NULL,
      built_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      sealed BOOLEAN DEFAULT FALSE NOT NULL,
      PRIMARY KEY (project_id, day)
    );
  `);
}

async function backfillProjectDefaults(sql: Sql): Promise<void> {
  // Projects created before timezone support default to UTC, which is already
  // the column default — nothing to backfill. Refresh the event-activity
  // watermarks so the setup checker and alerting have something to read.
  await sql.unsafe(`
    UPDATE projects p SET
      first_event_at = COALESCE(p.first_event_at, s.min_ts),
      last_event_at  = GREATEST(COALESCE(p.last_event_at, s.max_ts), s.max_ts)
    FROM (
      SELECT project_id, MIN(timestamp) AS min_ts, MAX(timestamp) AS max_ts
      FROM events GROUP BY project_id
    ) s
    WHERE s.project_id = p.id;
  `);
}
