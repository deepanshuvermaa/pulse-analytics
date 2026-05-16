import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { env } from '../config.js';

const client = postgres(env.DATABASE_URL, { max: 20 });
export const db = drizzle(client, { schema });

// Auto-create tables on startup
export async function initDB() {
  const migrationClient = postgres(env.DATABASE_URL, { max: 1 });
  await migrationClient.unsafe(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name VARCHAR(100),
      role VARCHAR(20) DEFAULT 'user' NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id VARCHAR(20) PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      domain VARCHAR(255) NOT NULL,
      clarity_id VARCHAR(20),
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id VARCHAR(20) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type VARCHAR(30) NOT NULL,
      path VARCHAR(2048),
      referrer VARCHAR(2048),
      visitor_id VARCHAR(64) NOT NULL,
      session_id VARCHAR(64) NOT NULL,
      country VARCHAR(2),
      device VARCHAR(20),
      browser VARCHAR(50),
      os VARCHAR(50),
      payload JSONB,
      timestamp TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_project_ts ON events(project_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_project_type ON events(project_id, type, timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(project_id, visitor_id);
    CREATE TABLE IF NOT EXISTS suggestions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      email VARCHAR(255),
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await migrationClient.end();
  console.log('✓ Database tables ready');
}
