import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { vi } from 'vitest';
import { seedDatabase } from '../../src/database/seed.js';
import { ActionHistoryService } from '../../src/finance/action-history.service.js';
import { addDays, formatCalendarDate, todayIn } from '../../src/finance/dates.js';
import {
  createDisposableDatabase,
  type DisposableDatabase,
} from './disposable-database.js';
import { createTestApp, FakeGoogle, loginAs, type Session, testEnv } from './support.js';

let db: DisposableDatabase;
let app: NestExpressApplication;
let google: FakeGoogle;
let systemCategory: Record<string, string>;

type Json = Record<string, unknown>;
let sequence = 0;

async function newUser(profile: Json = {}) {
  sequence += 1;
  const email = `fin${sequence}@example.com`;
  const session = await loginAs(app, google, { subject: `fin-${sequence}`, email });
  if (Object.keys(profile).length > 0) {
    await call(session, 'patch', '/api/v1/profile', profile).expect(200);
  }
  const user = await db.client.user.findUniqueOrThrow({ where: { email } });
  return { ...session, id: user.id };
}

function call(
  session: Session,
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  body?: object,
) {
  const req = request(app.getHttpServer())[method](path).set('Cookie', session.cookie);
  if (method !== 'get') req.set('X-CSRF-Token', session.csrf);
  return body ? req.send(body) : req;
}

const post = (s: Session, path: string, body: object) =>
  call(s, 'post', `/api/v1${path}`, body);
const get = (s: Session, path: string) => call(s, 'get', `/api/v1${path}`);

async function account(s: Session, body: Json = {}) {
  sequence += 1;
  const response = await post(s, '/accounts', {
    type: 'CHECKING',
    name: `Conta ${sequence}`,
    initialBalance: '1000',
    ...body,
  }).expect(201);
  return response.body as Json & { id: string };
}

async function transaction(s: Session, body: Json) {
  const response = await post(s, '/transactions', {
    type: 'EXPENSE',
    description: 'Teste',
    amount: '10',
    occurredOn: '2026-03-10',
    ...body,
  }).expect(201);
  return response.body as Json & { id: string; version: number };
}

const balanceOf = async (s: Session, id: string) =>
  ((await get(s, `/accounts/${id}`).expect(200)).body as { balance: string }).balance;

beforeAll(async () => {
  db = await createDisposableDatabase();
  await seedDatabase(db.client);
  testEnv(db.url);
  google = new FakeGoogle();
  app = await createTestApp(google);
  const rows = await db.client.category.findMany({ where: { ownerId: null } });
  systemCategory = Object.fromEntries(
    rows.map((row) => [row.systemKey as string, row.id]),
  );
});

afterAll(async () => {
  vi.restoreAllMocks();
  await app?.close();
  await db?.drop();
});

describe('accounts', () => {
  it('creates accounts with the profile currency and validates card fields and decimals', async () => {
    const user = await newUser();
    const checking = await account(user, { name: 'Nubank', type: 'DIGITAL' });
    expect(checking).toMatchObject({
      currency: 'BRL',
      initialBalance: '1000.00',
      balance: '1000.00',
      pendingNet: '0.00',
    });

    const card = await account(user, {
      name: 'Nubank',
      type: 'CREDIT_CARD',
      initialBalance: '0',
      creditLimit: '5000',
      dueDay: 10,
      closingDay: 3,
    });
    expect(card).toMatchObject({
      type: 'CREDIT_CARD',
      creditLimit: '5000.00',
      dueDay: 10,
      closingDay: 3,
    });

    const cardFields = await post(user, '/accounts', {
      type: 'CHECKING',
      name: 'Errada',
      dueDay: 10,
    }).expect(422);
    expect(cardFields.body).toMatchObject({ code: 'card_fields_not_allowed' });
    const duplicate = await post(user, '/accounts', {
      type: 'DIGITAL',
      name: 'Nubank',
    }).expect(409);
    expect(duplicate.body).toMatchObject({ code: 'account_name_taken' });
    const yen = await post(user, '/accounts', {
      type: 'CASH',
      name: 'Iene',
      currency: 'JPY',
      initialBalance: '10.5',
    }).expect(422);
    expect(yen.body).toMatchObject({ code: 'too_many_decimals' });
    await post(user, '/accounts', {
      type: 'CASH',
      name: 'Negativa',
      initialBalance: '-250.75',
    }).expect(201);
  });

  it('refuses deleting an account in use and lets it be archived instead', async () => {
    const user = await newUser();
    const used = await account(user);
    await transaction(user, { accountId: used.id });

    const blocked = await call(user, 'delete', `/api/v1/accounts/${used.id}`).expect(409);
    expect(blocked.body).toMatchObject({ code: 'account_in_use' });

    await call(user, 'patch', `/api/v1/accounts/${used.id}`, { isArchived: true }).expect(
      200,
    );
    const archived = await post(user, '/transactions', {
      type: 'EXPENSE',
      description: 'x',
      amount: '1',
      occurredOn: '2026-03-10',
      accountId: used.id,
    }).expect(422);
    expect(archived.body).toMatchObject({ code: 'account_archived' });

    const unused = await account(user);
    await call(user, 'delete', `/api/v1/accounts/${unused.id}`).expect(204);
  });
});

describe('transactions: rules', () => {
  it('records a paid expense by default and updates the account balance exactly', async () => {
    const user = await newUser();
    const acc = await account(user, { initialBalance: '0.30' });
    const created = await transaction(user, {
      accountId: acc.id,
      amount: '0.10',
      categoryId: systemCategory.food,
    });
    await transaction(user, { accountId: acc.id, amount: '0.20' });

    expect(created).toMatchObject({
      status: 'COMPLETED',
      paidOn: '2026-03-10',
      amount: '0.10',
      currency: 'BRL',
      syncStatus: 'PENDING_SYNC',
      version: 1,
    });
    expect(created.category).toMatchObject({ name: 'Alimentação', parent: null });
    expect(await balanceOf(user, acc.id)).toBe('0.00');
  });

  it('keeps bills with a due date pending, without payment date', async () => {
    const user = await newUser();
    const bill = await transaction(user, {
      description: 'Internet',
      amount: '120',
      dueOn: '2026-03-15',
    });
    expect(bill).toMatchObject({ status: 'PENDING', paidOn: null, dueOn: '2026-03-15' });

    const invalid = await post(user, '/transactions', {
      type: 'EXPENSE',
      description: 'x',
      amount: '1',
      occurredOn: '2026-03-10',
      status: 'PENDING',
      paidOn: '2026-03-10',
    }).expect(422);
    expect(invalid.body).toMatchObject({ code: 'paid_on_requires_completed' });
  });

  it('validates amounts against the currency and rejects impossible dates', async () => {
    const user = await newUser();
    for (const [amount, code] of [
      ['10.555', 'too_many_decimals'],
      ['0', 'amount_not_positive'],
      ['-3', 'amount_not_positive'],
      ['1e2', 'invalid_amount'],
    ]) {
      const response = await post(user, '/transactions', {
        type: 'EXPENSE',
        description: 'x',
        amount,
        occurredOn: '2026-03-10',
      }).expect(422);
      expect(response.body).toMatchObject({ code });
    }
    const date = await post(user, '/transactions', {
      type: 'EXPENSE',
      description: 'x',
      amount: '1',
      occurredOn: '2026-02-30',
    }).expect(400);
    expect(date.body).toMatchObject({ code: 'validation_failed' });
  });

  it('uses the account currency and never mixes currencies', async () => {
    const user = await newUser();
    const brl = await account(user);
    const usd = await account(user, { currency: 'USD', initialBalance: '0' });

    const mismatch = await post(user, '/transactions', {
      type: 'EXPENSE',
      description: 'x',
      amount: '1',
      occurredOn: '2026-03-10',
      accountId: brl.id,
      currency: 'USD',
    }).expect(422);
    expect(mismatch.body).toMatchObject({ code: 'currency_mismatch' });
    expect(await transaction(user, { accountId: usd.id })).toMatchObject({
      currency: 'USD',
    });
    expect(await transaction(user, { currency: 'EUR' })).toMatchObject({
      currency: 'EUR',
      account: null,
    });

    const crossTransfer = await post(user, '/transactions', {
      type: 'TRANSFER',
      description: 'x',
      amount: '1',
      occurredOn: '2026-03-10',
      accountId: brl.id,
      transferAccountId: usd.id,
    }).expect(422);
    expect(crossTransfer.body).toMatchObject({ code: 'currency_mismatch' });
  });

  it('moves money between accounts with transfers and validates them', async () => {
    const user = await newUser();
    const from = await account(user, { initialBalance: '500' });
    const to = await account(user, { initialBalance: '0' });

    const checks: [Json, string][] = [
      [{ accountId: from.id }, 'transfer_requires_accounts'],
      [{ accountId: from.id, transferAccountId: from.id }, 'transfer_same_account'],
      [
        {
          accountId: from.id,
          transferAccountId: to.id,
          categoryId: systemCategory.other,
        },
        'transfer_category_not_allowed',
      ],
    ];
    for (const [body, code] of checks) {
      const response = await post(user, '/transactions', {
        type: 'TRANSFER',
        description: 'x',
        amount: '1',
        occurredOn: '2026-03-10',
        ...body,
      }).expect(422);
      expect(response.body).toMatchObject({ code });
    }
    const notTransfer = await post(user, '/transactions', {
      type: 'EXPENSE',
      description: 'x',
      amount: '1',
      occurredOn: '2026-03-10',
      transferAccountId: to.id,
    }).expect(422);
    expect(notTransfer.body).toMatchObject({ code: 'transfer_account_not_allowed' });

    await transaction(user, {
      type: 'TRANSFER',
      amount: '120.50',
      accountId: from.id,
      transferAccountId: to.id,
    });
    expect(await balanceOf(user, from.id)).toBe('379.50');
    expect(await balanceOf(user, to.id)).toBe('120.50');
  });

  it('requires categories compatible with the type', async () => {
    const user = await newUser();
    const wrong = await post(user, '/transactions', {
      type: 'INCOME',
      description: 'Salário',
      amount: '8000',
      occurredOn: '2026-03-05',
      categoryId: systemCategory.food,
    }).expect(422);
    expect(wrong.body).toMatchObject({ code: 'category_kind_mismatch' });
    await transaction(user, {
      type: 'INCOME',
      amount: '8000',
      categoryId: systemCategory.salary,
    });
    await transaction(user, {
      type: 'INCOME',
      amount: '1',
      categoryId: systemCategory.other,
    }); // GENERAL fits any type
  });

  it('defaults the payment method of credit card expenses', async () => {
    const user = await newUser();
    const card = await account(user, {
      type: 'CREDIT_CARD',
      initialBalance: '0',
      dueDay: 10,
    });
    expect(await transaction(user, { accountId: card.id, amount: '300' })).toMatchObject({
      paymentMethod: 'CREDIT_CARD',
    });
    expect(await balanceOf(user, card.id)).toBe('-300.00');
  });

  it('links new transactions to the active spreadsheet', async () => {
    const user = await newUser();
    const sheet = await db.client.spreadsheet.create({
      data: {
        ownerId: user.id,
        name: 'Pessoal',
        status: 'ACTIVE',
        isActive: true,
        googleSpreadsheetId: `sheet-${user.id}`,
      },
    });
    const created = await transaction(user, {});
    expect(
      (await db.client.transaction.findUniqueOrThrow({ where: { id: created.id } }))
        .spreadsheetId,
    ).toBe(sheet.id);
  });
});

describe('transactions: update, delete and history', () => {
  it('updates with optimistic concurrency and keeps status/payment date consistent', async () => {
    const user = await newUser();
    const bill = await transaction(user, {
      description: 'Luz',
      amount: '180',
      dueOn: '2026-03-20',
    });

    const paid = await call(user, 'patch', `/api/v1/transactions/${bill.id}`, {
      status: 'COMPLETED',
      version: 1,
    }).expect(200);
    expect(paid.body).toMatchObject({
      status: 'COMPLETED',
      paidOn: '2026-03-10',
      version: 2,
    });

    const stale = await call(user, 'patch', `/api/v1/transactions/${bill.id}`, {
      amount: '1',
      version: 1,
    }).expect(409);
    expect(stale.body).toMatchObject({ code: 'version_conflict' });

    const reopened = await call(user, 'patch', `/api/v1/transactions/${bill.id}`, {
      status: 'PENDING',
    }).expect(200);
    expect(reopened.body).toMatchObject({ status: 'PENDING', paidOn: null, version: 3 });

    const history = (await get(user, '/action-history').expect(200)).body as Json[];
    const update = history.find(
      (item) => item.action === 'UPDATE' && item.entityId === bill.id,
    );
    expect(update?.before).toEqual({
      status: 'COMPLETED',
      paidOn: '2026-03-10T00:00:00.000Z',
    });
    expect(update?.after).toEqual({ status: 'PENDING', paidOn: null });
  });

  it('deletes with a full snapshot in the functional history', async () => {
    const user = await newUser();
    const created = await transaction(user, {
      description: 'Mercado',
      amount: '87.40',
      tags: ['casa', 'casa', 'mês'],
    });
    expect(created.tags).toEqual(['casa', 'mês']);

    await call(user, 'delete', `/api/v1/transactions/${created.id}`).expect(204);
    await get(user, `/transactions/${created.id}`).expect(404);

    const history = (await get(user, '/action-history').expect(200)).body as Json[];
    const removal = history.find(
      (item) => item.action === 'DELETE' && item.entityId === created.id,
    );
    expect(removal?.before).toMatchObject({
      description: 'Mercado',
      amount: '87.4',
      type: 'EXPENSE',
    });
    expect(removal?.after).toBeNull();
    expect(
      history.find((item) => item.action === 'CREATE' && item.entityId === created.id),
    ).toBeDefined();
  });

  it('is atomic: when the history cannot be written, nothing is saved', async () => {
    const user = await newUser();
    const spy = vi
      .spyOn(app.get(ActionHistoryService), 'record')
      .mockRejectedValueOnce(new Error('history down'));

    await post(user, '/transactions', {
      type: 'EXPENSE',
      description: 'Não pode ficar',
      amount: '5',
      occurredOn: '2026-03-10',
    }).expect(500);

    spy.mockRestore();
    expect(await db.client.transaction.count({ where: { ownerId: user.id } })).toBe(0);
  });
});

describe('ownership (IDOR) and input', () => {
  it('treats every id of another user as missing', async () => {
    const alice = await newUser();
    const bob = await newUser();
    const acc = await account(alice);
    const own = (
      await post(alice, '/categories', { name: 'Pets', kind: 'EXPENSE' }).expect(201)
    ).body as { id: string };
    const tx = await transaction(alice, { accountId: acc.id });

    await get(bob, `/transactions/${tx.id}`).expect(404);
    await call(bob, 'patch', `/api/v1/transactions/${tx.id}`, { amount: '1' }).expect(
      404,
    );
    await call(bob, 'delete', `/api/v1/transactions/${tx.id}`).expect(404);
    await get(bob, `/accounts/${acc.id}`).expect(404);
    await post(bob, '/transactions', {
      type: 'EXPENSE',
      description: 'x',
      amount: '1',
      occurredOn: '2026-03-10',
      accountId: acc.id,
    }).expect(404);
    await post(bob, '/transactions', {
      type: 'EXPENSE',
      description: 'x',
      amount: '1',
      occurredOn: '2026-03-10',
      categoryId: own.id,
    }).expect(404);
    await get(bob, `/transactions?accountId=${acc.id}`).expect(404);
    await call(bob, 'patch', `/api/v1/categories/${own.id}`, { name: 'Roubada' }).expect(
      404,
    );

    expect(
      ((await get(bob, '/transactions').expect(200)).body as { total: number }).total,
    ).toBe(0);
    expect(
      ((await get(bob, '/action-history').expect(200)).body as unknown[]).length,
    ).toBe(0);
    expect(
      await db.client.transaction.findUniqueOrThrow({ where: { id: tx.id } }),
    ).toMatchObject({ amount: expect.anything(), ownerId: alice.id });
  });

  it.each([
    ['ownerId', { ownerId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }],
    ['syncStatus', { syncStatus: 'SYNCED' }],
    ['spreadsheetId', { spreadsheetId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }],
    ['installmentId', { installmentId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }],
    ['version', { version: 7 }],
  ])('rejects %s on creation (mass assignment)', async (_label, extra) => {
    const user = await newUser();
    const response = await post(user, '/transactions', {
      type: 'EXPENSE',
      description: 'x',
      amount: '1',
      occurredOn: '2026-03-10',
      ...extra,
    }).expect(400);
    expect(response.body).toMatchObject({ code: 'validation_failed' });
  });
});

describe('categories', () => {
  it('lists the 14 system categories localized to the profile language', async () => {
    const user = await newUser({ locale: 'es-ES' });
    const list = (await get(user, '/categories').expect(200)).body as {
      name: string;
      isSystem: boolean;
      systemKey: string;
    }[];
    expect(list.filter((item) => item.isSystem)).toHaveLength(14);
    expect(list.find((item) => item.systemKey === 'food')?.name).toBe('Alimentación');
  });

  it('creates own categories and subcategories with consistent rules', async () => {
    const user = await newUser();
    const fuel = (
      await post(user, '/categories', {
        name: 'Combustível',
        kind: 'EXPENSE',
        parentId: systemCategory.transport,
      }).expect(201)
    ).body as { id: string };

    const checks: [Json, number, string][] = [
      [
        { name: 'Gasolina', kind: 'EXPENSE', parentId: fuel.id },
        422,
        'category_too_deep',
      ],
      [
        { name: 'Bônus', kind: 'INCOME', parentId: systemCategory.transport },
        422,
        'category_kind_mismatch',
      ],
      [
        { name: 'combustível', kind: 'EXPENSE', parentId: systemCategory.transport },
        409,
        'category_name_taken',
      ],
      [{ name: 'alimentação', kind: 'EXPENSE' }, 409, 'category_name_taken'],
    ];
    for (const [body, status, code] of checks) {
      const response = await post(user, '/categories', body).expect(status);
      expect(response.body).toMatchObject({ code });
    }

    const tx = await transaction(user, { categoryId: fuel.id });
    expect(tx.category).toMatchObject({
      name: 'Combustível',
      parent: { name: 'Transporte' },
    });
  });

  it('protects system categories and categories in use', async () => {
    const user = await newUser();
    const readOnly = await call(
      user,
      'patch',
      `/api/v1/categories/${systemCategory.food}`,
      { name: 'Comida' },
    ).expect(403);
    expect(readOnly.body).toMatchObject({ code: 'category_read_only' });

    const pets = (
      await post(user, '/categories', { name: 'Pets', kind: 'EXPENSE' }).expect(201)
    ).body as { id: string };
    await transaction(user, { categoryId: pets.id });
    const inUse = await call(user, 'delete', `/api/v1/categories/${pets.id}`).expect(409);
    expect(inUse.body).toMatchObject({ code: 'category_in_use' });

    const unused = (
      await post(user, '/categories', { name: 'Hobby', kind: 'EXPENSE' }).expect(201)
    ).body as { id: string };
    await call(user, 'delete', `/api/v1/categories/${unused.id}`).expect(204);
  });
});

describe('queries and aggregations', () => {
  let user: Awaited<ReturnType<typeof newUser>>;
  let fuelId: string;

  beforeAll(async () => {
    user = await newUser();
    const acc = await account(user, { initialBalance: '0' });
    const other = await account(user, { initialBalance: '0' });
    const usd = await account(user, { currency: 'USD', initialBalance: '0' });
    fuelId = (
      (
        await post(user, '/categories', {
          name: 'Combustível',
          kind: 'EXPENSE',
          parentId: systemCategory.transport,
        }).expect(201)
      ).body as { id: string }
    ).id;

    const add = (body: Json) => transaction(user, { accountId: acc.id, ...body });
    await add({
      type: 'INCOME',
      description: 'Salário',
      amount: '8000',
      occurredOn: '2026-03-05',
      categoryId: systemCategory.salary,
    });
    await add({
      type: 'INCOME',
      description: 'Freela A',
      amount: '0.10',
      occurredOn: '2026-03-06',
      categoryId: systemCategory.freelance,
    });
    await add({
      type: 'INCOME',
      description: 'Freela B',
      amount: '0.20',
      occurredOn: '2026-03-06',
      categoryId: systemCategory.freelance,
    });
    await add({
      description: 'Mercado',
      amount: '100.10',
      occurredOn: '2026-03-07',
      categoryId: systemCategory.food,
    });
    await add({
      description: 'Posto',
      amount: '50.05',
      occurredOn: '2026-03-08',
      categoryId: fuelId,
    });
    await add({
      description: 'IPVA parcela',
      amount: '49.95',
      occurredOn: '2026-03-09',
      dueOn: '2026-03-25',
      categoryId: systemCategory.transport,
    });
    await add({
      description: 'Cancelada',
      amount: '999',
      occurredOn: '2026-03-10',
      status: 'CANCELED',
      categoryId: systemCategory.food,
    });
    await add({
      type: 'INVESTMENT',
      description: 'CDB',
      amount: '1000',
      occurredOn: '2026-03-11',
      categoryId: systemCategory.investments,
    });
    await add({
      type: 'TRANSFER',
      description: 'Reserva',
      amount: '300',
      occurredOn: '2026-03-12',
      transferAccountId: other.id,
    });
    await add({ description: 'Fora do período', amount: '70', occurredOn: '2026-04-01' });
    await transaction(user, {
      accountId: usd.id,
      description: 'Assinatura',
      amount: '20',
      occurredOn: '2026-03-15',
      categoryId: systemCategory.subscriptions,
    });
  });

  it('summarizes a period per currency, excluding canceled items and transfers', async () => {
    const summary = (
      await get(user, '/finance/summary?from=2026-03-01&to=2026-03-31').expect(200)
    ).body as {
      currencies: Json[];
      largestExpenses: { description: string }[];
    };
    const brl = summary.currencies.find((item) => item.currency === 'BRL');
    expect(brl).toMatchObject({
      incomes: { completed: '8000.30', pending: '0.00', total: '8000.30' },
      expenses: { completed: '150.15', pending: '49.95', total: '200.10' },
      investments: { completed: '1000.00', pending: '0.00', total: '1000.00' },
      balance: '6850.15',
      projectedBalance: '6800.20',
      transactionCount: 7,
      expensesByCategory: [
        {
          categoryId: systemCategory.food,
          name: 'Alimentação',
          amount: '100.10',
          share: '50.02',
        },
        {
          categoryId: systemCategory.transport,
          name: 'Transporte',
          amount: '100.00',
          share: '49.98',
        },
      ],
    });
    expect(summary.currencies.find((item) => item.currency === 'USD')).toMatchObject({
      expenses: { completed: '20.00' },
      balance: '-20.00',
    });
    expect(summary.largestExpenses[0]?.description).toBe('Mercado');
    expect(summary.largestExpenses.map((item) => item.description)).not.toContain(
      'Cancelada',
    );
  });

  it('groups expenses and income by month or day', async () => {
    const monthly = (
      await get(
        user,
        '/finance/expenses-by-period?from=2026-03-01&to=2026-04-30&groupBy=month',
      ).expect(200)
    ).body as { series: Json[] };
    expect(monthly.series).toEqual([
      { period: '2026-03', currency: 'BRL', amount: '200.10', count: 3 },
      { period: '2026-03', currency: 'USD', amount: '20.00', count: 1 },
      { period: '2026-04', currency: 'BRL', amount: '70.00', count: 1 },
    ]);
    const daily = (
      await get(
        user,
        '/finance/income-by-period?from=2026-03-01&to=2026-03-31&groupBy=day',
      ).expect(200)
    ).body as { series: Json[] };
    expect(daily.series).toEqual([
      { period: '2026-03-05', currency: 'BRL', amount: '8000.00', count: 1 },
      { period: '2026-03-06', currency: 'BRL', amount: '0.30', count: 2 },
    ]);
  });

  it('searches by text, category (with subcategories), type, amount and order', async () => {
    const byCategory = (
      await get(user, `/transactions?categoryId=${systemCategory.transport}`).expect(200)
    ).body as { items: { description: string }[] };
    expect(byCategory.items.map((item) => item.description).sort()).toEqual([
      'IPVA parcela',
      'Posto',
    ]);

    const text = (await get(user, '/transactions?q=FREELA').expect(200)).body as {
      total: number;
    };
    expect(text.total).toBe(2);

    const page = (
      await get(
        user,
        '/transactions?type=EXPENSE&status=COMPLETED,PENDING&minAmount=50&sort=amount_desc&limit=2',
      ).expect(200)
    ).body as {
      items: { description: string }[];
      total: number;
      limit: number;
    };
    // Mercado 100.10, Fora do período 70.00, Posto 50.05 (IPVA 49.95 is below the minimum).
    expect(page).toMatchObject({ total: 3, limit: 2 });
    expect(page.items.map((item) => item.description)).toEqual([
      'Mercado',
      'Fora do período',
    ]);
  });

  it('validates periods', async () => {
    await get(user, '/finance/summary?from=2026-03-31&to=2026-03-01').expect(400);
    const tooLong = await get(
      user,
      '/finance/summary?from=2000-01-01&to=2026-12-31',
    ).expect(422);
    expect(tooLong.body).toMatchObject({ code: 'period_too_long' });
  });
});

describe('bills and time zones', () => {
  it('decides overdue and upcoming with the user time zone, not the server clock', async () => {
    // Kiritimati (UTC+14) is always 1–2 calendar days ahead of Pago Pago (UTC−11).
    const ahead = await newUser({ timeZone: 'Pacific/Kiritimati' });
    const behind = await newUser({ timeZone: 'Pacific/Pago_Pago' });
    const todayAhead = todayIn('Pacific/Kiritimati');
    const todayBehind = todayIn('Pacific/Pago_Pago');
    const due = formatCalendarDate(todayBehind);

    for (const session of [ahead, behind]) {
      await transaction(session, {
        description: 'Boleto',
        amount: '50',
        occurredOn: due,
        dueOn: due,
      });
    }

    const overdueAhead = (await get(ahead, '/finance/overdue-bills').expect(200))
      .body as { items: { isOverdue: boolean }[]; today: string };
    const overdueBehind = (await get(behind, '/finance/overdue-bills').expect(200))
      .body as { items: unknown[]; today: string };
    expect(overdueAhead.today).toBe(formatCalendarDate(todayAhead));
    expect(overdueAhead.items).toHaveLength(1);
    expect(overdueAhead.items[0]?.isOverdue).toBe(true);
    expect(overdueBehind.items).toHaveLength(0);

    const upcomingBehind = (
      await get(behind, '/finance/upcoming-bills?days=1').expect(200)
    ).body as { items: unknown[]; totals: Json[] };
    expect(upcomingBehind.items).toHaveLength(1);
    expect(upcomingBehind.totals).toEqual([
      { currency: 'BRL', amount: '50.00', count: 1 },
    ]);
  });

  it('includes only pending expenses inside the window', async () => {
    const user = await newUser({ timeZone: 'America/Sao_Paulo' });
    const today = todayIn('America/Sao_Paulo');
    const at = (offset: number) => formatCalendarDate(addDays(today, offset));
    await transaction(user, {
      description: 'Hoje',
      amount: '10',
      occurredOn: at(-5),
      dueOn: at(0),
    });
    await transaction(user, {
      description: 'Em 6 dias',
      amount: '20',
      occurredOn: at(-5),
      dueOn: at(6),
    });
    await transaction(user, {
      description: 'Em 7 dias',
      amount: '30',
      occurredOn: at(-5),
      dueOn: at(7),
    });
    await transaction(user, {
      description: 'Ontem',
      amount: '40',
      occurredOn: at(-5),
      dueOn: at(-1),
    });
    await transaction(user, {
      description: 'Já pago',
      amount: '50',
      occurredOn: at(-5),
      dueOn: at(1),
      status: 'COMPLETED',
    });
    await transaction(user, {
      type: 'INCOME',
      description: 'A receber',
      amount: '60',
      occurredOn: at(-5),
      dueOn: at(1),
    });

    const week = (await get(user, '/finance/upcoming-bills?days=7').expect(200)).body as {
      items: { description: string }[];
    };
    expect(week.items.map((item) => item.description)).toEqual(['Hoje', 'Em 6 dias']);
    const overdue = (await get(user, '/finance/overdue-bills').expect(200)).body as {
      items: { description: string }[];
    };
    expect(overdue.items.map((item) => item.description)).toEqual(['Ontem']);
  });
});
