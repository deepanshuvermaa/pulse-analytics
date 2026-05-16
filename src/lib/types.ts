import { Hono } from 'hono';

// Shared type for authenticated routes
export type AppEnv = { Variables: { userId: string } };
export const createAuthRouter = () => new Hono<AppEnv>();
