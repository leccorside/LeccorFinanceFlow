import { readFile } from 'node:fs/promises';
import { brl, expect, test, today } from './support';

/**
 * A person's whole life cycle in the app, through the real browser, nginx, API and database:
 * chat, data, dashboard, report, profile, export, deletion of financial data, account deletion.
 * The financial records are arranged through the API (the app has no forms for them: they
 * are created by talking to the assistant, which needs an AI provider this stack does not have).
 */
test.describe('user journey', () => {
  test('without an AI provider, the chat answers safely instead of failing', async ({
    page,
    person,
  }) => {
    await page.goto('/');
    await expect(
      page.getByText(person.firstName, { exact: false }).first(),
    ).toBeVisible();
    const input = page.getByLabel('Mensagem para o assistente');
    await input.fill('Quanto gastei este mês?');
    await input.press('Enter');
    await expect(
      page
        .getByText('O assistente ainda não está configurado.', { exact: false })
        .first(),
    ).toBeVisible();
    // The question stays in the conversation.
    await expect(page.getByText('Quanto gastei este mês?').first()).toBeVisible();
  });

  test('records show up in the dashboard and in a downloadable report', async ({
    page,
    api,
  }) => {
    const account = await api.post('accounts', {
      data: { type: 'CHECKING', name: 'Conta E2E' },
    });
    expect(account.status()).toBe(201);
    const { id: accountId } = (await account.json()) as { id: string };
    for (const data of [
      { type: 'INCOME', description: 'Salário', amount: '5000.00' },
      { type: 'EXPENSE', description: 'Mercado', amount: '1234.56' },
    ]) {
      const created = await api.post('transactions', {
        data: { ...data, occurredOn: today(), accountId, status: 'COMPLETED' },
      });
      expect(created.status()).toBe(201);
    }

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Painel financeiro' })).toBeVisible();
    const card = (label: string) =>
      page.locator('.stat-card, .kpi-card, [class*="card"]').filter({
        has: page.getByText(label, { exact: true }),
      });
    await expect(card('Receitas').first()).toContainText(brl('5.000,00'));
    await expect(card('Despesas').first()).toContainText(brl('1.234,56'));

    await page.goto('/reports');
    await page.getByRole('button', { name: 'Gerar relatório' }).click();
    const link = page.getByRole('link', { name: /^Baixar / }).first();
    await expect(link).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    const file = await readFile((await download.path())!);
    expect(file.subarray(0, 5).toString()).toBe('%PDF-');
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  });

  test('profile changes apply to the whole interface', async ({ page, person }) => {
    await page.goto('/profile');
    await expect(page.getByLabel('Nome', { exact: true })).toHaveValue(person.firstName);
    await expect(page.getByRole('heading', { name: 'Seu perfil' })).toBeVisible();
    await page.getByLabel('Nome', { exact: true }).fill('Beatriz');
    await page.getByLabel('Idioma').selectOption('en-US');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByText('Profile updated.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('First name', { exact: true })).toHaveValue('Beatriz');
  });

  test('export, delete financial data, then delete the account', async ({
    page,
    api,
  }) => {
    await api.post('transactions', {
      data: {
        type: 'EXPENSE',
        description: 'Farmácia',
        amount: '42.00',
        occurredOn: today(),
      },
    });

    await page.goto('/privacy');
    await expect(
      page.getByRole('heading', { name: 'Privacidade e dados' }),
    ).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Baixar arquivo JSON' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^leccor-meus-dados-\d{4}-\d{2}-\d{2}\.json$/,
    );
    const exported = JSON.parse(await readFile((await download.path())!, 'utf8')) as {
      transactions: { description: string }[];
    };
    expect(exported.transactions.map((t) => t.description)).toEqual(['Farmácia']);

    const item = (title: string) =>
      page.locator('.privacy-deletions li').filter({ hasText: title });
    await item('Apagar dados financeiros')
      .getByRole('button', { name: 'Apagar dados financeiros' })
      .click();
    const confirmation = page.getByRole('region', {
      name: 'Confirmar: Apagar dados financeiros',
    });
    await expect(confirmation).toContainText('Lançamentos');
    await confirmation.getByRole('button', { name: 'Confirmar' }).click();
    await expect(
      page.getByText('Dados financeiros e relatórios apagados.'),
    ).toBeVisible();
    expect((await (await api.get('transactions')).json()) as unknown).toMatchObject({
      items: [],
    });

    await item('Excluir minha conta')
      .getByRole('button', { name: 'Excluir minha conta' })
      .click();
    await page
      .getByRole('region', { name: 'Confirmar: Excluir minha conta' })
      .getByRole('button', { name: 'Confirmar' })
      .click();
    await expect(page).toHaveURL('/?accountDeleted=1');
    await expect(page.getByText('Sua conta e seus dados foram excluídos.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Entrar com Google' })).toBeVisible();
    expect((await api.get('auth/me')).status()).toBe(401);
  });
});
