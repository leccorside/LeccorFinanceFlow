import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { populatedAdmin, SIGNED_IN_PAGES, VISITOR_PAGES } from './pages';
import { expect, test } from './support';

/**
 * Waits for entry animations (fades) to end: contrast measured mid-fade is not what the
 * person reads. Finite animations must be done, plus a margin longer than the longest
 * transition of the app (0.45 s); infinite ones (the orb) are decorative.
 */
async function settled(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity,
      ),
  );
  await page.waitForTimeout(600);
}

/** WCAG 2.1 A and AA rules. Serious and critical violations fail; the rest is reported. */
async function audit(page: Page, path: string) {
  await settled(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const summary = violations.map(
    (v) =>
      `${path} [${v.impact}] ${v.id}: ${v.help} → ${v.nodes
        .slice(0, 3)
        .map(
          (n) =>
            `${n.target.join(' ')} (${(n.failureSummary ?? '').replace(/\s+/g, ' ')})`,
        )
        .join(' | ')}`,
  );
  if (summary.length > 0) console.log(summary.join('\n'));
  return blocking;
}

test.describe('accessibility (axe, WCAG 2.1 AA)', () => {
  // Twelve screens analysed per theme.
  test.describe.configure({ timeout: 240_000 });

  for (const theme of ['light', 'dark'] as const) {
    test(`every screen, ${theme} theme`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const failures: string[] = [];

      for (const screen of VISITOR_PAGES) {
        await page.goto(screen.path);
        await expect(
          page.getByRole('heading', { name: screen.ready.heading }),
        ).toBeVisible();
        failures.push(
          ...(await audit(page, `${theme} ${screen.path}`)).map(
            (v) => `${screen.path} ${v.id}`,
          ),
        );
      }

      await populatedAdmin(context, baseURL!);
      for (const screen of SIGNED_IN_PAGES) {
        await page.goto(screen.path);
        if ('heading' in screen.ready) {
          await expect(
            page.getByRole('heading', { name: screen.ready.heading, exact: true }),
          ).toBeVisible();
        } else {
          await expect(page.getByLabel(screen.ready.label)).toBeVisible();
        }
        await page.waitForTimeout(300);
        failures.push(
          ...(await audit(page, `${theme} ${screen.path}`)).map(
            (v) => `${screen.path} ${v.id}`,
          ),
        );
      }
      // The confirmation dialog of a destructive action.
      await page.goto('/privacy');
      await page
        .locator('.privacy-deletions li')
        .filter({ hasText: 'Apagar conversas' })
        .getByRole('button')
        .click();
      await expect(page.getByRole('region', { name: /Confirmar/ })).toBeVisible();
      failures.push(
        ...(await audit(page, `${theme} confirmation`)).map(
          (v) => `confirmation ${v.id}`,
        ),
      );

      expect(failures, 'serious/critical axe violations').toEqual([]);
      await context.close();
    });
  }

  test('the main journey works with the keyboard alone', async ({ browser, baseURL }) => {
    const context = await browser.newContext();
    await populatedAdmin(context, baseURL!);
    const page = await context.newPage();
    await page.goto('/privacy');
    await expect(
      page.getByRole('heading', { name: 'Privacidade e dados' }),
    ).toBeVisible();

    // Tab until the "Apagar conversas" button has focus, then use it with Enter.
    let found = false;
    for (let i = 0; i < 40 && !found; i += 1) {
      await page.keyboard.press('Tab');
      found = await page.evaluate(
        () =>
          document.activeElement?.textContent?.trim() === 'Apagar conversas' &&
          document.activeElement.tagName === 'BUTTON',
      );
    }
    expect(found, 'deletion button reachable by Tab').toBe(true);
    await page.keyboard.press('Enter');
    const card = page.getByRole('region', { name: 'Confirmar: Apagar conversas' });
    await expect(card).toBeVisible();

    // The confirmation buttons are reachable and Cancel works with the keyboard.
    const cancel = card.getByRole('button', { name: 'Cancelar' });
    for (let i = 0; i < 20; i += 1) {
      if (await cancel.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Exclusão cancelada. Nada foi apagado.')).toBeVisible();

    // Focus is always visible (outline or box-shadow on the focused control).
    await page.keyboard.press('Shift+Tab');
    const indicator = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = getComputedStyle(el);
      return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
    });
    expect(indicator).toBe(true);
    await context.close();
  });
});
