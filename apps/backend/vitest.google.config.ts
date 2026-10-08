import { defineConfig } from 'vitest/config';

// Opt-in suite against the real Google APIs (see test/google-real). Never part of `pnpm test`.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/google-real/**/*.smoke-spec.ts'],
    testTimeout: 120_000,
  },
});
