import { productionHeaders } from '../apps/frontend/security-headers';
import { expect, test } from './support';

test.describe('visitor', () => {
  test('landing explains the product and starts the Google sign-in on the backend', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Converse com o seu dinheiro.' }),
    ).toBeVisible();
    await expect(page.getByText('API disponível')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Entrar com Google' })).toHaveAttribute(
      'href',
      /^\/api\/v1\/auth\/google\/login\?redirectTo=/,
    );
  });

  test('private pages send visitors to the login, keeping where they wanted to go', async ({
    page,
  }) => {
    for (const path of ['/dashboard', '/reports', '/profile', '/privacy', '/admin']) {
      await page.goto(path);
      await expect(page).toHaveURL(`/login?redirectTo=${encodeURIComponent(path)}`);
      await expect(
        page.getByRole('heading', { name: 'Entre para continuar' }),
      ).toBeVisible();
    }
  });

  test('the API refuses anonymous access without leaking internals', async ({
    request,
  }) => {
    for (const path of [
      '/api/v1/auth/me',
      '/api/v1/transactions',
      '/api/v1/admin/overview',
    ]) {
      const response = await request.get(path);
      expect(response.status()).toBe(401);
      expect(await response.json()).toMatchObject({ code: 'unauthenticated' });
    }
    // Google is not configured in this stack: an explicit 503, never a stack trace.
    const login = await request.get('/api/v1/auth/google/login', { maxRedirects: 0 });
    expect(login.status()).toBe(503);
    expect(await login.text()).not.toMatch(/at \w+ \(|node_modules/);
  });

  test('pages carry the production security headers; assets are cached immutably', async ({
    request,
  }) => {
    const page = await request.get('/dashboard');
    for (const [name, value] of Object.entries(productionHeaders)) {
      expect(page.headers()[name.toLowerCase()]).toBe(value);
    }
    expect(page.headers()['cache-control']).toBe('no-cache');
    const html = await page.text();
    const asset = /\/assets\/[^"]+\.js/.exec(html)?.[0];
    expect(asset).toBeTruthy();
    const script = await request.get(asset!);
    expect(script.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(script.headers()['content-security-policy']).toBe(
      productionHeaders['Content-Security-Policy'],
    );
    const api = await request.get('/api/v1/health');
    expect(api.headers()['content-security-policy']).toContain("default-src 'none'");
  });
});
