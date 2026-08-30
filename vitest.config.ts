import { defineConfig } from 'vitest/config';

/**
 * Separate from vite.config.ts, which roots itself at ./client for the dashboard
 * build. Tests cover the server-side logic under ./src.
 */
export default defineConfig({
  test: {
    root: '.',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
