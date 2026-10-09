import type { Page } from '@playwright/test';
import { populatedAdmin } from './pages';
import { apiAs, expect, test, today } from './support';

/**
 * Budgets for the production build on the local stack (no network throttling). They catch
 * regressions — a heavy dependency in the first bundle, a slow query — not absolute speed.
 */
const BUDGET = {
  /** Largest Contentful Paint of a cold load, ms. */
  lcp: 2500,
  /** JavaScript transferred on a cold load of the chat (compressed), KB. */
  firstLoadJsKb: 250,
  /** p95 of the main API reads, ms. */
  apiP95: 500,
};

async function coldLoad(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' });
  return page.evaluate(
    () =>
      new Promise<{ lcp: number; jsKb: number; domContentLoaded: number }>((resolve) => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lcp = entries[entries.length - 1]?.startTime ?? 0;
          const resources = performance.getEntriesByType(
            'resource',
          ) as PerformanceResourceTiming[];
          const js = resources
            .filter((r) => r.name.endsWith('.js'))
            .reduce((sum, r) => sum + r.transferSize, 0);
          const nav = performance.getEntriesByType(
            'navigation',
          )[0] as PerformanceNavigationTiming;
          resolve({
            lcp: Math.round(lcp),
            jsKb: Math.round(js / 1024),
            domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
          });
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      }),
  );
}

test.describe('performance budgets', () => {
  test.describe.configure({ timeout: 120_000 });

  test('cold loads stay within the LCP and JavaScript budgets', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext();
    await populatedAdmin(context, baseURL!);
    const results: Record<string, unknown> = {};
    for (const path of ['/', '/dashboard', '/reports', '/privacy']) {
      const page = await context.newPage(); // new page: no in-memory module cache
      const metrics = await coldLoad(page, path);
      results[path] = metrics;
      expect(metrics.lcp, `${path} LCP`).toBeLessThan(BUDGET.lcp);
      await page.close();
    }
    const chat = results['/'] as { jsKb: number };
    console.log(JSON.stringify(results));
    expect(chat.jsKb, 'JS of the first screen (KB, compressed)').toBeLessThan(
      BUDGET.firstLoadJsKb,
    );
    await context.close();
  });

  test('main API reads answer within the p95 budget', async ({ browser, baseURL }) => {
    const context = await browser.newContext();
    const person = await populatedAdmin(context, baseURL!);
    const api = await apiAs(person, baseURL!);
    const timings: Record<string, number> = {};
    for (const path of [
      'dashboard?period=month',
      'dashboard?period=year',
      'transactions?limit=50',
      `finance/summary?from=${today().slice(0, 4)}-01-01&to=${today().slice(0, 4)}-12-31`,
      'admin/overview',
    ]) {
      const samples: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        const started = performance.now();
        const response = await api.get(path);
        samples.push(performance.now() - started);
        expect(response.status(), path).toBe(200);
      }
      samples.sort((a, b) => a - b);
      timings[path] = Math.round(samples[Math.ceil(samples.length * 0.95) - 1]!);
    }
    console.log(JSON.stringify(timings));
    for (const [path, p95] of Object.entries(timings)) {
      expect(p95, `${path} p95 ms`).toBeLessThan(BUDGET.apiP95);
    }
    await api.dispose();
    await context.close();
  });
});
