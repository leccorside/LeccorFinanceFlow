import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    // The first cold import of the generated Prisma Client can take over a minute on
    // slow disks (observed on a USB drive); warm runs take < 1s.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
