import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests against a running stack (by default the production-like one of
 * docker-compose.prod.yml + e2e/docker-compose.e2e.yml). See RUNBOOK.md, "E2E".
 *
 *   E2E_BASE_URL       app URL                      (default http://localhost:18080)
 *   E2E_DATABASE_URL   PostgreSQL of that stack     (required: sessions are seeded there)
 *   E2E_BROWSER        'chrome' (installed Chrome, default) or 'chromium' (Playwright's)
 */
const browser = process.env.E2E_BROWSER ?? 'chrome';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  outputDir: '../test-results/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // The admin scenarios pause features for everyone: run files one at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '../test-results/e2e-report' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:18080',
    ...(browser === 'chromium' ? {} : { channel: browser }),
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
