import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../lib/types.js';

const suggestions = new Hono<AppEnv>();

// Submit suggestion (authenticated)
suggestions.post('/', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const body = z.object({ message: z.string().min(1).max(2000) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: 'Message required' }, 400);

  await db.execute(sql`INSERT INTO suggestions (user_id, message) VALUES (${userId}, ${body.data.message})`);
  return c.json({ success: true }, 201);
});

// Get all suggestions (admin only — checked in admin route)
suggestions.get('/', authMiddleware, async (c) => {
  const rows = await db.execute(sql`
    SELECT s.id, s.message, s.created_at, u.email, u.name
    FROM suggestions s LEFT JOIN users u ON s.user_id = u.id
    ORDER BY s.created_at DESC
  `);
  return c.json({ suggestions: rows });
});

export default suggestions;
