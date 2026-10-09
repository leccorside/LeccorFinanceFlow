import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { ChatRequest, ToolCall } from '../../src/ai/ai.types.js';
import { seedDatabase } from '../../src/database/seed.js';
import {
  addDays,
  endOfMonth,
  formatCalendarDate,
  startOfMonth,
  todayIn,
} from '../../src/finance/dates.js';
import {
  createDisposableDatabase,
  type DisposableDatabase,
} from './disposable-database.js';
import { FakeAiClients } from './fake-ai.js';
import { createTestApp, FakeGoogle, loginAs, type Session, testEnv } from './support.js';

let db: DisposableDatabase;
let app: NestExpressApplication;
let google: FakeGoogle;
let ai: FakeAiClients;
let category: Record<string, string>;

type Json = Record<string, unknown>;
const f = formatCalendarDate;
const TZ = 'America/Sao_Paulo';

interface Block {
  currency: string;
  cards: Json & {
    incomes: string;
    expenses: string;
    investments: string;
    accountsBalance: string;
    invested: string;
    netWorth: string;
    savings: string;
    savingsRate: string | null;
    upcomingBills: { amount: string; count: number };
    overdueBills: { amount: string; count: number };
  };
  previous: Json;
  cashFlow: { period: string; incomes: string; expenses: string; investments: string }[];
  netWorth: { period: string; value: string }[];
  categories: Json[];
  investments: { invested: string; byClass: Json[] };
}
interface Dashboard {
  period: Json & { from: string; to: string; today: string; groupBy: string };
  primaryCurrency: string;
  currencies: Block[];
  bills: { upcoming: Json[]; overdue: Json[] };
  insights: (Json & { kind: string; values: Json })[];
}

let sequence = 0;
async function newUser(profile: Json = { timeZone: TZ }) {
  sequence += 1;
  const email = `dash${sequence}@example.com`;
  const session = await loginAs(app, google, { subject: `dash-${sequence}`, email });
  await call(session, 'patch', '/profile', profile).expect(200);
  return session;
}

function call(s: Session, method: 'get' | 'post' | 'patch', path: string, body?: object) {
  const server = request(app.getHttpServer());
  const req = server[method](`/api/v1${path}`).set('Cookie', s.cookie);
  if (method !== 'get') req.set('X-CSRF-Token', s.csrf);
  return body ? req.send(body) : req;
}
async function post(s: Session, path: string, body: object) {
  const response = await call(s, 'post', path, body);
  if (response.status !== 201) {
    throw new Error(`POST ${path} → ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body as Json & { id: string };
}
const get = async <T = Json>(s: Session, path: string) =>
  (await call(s, 'get', path).expect(200)).body as T;
const dashboard = (s: Session, query = '') => get<Dashboard>(s, `/dashboard${query}`);

const sum = (values: string[]) =>
  values.reduce((total, value) => total + Number(value), 0);

beforeAll(async () => {
  db = await createDisposableDatabase();
  await seedDatabase(db.client);
  testEnv(db.url, { OPENAI_API_KEY: 'sk-env-openai' });
  google = new FakeGoogle();
  ai = new FakeAiClients();
  app = await createTestApp(google, [], undefined, undefined, ai);
  const rows = await db.client.category.findMany({ where: { ownerId: null } });
  category = Object.fromEntries(rows.map((row) => [row.systemKey as string, row.id]));
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
  delete process.env.OPENAI_API_KEY;
});

/** A month of life: salary, food, transport, a transfer, an investment and bills. */
async function populated() {
  const user = await newUser();
  const today = todayIn(TZ);
  const monthStart = startOfMonth(today);
  const previousStart = startOfMonth(addDays(monthStart, -1));
  const checking = await post(user, '/accounts', {
    type: 'CHECKING',
    name: 'Corrente',
    initialBalance: '1000',
  });
  const savings = await post(user, '/accounts', {
    type: 'SAVINGS',
    name: 'Poupança',
    initialBalance: '500',
  });
  const expense = (body: Json) =>
    post(user, '/transactions', { type: 'EXPENSE', description: 'Gasto', ...body });
  await post(user, '/transactions', {
    type: 'INCOME',
    description: 'Salário',
    amount: '5000',
    occurredOn: f(monthStart),
    accountId: checking.id,
    categoryId: category.salary,
  });
  await expense({
    amount: '1000',
    occurredOn: f(monthStart),
    accountId: checking.id,
    categoryId: category.food,
  });
  await expense({
    amount: '250.50',
    occurredOn: f(monthStart),
    categoryId: category.transport,
  });
  await post(user, '/transactions', {
    type: 'TRANSFER',
    description: 'Reserva',
    amount: '200',
    occurredOn: f(monthStart),
    accountId: checking.id,
    transferAccountId: savings.id,
  });
  // Previous month: smaller food bill, smaller salary.
  await post(user, '/transactions', {
    type: 'INCOME',
    description: 'Salário',
    amount: '4000',
    occurredOn: f(previousStart),
    accountId: checking.id,
    categoryId: category.salary,
  });
  await expense({
    amount: '800',
    occurredOn: f(previousStart),
    accountId: checking.id,
    categoryId: category.food,
  });
  // Bills: one due in 3 days, one overdue since yesterday.
  await expense({
    description: 'Internet',
    amount: '120',
    occurredOn: f(addDays(today, 3)),
    dueOn: f(addDays(today, 3)),
  });
  await expense({
    description: 'Luz',
    amount: '90.25',
    occurredOn: f(addDays(today, -1)),
    dueOn: f(addDays(today, -1)),
  });
  // Investment: opening position + a contribution from the checking account.
  const fund = await post(user, '/investments', {
    assetClass: 'TREASURY',
    name: 'Tesouro',
    totalCost: '2000',
  });
  await call(user, 'post', `/investments/${fund.id}/contributions`, {
    amount: '500',
    accountId: checking.id,
  }).expect(201);
  // Another currency stays apart.
  const usd = await post(user, '/accounts', {
    type: 'CHECKING',
    name: 'USD',
    currency: 'USD',
    initialBalance: '100',
  });
  await expense({
    amount: '10',
    currency: 'USD',
    occurredOn: f(today),
    accountId: usd.id,
  });
  return { user, today, monthStart, previousStart };
}

describe('dashboard numbers', () => {
  it('match the summary, series, bills, accounts and investments routes', async () => {
    const { user, today, monthStart, previousStart } = await populated();
    const view = await dashboard(user); // default: this month
    const from = f(monthStart);
    const to = f(endOfMonth(today));

    expect(view.period).toMatchObject({
      key: 'month',
      from,
      to,
      previousFrom: f(previousStart),
      previousTo: f(addDays(monthStart, -1)),
      groupBy: 'day',
      today: f(today),
      timeZone: TZ,
      weekStartsOn: 'monday',
    });
    expect(view.primaryCurrency).toBe('BRL');
    expect(view.currencies.map((block) => block.currency)).toEqual(['BRL', 'USD']);
    const brl = view.currencies[0] as Block;

    // Same numbers as /finance/summary for the same range.
    const summary = await get<{ currencies: (Json & { currency: string })[] }>(
      user,
      `/finance/summary?from=${from}&to=${to}`,
    );
    const reference = summary.currencies.find(
      (item) => item.currency === 'BRL',
    ) as unknown as {
      incomes: { total: string; pending: string };
      expenses: { total: string; pending: string };
      investments: { total: string };
      expensesByCategory: Json[];
    };
    expect(brl.cards).toMatchObject({
      incomes: reference.incomes.total,
      expenses: reference.expenses.total,
      investments: reference.investments.total,
      pendingExpenses: reference.expenses.pending,
    });
    expect(brl.categories).toEqual(reference.expensesByCategory);

    // Accounts, investments and net worth as the dedicated routes say.
    const accounts = await get<{ currency: string; balance: string }[]>(
      user,
      '/accounts?includeArchived=true',
    );
    const brlBalance = sum(
      accounts.filter((item) => item.currency === 'BRL').map((item) => item.balance),
    );
    const positions = await get<{ currencies: { currency: string; invested: string }[] }>(
      user,
      '/investments/summary',
    );
    expect(Number(brl.cards.accountsBalance)).toBe(brlBalance);
    expect(brl.cards.invested).toBe(positions.currencies[0]?.invested);
    // Checking 1000 + 4000 − 800 (last month) + 5000 − 1000 − 200 − 500 = 7500,
    // savings 500 + 200 = 700; invested 2000 opening + 500 contributed.
    expect(brl.cards).toMatchObject({
      accountsBalance: '8200.00',
      invested: '2500.00',
      netWorth: '10700.00',
    });

    // Bills, like /finance/upcoming-bills?days=7 and /finance/overdue-bills.
    const upcoming = await get<{ totals: Json[] }>(
      user,
      '/finance/upcoming-bills?days=7',
    );
    const overdue = await get<{ totals: Json[] }>(user, '/finance/overdue-bills');
    expect(brl.cards.upcomingBills).toEqual({
      amount: (upcoming.totals[0] as { amount: string }).amount,
      count: 1,
    });
    expect(brl.cards.overdueBills).toEqual({
      amount: (overdue.totals[0] as { amount: string }).amount,
      count: 1,
    });
    expect(view.bills.upcoming.map((item) => item.description)).toEqual(['Internet']);
    expect(view.bills.overdue.map((item) => item.description)).toEqual(['Luz']);

    // Daily cash flow: every day of the month, adding up to the cards.
    expect(brl.cashFlow).toHaveLength(endOfMonth(today).getUTCDate());
    expect(brl.cashFlow[0]?.period).toBe(from);
    expect(sum(brl.cashFlow.map((point) => point.incomes))).toBe(
      Number(brl.cards.incomes),
    );
    expect(sum(brl.cashFlow.map((point) => point.expenses))).toBe(
      Number(brl.cards.expenses),
    );
    expect(sum(brl.cashFlow.map((point) => point.investments))).toBe(500);
    // Net worth ends where the card is (all movements are inside the month).
    expect(brl.netWorth.at(-1)?.value).toBe(brl.cards.netWorth);

    // Previous month block equals the summary of that month.
    const last = await get<{ currencies: (Json & { currency: string })[] }>(
      user,
      `/finance/summary?from=${f(previousStart)}&to=${f(addDays(monthStart, -1))}`,
    );
    const lastBrl = last.currencies.find(
      (item) => item.currency === 'BRL',
    ) as unknown as {
      incomes: { total: string };
      expenses: { total: string };
    };
    expect(brl.previous).toMatchObject({
      incomes: lastBrl.incomes.total,
      expenses: lastBrl.expenses.total,
    });
    expect(brl.previous.incomes).toBe('4000.00');

    // USD never mixes with BRL.
    expect(view.currencies[1]?.cards).toMatchObject({
      expenses: '10.00',
      accountsBalance: '90.00',
      netWorth: '90.00',
    });
  });

  it('derives insights from the same numbers', async () => {
    const { user } = await populated();
    const view = await dashboard(user);
    const kinds = view.insights
      .filter((item) => item.currency === 'BRL')
      .map((item) => item.kind);
    expect(kinds[0]).toBe('overdue_bills');
    expect(kinds).toEqual(
      expect.arrayContaining(['upcoming_bills', 'expenses_change', 'expense_ratio']),
    );
    const brl = view.currencies[0] as Block;
    const change = view.insights.find((item) => item.kind === 'expenses_change');
    // Pending bills fall in this or last month depending on today's date: use the blocks.
    const before = Number(brl.previous.expenses);
    const expected = ((Number(brl.cards.expenses) - before) / before) * 100;
    expect(change?.values).toMatchObject({
      direction: 'up',
      change: expected.toFixed(1),
      current: brl.cards.expenses,
      previous: brl.previous.expenses,
    });
    expect(view.insights.find((item) => item.kind === 'overdue_bills')?.values).toEqual({
      amount: '90.25',
      count: 1,
    });
  });

  it('builds monthly series and net worth for longer periods', async () => {
    const { user, monthStart, previousStart } = await populated();
    const view = await dashboard(user, '?period=3m');
    const brl = view.currencies[0] as Block;
    expect(view.period.groupBy).toBe('month');
    expect(brl.cashFlow.map((point) => point.period)).toHaveLength(3);
    const thisMonth = f(monthStart).slice(0, 7);
    const lastMonth = f(previousStart).slice(0, 7);
    expect(brl.cashFlow.find((point) => point.period === lastMonth)).toMatchObject({
      incomes: '4000.00',
    });
    // End of last month: 1000 + 500 opening + 4000 − 800 = 4700 (investment came later).
    const worthBefore = brl.netWorth.find((point) => point.period === lastMonth)?.value;
    expect(worthBefore).toBe('4700.00');
    expect(brl.netWorth.find((point) => point.period === thisMonth)?.value).toBe(
      brl.cards.netWorth,
    );
  });
});

describe('periods and time zones', () => {
  it('uses the profile time zone for "today"', async () => {
    const ahead = await newUser({ timeZone: 'Pacific/Kiritimati' });
    const behind = await newUser({ timeZone: 'Pacific/Pago_Pago' });
    const aheadToday = f(todayIn('Pacific/Kiritimati'));
    for (const session of [ahead, behind]) {
      await post(session, '/transactions', {
        type: 'EXPENSE',
        description: 'Café',
        amount: '50',
        occurredOn: aheadToday,
      });
    }
    const a = await dashboard(ahead, '?period=today');
    const b = await dashboard(behind, '?period=today');
    expect(a.period.today).toBe(aheadToday);
    expect(b.period.today).toBe(f(todayIn('Pacific/Pago_Pago')));
    expect(a.currencies[0]?.cards.expenses).toBe('50.00');
    // For the user 25 hours behind, that day is still tomorrow: nothing in their today.
    expect(b.currencies).toEqual([]);
  });

  it('starts the week on the profile setting', async () => {
    const user = await newUser({ timeZone: TZ, preferences: { weekStartsOn: 'sunday' } });
    const view = await dashboard(user, '?period=week');
    expect(view.period.weekStartsOn).toBe('sunday');
    expect(new Date(`${view.period.from as string}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(view.currencies).toEqual([]); // nothing recorded yet: empty, not zeros
    expect(view.primaryCurrency).toBe('BRL');
  });

  it('accepts custom periods and validates them', async () => {
    const user = await newUser();
    const view = await dashboard(user, '?period=custom&from=2026-01-10&to=2026-01-19');
    expect(view.period).toMatchObject({
      from: '2026-01-10',
      to: '2026-01-19',
      previousFrom: '2025-12-31',
      previousTo: '2026-01-09',
    });
    for (const [query, status] of [
      ['?period=custom&from=2026-01-10', 400],
      ['?period=custom&from=2026-02-10&to=2026-01-10', 400],
      ['?period=month&from=2026-01-10&to=2026-01-19', 400],
      ['?period=decade', 400],
      ['?period=custom&from=2026-02-30&to=2026-03-01', 400],
      ['?period=custom&from=2015-01-01&to=2026-01-01', 422],
    ] as const) {
      const response = await call(user, 'get', `/dashboard${query}`).expect(status);
      if (status === 422) expect(response.body.code).toBe('period_too_long');
    }
  });
});

describe('ownership', () => {
  it("never shows another user's data and needs a session", async () => {
    await populated();
    const stranger = await newUser();
    const view = await dashboard(stranger);
    expect(view.currencies).toEqual([]);
    expect(view.insights).toEqual([]);
    await request(app.getHttpServer()).get('/api/v1/dashboard').expect(401);
  });
});

describe('assistant', () => {
  it('reads the same insights through get_financial_insights', async () => {
    await db.client.aIProvider.updateMany({ data: { isActive: true } });
    const openai = await db.client.aIProvider.findFirstOrThrow({
      where: { type: 'OPENAI' },
    });
    await db.client.aIConfiguration.create({
      data: { providerId: openai.id, purpose: 'CHAT', model: 'gpt-test', priority: 1 },
    });
    const { user } = await populated();
    const call1: ToolCall = { id: 'c1', name: 'get_financial_insights', arguments: {} };
    let toolResult: Json | null = null;
    ai.OPENAI.handler = (req: ChatRequest) => {
      const tool = req.messages.find((message) => message.role === 'tool');
      if (!tool) return { toolCalls: [call1] };
      toolResult = JSON.parse((tool as { content: string }).content) as Json;
      return { text: 'Você tem contas vencidas.' };
    };
    await call(user, 'post', '/assistant/messages', {
      message: 'me dê insights do mês',
    }).expect(200);
    const view = await dashboard(user);
    expect(
      (toolResult as unknown as { data: { insights: unknown } }).data.insights,
    ).toEqual(view.insights);
  });
});
