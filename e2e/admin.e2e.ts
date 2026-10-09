import { apiAs, createPerson, expect, signIn, test } from './support';

test.describe('administration', () => {
  test('a regular user never gets in: the page says so and the API refuses', async ({
    page,
    api,
  }) => {
    await page.goto('/admin');
    await expect(page.getByRole('alert')).toHaveText(
      'Esta área é só para administradores.',
    );
    await expect(page.getByRole('link', { name: 'Administração' })).toHaveCount(0);
    expect((await api.get('admin/overview')).status()).toBe(403);
  });

  test('blocking a user ends their sessions at once and is recorded in the audit trail', async ({
    browser,
    baseURL,
  }) => {
    const admin = await createPerson({ admin: true, firstName: 'Rita' });
    const target = await createPerson({ firstName: 'Caio' });

    const adminContext = await browser.newContext();
    await signIn(adminContext, admin, baseURL!);
    const targetContext = await browser.newContext();
    await signIn(targetContext, target, baseURL!);
    const adminPage = await adminContext.newPage();
    const targetPage = await targetContext.newPage();

    await targetPage.goto('/profile');
    await expect(targetPage.getByLabel('Nome', { exact: true })).toHaveValue('Caio');

    await adminPage.goto('/admin/users');
    await adminPage.getByLabel('Buscar por nome ou e-mail').fill(target.email);
    await adminPage.getByRole('button', { name: 'Buscar' }).click();
    await adminPage.getByRole('button', { name: `Bloquear: ${target.email}` }).click();
    await adminPage
      .getByRole('group', { name: new RegExp(target.email.replace(/\./g, '\\.')) })
      .getByRole('button', { name: 'Confirmar' })
      .click();
    await expect(
      adminPage.getByRole('button', { name: `Desbloquear: ${target.email}` }),
    ).toBeVisible();

    // The blocked person is out on the next request.
    await targetPage.reload();
    await expect(targetPage).toHaveURL(/\/login\?redirectTo=%2Fprofile$/);

    await adminPage.goto('/admin');
    const audit = adminPage.locator('section').filter({
      has: adminPage.getByRole('heading', { name: 'Ações administrativas recentes' }),
    });
    await expect(audit.getByRole('listitem').first()).toContainText(
      `${target.email} → Bloqueado`,
    );
    await expect(audit.getByRole('listitem').first()).toContainText(admin.email);

    await adminContext.close();
    await targetContext.close();
  });

  test('pausing the assistant takes effect for everyone right away', async ({
    browser,
    baseURL,
    page,
    person,
  }) => {
    expect(person.id).toBeTruthy(); // `page` is signed in as this regular user
    const admin = await createPerson({ admin: true, firstName: 'Rita' });
    const adminApi = await apiAs(admin, baseURL!);
    const adminContext = await browser.newContext();
    await signIn(adminContext, admin, baseURL!);
    const adminPage = await adminContext.newPage();
    try {
      await adminPage.goto('/admin/settings');
      const toggle = adminPage.getByRole('checkbox', { name: /Assistente ativo/ });
      await expect(toggle).toBeChecked();
      await toggle.uncheck();
      await adminPage.getByRole('button', { name: 'Salvar' }).click();
      await expect(adminPage.getByText('Configurações salvas.')).toBeVisible();

      await page.goto('/');
      const input = page.getByLabel('Mensagem para o assistente');
      await input.fill('oi');
      await input.press('Enter');
      await expect(
        page.getByText('O assistente está em pausa pela administração.', {
          exact: false,
        }),
      ).toBeVisible();
    } finally {
      const restored = await adminApi.patch('admin/settings', {
        data: { 'assistant.enabled': true },
      });
      expect(restored.status()).toBe(200);
      await adminApi.dispose();
      await adminContext.close();
    }
  });
});
