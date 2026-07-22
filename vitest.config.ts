import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // CI runs against a local Postgres service container (fast); local dev runs against
    // the remote dev DB, where sequential cleanup across several rows in afterAll hooks
    // can exceed Vitest's 10s default under real network latency.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
