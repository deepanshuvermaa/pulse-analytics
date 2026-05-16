import { Context, Next } from 'hono';
import { verifyAccessToken } from '../lib/auth.js';
import type { AppEnv } from '../lib/types.js';

export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  try {
    const userId = await verifyAccessToken(header.slice(7));
    c.set('userId', userId);
    return next();
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
}
