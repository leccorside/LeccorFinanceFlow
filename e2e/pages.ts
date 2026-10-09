import type { BrowserContext } from '@playwright/test';
import { apiAs, createPerson, type Person, signIn, today } from './support';

/** Every screen of the app, with the heading that proves it rendered. */
export const SIGNED_IN_PAGES = [
  { path: '/', ready: { label: 'Mensagem para o assistente' } },
  { path: '/dashboard', ready: { heading: 'Painel financeiro' } },
  { path: '/reports', ready: { heading: 'Relatórios' } },
  { path: '/profile', ready: { heading: 'Seu perfil' } },
  { path: '/privacy', ready: { heading: 'Privacidade e dados' } },
  { path: '/admin', ready: { heading: 'Visão geral da plataforma' } },
  { path: '/admin/users', ready: { heading: 'Usuários e permissões' } },
  { path: '/admin/ai', ready: { heading: 'Provedores de IA' } },
  { path: '/admin/settings', ready: { heading: 'Configurações globais' } },
] as const;

export const VISITOR_PAGES = [
  { path: '/', ready: { heading: 'Converse com o seu dinheiro.' } },
  { path: '/login', ready: { heading: 'Entre para continuar' } },
] as const;

/** An admin with a few records, so every screen has real content (cards, charts, lists). */
export async function populatedAdmin(
  context: BrowserContext,
  baseURL: string,
): Promise<Person> {
  const person = await createPerson({ admin: true, firstName: 'Mariana' });
  await signIn(context, person, baseURL);
  const api = await apiAs(person, baseURL);
  const account = (await (
    await api.post('accounts', {
      data: { type: 'CHECKING', name: 'Conta corrente principal' },
    })
  ).json()) as { id: string };
  const day = today();
  for (const [type, description, amount] of [
    ['INCOME', 'Salário', '8500.00'],
    ['EXPENSE', 'Aluguel do apartamento', '2300.00'],
    ['EXPENSE', 'Supermercado', '845.37'],
    ['EXPENSE', 'Farmácia', '96.10'],
  ] as const) {
    await api.post('transactions', {
      data: { type, description, amount, occurredOn: day, accountId: account.id },
    });
  }
  await api.post('reports', {
    data: { type: 'MONTHLY', format: 'PDF', month: day.slice(0, 7) },
  });
  await api.dispose();
  return person;
}
