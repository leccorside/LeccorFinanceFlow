import type { Page } from '@playwright/test';
import { populatedAdmin, SIGNED_IN_PAGES, VISITOR_PAGES } from './pages';
import { expect, test } from './support';

/** Smallest phone, common phone, tablet portrait, laptop. */
const WIDTHS = [320, 375, 768, 1280];

async function ready(page: Page, target: { heading?: string; label?: string }) {
  if (target.heading) {
    await expect(
      page.getByRole('heading', { name: target.heading, exact: true }),
    ).toBeVisible();
  } else {
    await expect(page.getByLabel(target.label!)).toBeVisible();
  }
}

async function overflow(page: Page) {
  return page.evaluate(() => ({
    viewport: window.innerWidth,
    content: document.documentElement.scrollWidth,
    // Elements sticking out of the viewport (the usual culprits: long e-mails, tables).
    offenders: [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .filter((el) => !el.closest('.table-scroll, [data-scroll-x]'))
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`),
  }));
}

test.describe('responsive layout (no horizontal scrolling on any screen)', () => {
  for (const width of WIDTHS) {
    test(`signed-in screens at ${width}px`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await populatedAdmin(context, baseURL!);
      const page = await context.newPage();
      for (const screen of SIGNED_IN_PAGES) {
        await page.goto(screen.path);
        await ready(page, screen.ready);
        await page.waitForTimeout(300); // charts and animations settle
        const result = await overflow(page);
        expect(
          result.content,
          `${screen.path} at ${width}px: ${result.offenders.join(', ')}`,
        ).toBe(result.viewport);
      }
      await context.close();
    });

    test(`visitor screens at ${width}px`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      for (const screen of VISITOR_PAGES) {
        await page.goto(screen.path);
        await ready(page, screen.ready);
        const result = await overflow(page);
        expect(result.content, `${screen.path} at ${width}px`).toBe(result.viewport);
      }
      await context.close();
    });
  }

  test('the microphone is a large touch target on a phone', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
    await populatedAdmin(context, baseURL!);
    const page = await context.newPage();
    // Voice availability comes from the server; without providers the button explains why
    // it is off, but it is still rendered at full size.
    await page.goto('/');
    const send = page.getByRole('button', { name: /Enviar|Falar|microfone/i }).first();
    await expect(send).toBeVisible();
    const box = (await send.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    await context.close();
  });
});
