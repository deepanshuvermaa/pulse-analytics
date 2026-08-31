import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { env } from '../config.js';
import { runMigrations } from './migrate.js';

/**
 * `timestamptz` everywhere means the driver must agree with us on UTC, otherwise
 * the server's local zone leaks into stored values (see `SET TIME ZONE` below).
 *
 * No custom DATE type is registered here. Overriding the serializer for OID 1082
 * also replaces the one the driver uses when Postgres describes a parameter as a
 * date, which made binding a JS Date to any date parameter throw
 * ERR_INVALID_ARG_TYPE deep inside the driver. Queries that need a calendar day
 * back as a string cast it explicitly with `::text` instead.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 15,
  onnotice: () => {},
});

export const db = drizzle(sql, { schema });

export async function initDB(): Promise<void> {
  await sql`SET TIME ZONE 'UTC'`;
  await runMigrations(sql);

  if (env.ADMIN_EMAIL) {
    await sql`UPDATE users SET role = 'admin' WHERE email = ${env.ADMIN_EMAIL}`;
  }

  console.log('✓ Database schema ready');
}

export async function closeDB(): Promise<void> {
  await sql.end({ timeout: 5 });
}
