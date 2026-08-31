import {
  pgTable, text, timestamp, uuid, varchar, jsonb, index, uniqueIndex,
  integer, bigint, boolean, date, doublePrecision, primaryKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ═══════════════════════════════════════════════════════════
// ACCOUNTS
// ═══════════════════════════════════════════════════════════

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: varchar('name', { length: 100 }),
  role: varchar('role', { length: 20 }).default('user').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('idx_refresh_user').on(t.userId),
  expiryIdx: index('idx_refresh_expiry').on(t.expiresAt),
}));

// ═══════════════════════════════════════════════════════════
// PROJECTS
// ═══════════════════════════════════════════════════════════

export const projects = pgTable('projects', {
  id: varchar('id', { length: 24 }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  domain: varchar('domain', { length: 255 }).notNull(),

  /** IANA zone. Every calendar boundary in every report is computed in this zone. */
  timezone: varchar('timezone', { length: 64 }).default('UTC').notNull(),

  /** 'cookieless' (daily rotating salt, no consent needed) | 'persistent' (localStorage id). */
  identityMode: varchar('identity_mode', { length: 16 }).default('cookieless').notNull(),

  /** Secret for server-side event ingestion. Never exposed to the browser. */
  writeKey: varchar('write_key', { length: 64 }).notNull(),

  /** Rotating this revokes old snippets without touching historical data. */
  publicKeyVersion: integer('public_key_version').default(1).notNull(),

  /** Slug for a shareable read-only dashboard. Null = not shared. */
  shareSlug: varchar('share_slug', { length: 32 }),
  sharePasswordHash: text('share_password_hash'),

  /** 0 = keep forever. Otherwise events older than this many days are dropped. */
  retentionDays: integer('retention_days').default(0).notNull(),

  /** Paths (glob) and IPs excluded from collection — staging, office traffic, health checks. */
  excludedPaths: jsonb('excluded_paths').$type<string[]>().default([]).notNull(),
  excludedIps: jsonb('excluded_ips').$type<string[]>().default([]).notNull(),

  clarityId: varchar('clarity_id', { length: 32 }),

  isActive: boolean('is_active').default(true).notNull(),
  firstEventAt: timestamp('first_event_at', { withTimezone: true }),
  lastEventAt: timestamp('last_event_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('idx_projects_user').on(t.userId),
  shareIdx: uniqueIndex('idx_projects_share').on(t.shareSlug),
  writeKeyIdx: uniqueIndex('idx_projects_write_key').on(t.writeKey),
}));

/** Team access. The owner is implicit via projects.user_id; this grants everyone else. */
export const projectMembers = pgTable('project_members', {
  projectId: varchar('project_id', { length: 24 }).notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 'admin' (settings + members) | 'member' (read + edit goals/funnels) | 'viewer' (read only). */
  role: varchar('role', { length: 16 }).default('viewer').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.projectId, t.userId] }),
  userIdx: index('idx_members_user').on(t.userId),
}));

// ═══════════════════════════════════════════════════════════
// RAW EVENTS  (partitioned by month — see db/migrate.ts)
// ═══════════════════════════════════════════════════════════

export const events = pgTable('events', {
  id: uuid('id').defaultRandom().notNull(),
  projectId: varchar('project_id', { length: 24 }).notNull(),

  /** pageview | custom | click | rage_click | dead_click | js_error | performance
   *  | form_start | form_submit | form_abandon | quick_back | scroll | session_end */
  type: varchar('type', { length: 30 }).notNull(),
  /** Custom event name, for type = 'custom'. */
  name: varchar('name', { length: 120 }),

  path: varchar('path', { length: 1024 }),
  referrerHost: varchar('referrer_host', { length: 255 }),
  source: varchar('source', { length: 120 }),
  channel: varchar('channel', { length: 32 }),

  visitorId: varchar('visitor_id', { length: 40 }).notNull(),
  sessionId: varchar('session_id', { length: 40 }).notNull(),
  userId: varchar('user_id', { length: 120 }),

  country: varchar('country', { length: 2 }),
  region: varchar('region', { length: 8 }),
  city: varchar('city', { length: 80 }),
  device: varchar('device', { length: 12 }),
  browser: varchar('browser', { length: 40 }),
  os: varchar('os', { length: 40 }),

  utmSource: varchar('utm_source', { length: 120 }),
  utmMedium: varchar('utm_medium', { length: 120 }),
  utmCampaign: varchar('utm_campaign', { length: 120 }),
  utmTerm: varchar('utm_term', { length: 120 }),
  utmContent: varchar('utm_content', { length: 120 }),

  payload: jsonb('payload'),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.id, t.timestamp] }),
  projectTsIdx: index('idx_events_project_ts').on(t.projectId, t.timestamp),
  projectTypeIdx: index('idx_events_project_type_ts').on(t.projectId, t.type, t.timestamp),
  sessionIdx: index('idx_events_session').on(t.projectId, t.sessionId, t.timestamp),
  visitorIdx: index('idx_events_visitor').on(t.projectId, t.visitorId, t.timestamp),
}));

// ═══════════════════════════════════════════════════════════
// SESSIONS  (materialised by workers/rollup.ts)
//
// This is the table every behavioural metric reads: bounce rate, session
// duration, entry/exit pages, frustration flags, conversions.
// ═══════════════════════════════════════════════════════════

export const sessions = pgTable('sessions', {
  projectId: varchar('project_id', { length: 24 }).notNull(),
  sessionId: varchar('session_id', { length: 40 }).notNull(),
  visitorId: varchar('visitor_id', { length: 40 }).notNull(),
  userId: varchar('user_id', { length: 120 }),

  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
  durationSec: integer('duration_sec').default(0).notNull(),

  pageviewCount: integer('pageview_count').default(0).notNull(),
  eventCount: integer('event_count').default(0).notNull(),

  entryPath: varchar('entry_path', { length: 1024 }),
  exitPath: varchar('exit_path', { length: 1024 }),

  /** One pageview, no engagement event, under 10s. */
  isBounce: boolean('is_bounce').default(false).notNull(),
  /** >10s or >1 pageview or any interaction — GA4-style engaged session. */
  isEngaged: boolean('is_engaged').default(false).notNull(),
  /** First session ever seen for this visitor id. */
  isNewVisitor: boolean('is_new_visitor').default(false).notNull(),

  referrerHost: varchar('referrer_host', { length: 255 }),
  source: varchar('source', { length: 120 }),
  channel: varchar('channel', { length: 32 }),
  utmSource: varchar('utm_source', { length: 120 }),
  utmMedium: varchar('utm_medium', { length: 120 }),
  utmCampaign: varchar('utm_campaign', { length: 120 }),

  country: varchar('country', { length: 2 }),
  device: varchar('device', { length: 12 }),
  browser: varchar('browser', { length: 40 }),
  os: varchar('os', { length: 40 }),

  maxScrollDepth: integer('max_scroll_depth').default(0).notNull(),

  // Frustration signals — the raw material for exit-reason attribution.
  rageClicks: integer('rage_clicks').default(0).notNull(),
  deadClicks: integer('dead_clicks').default(0).notNull(),
  errorCount: integer('error_count').default(0).notNull(),
  quickBacks: integer('quick_backs').default(0).notNull(),
  formAbandons: integer('form_abandons').default(0).notNull(),
  /** Worst LCP seen in the session, ms. */
  worstLcpMs: integer('worst_lcp_ms'),
  wasSlow: boolean('was_slow').default(false).notNull(),

  converted: boolean('converted').default(false).notNull(),
  conversionValue: doublePrecision('conversion_value').default(0).notNull(),
  goalsHit: jsonb('goals_hit').$type<string[]>().default([]).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.projectId, t.sessionId] }),
  startedIdx: index('idx_sessions_project_started').on(t.projectId, t.startedAt),
  entryIdx: index('idx_sessions_entry').on(t.projectId, t.entryPath, t.startedAt),
  exitIdx: index('idx_sessions_exit').on(t.projectId, t.exitPath, t.startedAt),
  visitorIdx: index('idx_sessions_visitor').on(t.projectId, t.visitorId, t.startedAt),
}));

/**
 * One row per visitor per day. Makes `COUNT(DISTINCT visitor)` over an arbitrary
 * range a scan of a small, dense table instead of the full event firehose.
 */
export const dailyVisitors = pgTable('daily_visitors', {
  projectId: varchar('project_id', { length: 24 }).notNull(),
  day: date('day').notNull(),
  visitorId: varchar('visitor_id', { length: 40 }).notNull(),
  isNew: boolean('is_new').default(false).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.projectId, t.day, t.visitorId] }),
  dayIdx: index('idx_daily_visitors_day').on(t.projectId, t.day),
}));

/** First time each visitor was ever seen — drives new-vs-returning and cohorts. */
export const visitorProfiles = pgTable('visitor_profiles', {
  projectId: varchar('project_id', { length: 24 }).notNull(),
  visitorId: varchar('visitor_id', { length: 40 }).notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  sessionCount: integer('session_count').default(0).notNull(),
  pageviewCount: integer('pageview_count').default(0).notNull(),
  userId: varchar('user_id', { length: 120 }),
  traits: jsonb('traits'),
}, (t) => ({
  pk: primaryKey({ columns: [t.projectId, t.visitorId] }),
  firstSeenIdx: index('idx_visitor_first_seen').on(t.projectId, t.firstSeenAt),
}));

// ═══════════════════════════════════════════════════════════
// DAILY ROLLUPS
// ═══════════════════════════════════════════════════════════

export const dailyStats = pgTable('daily_stats', {
  projectId: varchar('project_id', { length: 24 }).notNull(),
  day: date('day').notNull(),
  pageviews: bigint('pageviews', { mode: 'number' }).default(0).notNull(),
  visitors: bigint('visitors', { mode: 'number' }).default(0).notNull(),
  newVisitors: bigint('new_visitors', { mode: 'number' }).default(0).notNull(),
  sessions: bigint('sessions', { mode: 'number' }).default(0).notNull(),
  bounces: bigint('bounces', { mode: 'number' }).default(0).notNull(),
  engagedSessions: bigint('engaged_sessions', { mode: 'number' }).default(0).notNull(),
  totalDurationSec: bigint('total_duration_sec', { mode: 'number' }).default(0).notNull(),
  conversions: bigint('conversions', { mode: 'number' }).default(0).notNull(),
  conversionValue: doublePrecision('conversion_value').default(0).notNull(),
  rageClicks: bigint('rage_clicks', { mode: 'number' }).default(0).notNull(),
  deadClicks: bigint('dead_clicks', { mode: 'number' }).default(0).notNull(),
  errors: bigint('errors', { mode: 'number' }).default(0).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.projectId, t.day] }),
}));

export const dailyPages = pgTable('daily_pages', {
  projectId: varchar('project_id', { length: 24 }).notNull(),
  day: date('day').notNull(),
  path: varchar('path', { length: 1024 }).notNull(),
  views: bigint('views', { mode: 'number' }).default(0).notNull(),
  visitors: bigint('visitors', { mode: 'number' }).default(0).notNull(),
  entrances: bigint('entrances', { mode: 'number' }).default(0).notNull(),
  exits: bigint('exits', { mode: 'number' }).default(0).notNull(),
  bounces: bigint('bounces', { mode: 'number' }).default(0).notNull(),
  totalTimeSec: bigint('total_time_sec', { mode: 'number' }).default(0).notNull(),
  timeSamples: bigint('time_samples', { mode: 'number' }).default(0).notNull(),
  scrollSum: bigint('scroll_sum', { mode: 'number' }).default(0).notNull(),
  scrollSamples: bigint('scroll_samples', { mode: 'number' }).default(0).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.projectId, t.day, t.path] }),
  dayIdx: index('idx_daily_pages_day').on(t.projectId, t.day),
}));

/** Edges of the user-flow graph. `to_path = '(exit)'` marks leaving the site. */
export const pageTransitions = pgTable('page_transitions', {
  projectId: varchar('project_id', { length: 24 }).notNull(),
  day: date('day').notNull(),
  stepIndex: integer('step_index').notNull(),
  fromPath: varchar('from_path', { length: 1024 }).notNull(),
  toPath: varchar('to_path', { length: 1024 }).notNull(),
  count: bigint('count', { mode: 'number' }).default(0).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.projectId, t.day, t.stepIndex, t.fromPath, t.toPath] }),
  dayIdx: index('idx_transitions_day').on(t.projectId, t.day),
}));

/** Grouped JS errors, so the UI shows "TypeError × 412" instead of 412 rows. */
export const errorGroups = pgTable('error_groups', {
  projectId: varchar('project_id', { length: 24 }).notNull(),
  fingerprint: varchar('fingerprint', { length: 40 }).notNull(),
  message: text('message').notNull(),
  source: varchar('source', { length: 512 }),
  line: integer('line'),
  column: integer('column'),
  stack: text('stack'),
  samplePath: varchar('sample_path', { length: 1024 }),
  count: bigint('count', { mode: 'number' }).default(0).notNull(),
  affectedSessions: bigint('affected_sessions', { mode: 'number' }).default(0).notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  resolved: boolean('resolved').default(false).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.projectId, t.fingerprint] }),
  lastSeenIdx: index('idx_error_groups_last_seen').on(t.projectId, t.lastSeenAt),
}));

// ═══════════════════════════════════════════════════════════
// GOALS, FUNNELS, ALERTS
// ═══════════════════════════════════════════════════════════

export const goals = pgTable('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: varchar('project_id', { length: 24 }).notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  /** 'pageview' matches path, 'event' matches a custom event name. */
  kind: varchar('kind', { length: 16 }).notNull(),
  /** Exact path, glob with `*`, or custom event name. */
  matchValue: varchar('match_value', { length: 512 }).notNull(),
  /** 'exact' | 'contains' | 'starts_with' | 'regex' — pageview goals only. */
  matchType: varchar('match_type', { length: 16 }).default('exact').notNull(),
  /** Optional fixed monetary value per conversion. */
  value: doublePrecision('value').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  projectIdx: index('idx_goals_project').on(t.projectId),
}));

export const funnels = pgTable('funnels', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: varchar('project_id', { length: 24 }).notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  /** Ordered steps: { kind: 'pageview'|'event', value, matchType, label }. */
  steps: jsonb('steps').$type<FunnelStep[]>().notNull(),
  /** Hours a visitor has to complete the whole funnel. */
  windowHours: integer('window_hours').default(168).notNull(),
  /** true = steps must occur in order with nothing required between. */
  strictOrder: boolean('strict_order').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  projectIdx: index('idx_funnels_project').on(t.projectId),
}));

export interface FunnelStep {
  kind: 'pageview' | 'event';
  value: string;
  matchType?: 'exact' | 'contains' | 'starts_with' | 'regex';
  label?: string;
}

export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: varchar('project_id', { length: 24 }).notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  /** 'traffic_spike' | 'traffic_drop' | 'error_spike' | 'conversion_drop' | 'no_data'. */
  kind: varchar('kind', { length: 32 }).notNull(),
  /** Percent change (spike/drop) or absolute hours (no_data). */
  threshold: doublePrecision('threshold').default(50).notNull(),
  webhookUrl: text('webhook_url'),
  email: varchar('email', { length: 255 }),
  enabled: boolean('enabled').default(true).notNull(),
  lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  projectIdx: index('idx_alerts_project').on(t.projectId),
}));

/**
 * Read-only API keys, so a customer can point an AI agent (or any script) at
 * their own analytics without logging into the dashboard.
 *
 * Only a hash is stored — the plaintext key is shown once at creation and is
 * unrecoverable afterwards. `prefix` is the first few visible characters, kept
 * so the UI can identify a key in a list without holding the secret.
 */
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: varchar('project_id', { length: 24 }).notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  keyHash: varchar('key_hash', { length: 64 }).notNull(),
  prefix: varchar('prefix', { length: 16 }).notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  hashIdx: uniqueIndex('idx_api_keys_hash').on(t.keyHash),
  projectIdx: index('idx_api_keys_project').on(t.projectId),
}));

export const suggestions = pgTable('suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  message: text('message').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Bookkeeping so the rollup worker knows what it has already materialised. */
export const rollupState = pgTable('rollup_state', {
  projectId: varchar('project_id', { length: 24 }).notNull(),
  day: date('day').notNull(),
  builtAt: timestamp('built_at', { withTimezone: true }).defaultNow().notNull(),
  /** Closed days are never rebuilt; the open day is rebuilt on every pass. */
  sealed: boolean('sealed').default(false).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.projectId, t.day] }),
}));

// ═══════════════════════════════════════════════════════════
// RELATIONS
// ═══════════════════════════════════════════════════════════

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  memberships: many(projectMembers),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, { fields: [projects.userId], references: [users.id] }),
  members: many(projectMembers),
  goals: many(goals),
  funnels: many(funnels),
  alerts: many(alerts),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, { fields: [projectMembers.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectMembers.userId], references: [users.id] }),
}));
