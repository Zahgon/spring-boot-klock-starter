import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Every test shares one Redis instance and one lock namespace, so the suite is
    // order-sensitive and must run serially — the Java suite has the same constraint.
    fileParallelism: false,
    sequence: { concurrent: false },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // Several tests deliberately hold locks for a minute (ported 1:1 from the Java suite).
    testTimeout: 240_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
