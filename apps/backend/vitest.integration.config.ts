import { defineConfig } from 'vitest/config';

// Integration suite: needs a real PostgreSQL (TEST_DATABASE_URL). Each file creates
// and drops its own disposable database, so files may run in parallel.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/integration/**/*.int-spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
