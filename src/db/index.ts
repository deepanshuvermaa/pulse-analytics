import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { env } from '../config.js';
import { runMigrations } from './migrate.js';

/**
 * `timestamptz` everywhere means the driver must agree with us on UTC, otherwise
 * the server's local zone leaks into stored values.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 15,
  types: {
    // Return DATE columns as plain YYYY-MM-DD strings, never Date objects —
    // a Date would be re-interpreted in the server's zone and shift the day.
    date: {
      to: 1082,
      from: [1082],
      serialize: (v: string) => v,
      parse: (v: string) => v,
    },
  },
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
