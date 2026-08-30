import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { suggestions } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../lib/types.js';

/**
 * Users may submit feedback; only instance admins may read it.
 * The read endpoint lives on /api/admin/suggestions — this router is
 * deliberately write-only, because the previous GET here exposed every user's
 * email address to any signed-in account.
 */
const router = new Hono<AppEnv>();
router.use('*', authMiddleware);

router.post('/', async (c) => {
  const body = z.object({ message: z.string().min(1).max(2000) })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Message required' }, 400);

  await db.insert(suggestions).values({
    userId: c.get('userId'),
    message: body.data.message,
  });

  return c.json({ ok: true }, 201);
});

export default router;
