import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reporter: ['text', 'json-summary'],
      // Phase 0 exit criterion: the engine is fully covered.
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
