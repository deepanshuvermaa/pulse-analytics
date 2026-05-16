import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { users, refreshTokens } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { hashPassword, verifyPassword, createAccessToken, createRefreshToken, verifyRefreshToken } from '../lib/auth.js';

const auth = new Hono();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// Register
auth.post('/register', async (c) => {
  const body = registerSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);

  const { email, password, name } = body.data;

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) return c.json({ error: 'Email already registered' }, 409);

  const [user] = await db.insert(users).values({
    email,
    passwordHash: await hashPassword(password),
    name,
  }).returning({ id: users.id, email: users.email, name: users.name });

  const accessToken = await createAccessToken(user.id);
  const refreshToken = await createRefreshToken(user.id);

  await db.insert(refreshTokens).values({
    userId: user.id,
    token: refreshToken,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return c.json({ user, accessToken, refreshToken }, 201);
});

// Login
auth.post('/login', async (c) => {
  const body = loginSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);

  const { email, password } = body.data;

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const accessToken = await createAccessToken(user.id);
  const refreshToken = await createRefreshToken(user.id);

  await db.insert(refreshTokens).values({
    userId: user.id,
    token: refreshToken,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return c.json({
    user: { id: user.id, email: user.email, name: user.name },
    accessToken,
    refreshToken,
  });
});

// Refresh token
auth.post('/refresh', async (c) => {
  const { refreshToken: token } = await c.req.json();
  if (!token) return c.json({ error: 'Refresh token required' }, 400);

  try {
    const userId = await verifyRefreshToken(token);
    const stored = await db.query.refreshTokens.findFirst({ where: eq(refreshTokens.token, token) });
    if (!stored) return c.json({ error: 'Token revoked' }, 401);

    // Rotate: delete old, issue new
    await db.delete(refreshTokens).where(eq(refreshTokens.token, token));

    const accessToken = await createAccessToken(userId);
    const newRefreshToken = await createRefreshToken(userId);

    await db.insert(refreshTokens).values({
      userId,
      token: newRefreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return c.json({ accessToken, refreshToken: newRefreshToken });
  } catch {
    return c.json({ error: 'Invalid refresh token' }, 401);
  }
});

// Logout
auth.post('/logout', async (c) => {
  const { refreshToken: token } = await c.req.json();
  if (token) await db.delete(refreshTokens).where(eq(refreshTokens.token, token));
  return c.json({ success: true });
});

export default auth;
