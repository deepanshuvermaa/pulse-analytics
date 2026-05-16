import { pgTable, text, timestamp, uuid, varchar, jsonb, index, integer, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ═══════════════════════════════════════
// USERS
// ═══════════════════════════════════════
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: varchar('name', { length: 100 }),
  role: varchar('role', { length: 20 }).default('user').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════
// PROJECTS
// ═══════════════════════════════════════
export const projects = pgTable('projects', {
  id: varchar('id', { length: 20 }).primaryKey(), // nanoid
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  domain: varchar('domain', { length: 255 }).notNull(),
  clarityId: varchar('clarity_id', { length: 20 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  isActive: boolean('is_active').default(true).notNull(),
});

// ═══════════════════════════════════════
// EVENTS (core analytics data)
// ═══════════════════════════════════════
export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: varchar('project_id', { length: 20 }).notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 30 }).notNull(), // pageview, click, scroll, session_end
  path: varchar('path', { length: 2048 }),
  referrer: varchar('referrer', { length: 2048 }),
  visitorId: varchar('visitor_id', { length: 64 }).notNull(),
  sessionId: varchar('session_id', { length: 64 }).notNull(),
  country: varchar('country', { length: 2 }),
  device: varchar('device', { length: 20 }), // desktop, mobile, tablet
  browser: varchar('browser', { length: 50 }),
  os: varchar('os', { length: 50 }),
  payload: jsonb('payload'), // extra data (scroll_depth, click_target, duration, utm params)
  timestamp: timestamp('timestamp').defaultNow().notNull(),
}, (t) => ({
  projectTimestampIdx: index('idx_events_project_ts').on(t.projectId, t.timestamp),
  projectTypeIdx: index('idx_events_project_type').on(t.projectId, t.type, t.timestamp),
  visitorIdx: index('idx_events_visitor').on(t.projectId, t.visitorId),
}));

// ═══════════════════════════════════════
// REFRESH TOKENS
// ═══════════════════════════════════════
export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════
// RELATIONS
// ═══════════════════════════════════════
export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  events: many(events),
}));
