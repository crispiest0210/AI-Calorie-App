import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Postgres starts once per file; these are integration tests, not units.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
