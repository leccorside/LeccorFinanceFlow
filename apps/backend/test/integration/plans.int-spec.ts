import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { vi } from 'vitest';
import { seedDatabase } from '../../src/database/seed.js';
import { ActionHistoryService } from '../../src/finance/action-history.service.js';
import { addDays, formatCalendarDate, todayIn } from '../../src/finance/dates.js';
import { addMonthsAnchored } from '../../src/finance/schedule.js';
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
type Parcel = Json & { id: string; amount: string; dueOn: string; status: string };
let sequence = 0;

async function newUser() {
  sequence += 1;
  const email = `plan${sequence}@example.com`;
  const session = await loginAs(app, google, { subject: `plan-${sequence}`, email });
  const user = await db.client.user.findUniqueOrThrow({ where: { email } });
  return { ...session, id: user.id };
}

function call(
  session: Session,
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  body?: object,
) {
  const server = request(app.getHttpServer());
  const req = server[method](`/api/v1${path}`).set('Cookie', session.cookie);
  if (method !== 'get') req.set('X-CSRF-Token', session.csrf);
  return body ? req.send(body) : req;
}
const post = (s: Session, path: string, body: object) => call(s, 'post', path, body);
const get = (s: Session, path: string) => call(s, 'get', path);
const patch = (s: Session, path: string, body: object) => call(s, 'patch', path, body);
const del = (s: Session, path: string) => call(s, 'delete', path);

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

/** "Today" as the API sees it (default profile time zone). */
const today = () => todayIn('America/Sao_Paulo');
const iso = formatCalendarDate;

const occurrencesOf = (recurrenceId: string) =>
  db.client.transaction.findMany({
    where: { recurringTransactionId: recurrenceId },
    orderBy: { recurrenceOccurrenceOn: 'asc' },
  });

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

// ─────────────────────────────── Installments ───────────────────────────────

describe('installments', () => {
  it('creates "TV de R$ 3.600 em 12x no cartão" as 12 pending parcels of R$ 300', async () => {
    const user = await newUser();
    const card = await account(user, {
      type: 'CREDIT_CARD',
      name: 'Nubank',
      initialBalance: '0',
      closingDay: 3,
      dueDay: 10,
    });
    const response = await post(user, '/installments', {
      description: 'TV',
      totalAmount: '3600',
      installmentCount: 12,
      purchasedOn: '2026-03-02',
      accountId: card.id,
      categoryId: systemCategory.shopping,
    }).expect(201);
    const body = response.body as Json & { parcels: Parcel[] };

    expect(body).toMatchObject({
      description: 'TV',
      totalAmount: '3600.00',
      currency: 'BRL',
      installmentCount: 12,
      purchasedOn: '2026-03-02',
      firstDueOn: '2026-03-10', // bought before the closing day: this month's statement
      lastDueOn: '2027-02-10',
      account: { id: card.id, name: 'Nubank' },
      category: { name: 'Compras' },
      paidCount: 0,
      pendingCount: 12,
      remainingAmount: '3600.00',
      nextDueOn: '2026-03-10',
    });
    expect(body.parcels).toHaveLength(12);
    body.parcels.forEach((parcel, index) => {
      expect(parcel).toMatchObject({
        type: 'EXPENSE',
        status: 'PENDING',
        amount: '300.00',
        paymentMethod: 'CREDIT_CARD',
        paidOn: null,
        installment: { id: body.id, number: index + 1, count: 12 },
      });
      expect(parcel.occurredOn).toBe(parcel.dueOn);
    });
    expect(body.parcels.map((parcel) => parcel.dueOn).slice(0, 3)).toEqual([
      '2026-03-10',
      '2026-04-10',
      '2026-05-10',
    ]);

    // The purchase on the closing day goes to the next statement.
    const next = await post(user, '/installments', {
      description: 'Fone',
      totalAmount: '200',
      installmentCount: 2,
      purchasedOn: '2026-03-03',
      accountId: card.id,
    }).expect(201);
    expect(next.body).toMatchObject({ firstDueOn: '2026-04-10' });
  });

  it('spreads the residue cents and anchors month-end due dates', async () => {
    const user = await newUser();
    const response = await post(user, '/installments', {
      description: 'Curso',
      totalAmount: '100',
      installmentCount: 3,
      purchasedOn: '2026-01-31',
    }).expect(201);
    const body = response.body as Json & { parcels: Parcel[] };
    expect(body.firstDueOn).toBe('2026-02-28'); // one month after, clamped
    expect(body.parcels.map((parcel) => [parcel.amount, parcel.dueOn])).toEqual([
      ['33.34', '2026-02-28'],
      ['33.33', '2026-03-28'],
      ['33.33', '2026-04-28'],
    ]);
    const sum = await db.client.transaction.aggregate({
      where: { installmentId: body.id as string },
      _sum: { amount: true },
    });
    expect(sum._sum.amount?.toString()).toBe('100');

    const month31 = await post(user, '/installments', {
      description: 'Geladeira',
      totalAmount: '1000',
      installmentCount: 12,
      purchasedOn: '2026-01-15',
      firstDueOn: '2026-01-31',
    }).expect(201);
    const parcels = (month31.body as { parcels: Parcel[] }).parcels;
    expect(parcels.slice(0, 4).map((parcel) => [parcel.amount, parcel.dueOn])).toEqual([
      ['83.34', '2026-01-31'],
      ['83.34', '2026-02-28'],
      ['83.34', '2026-03-31'],
      ['83.34', '2026-04-30'],
    ]);
    expect(parcels.slice(4).every((parcel) => parcel.amount === '83.33')).toBe(true);
  });

  it('validates totals, counts, dates and the category kind', async () => {
    const user = await newUser();
    const base = {
      description: 'X',
      totalAmount: '100',
      installmentCount: 2,
      purchasedOn: '2026-03-10',
    };
    const small = await post(user, '/installments', {
      ...base,
      totalAmount: '0.05',
      installmentCount: 12,
    }).expect(422);
    expect(small.body).toMatchObject({ code: 'installment_amount_too_small' });
    const before = await post(user, '/installments', {
      ...base,
      firstDueOn: '2026-03-09',
    }).expect(422);
    expect(before.body).toMatchObject({ code: 'first_due_before_purchase' });
    const decimals = await post(user, '/installments', {
      ...base,
      totalAmount: '10.001',
    }).expect(422);
    expect(decimals.body).toMatchObject({ code: 'too_many_decimals' });
    const kind = await post(user, '/installments', {
      ...base,
      categoryId: systemCategory.salary,
    }).expect(422);
    expect(kind.body).toMatchObject({ code: 'category_kind_mismatch' });
    await post(user, '/installments', { ...base, installmentCount: 1 }).expect(400);
    await post(user, '/installments', { ...base, installmentCount: 421 }).expect(400);
    await post(user, '/installments', { ...base, purchasedOn: '2026-02-30' }).expect(400);
    expect(await db.client.installment.count({ where: { ownerId: user.id } })).toBe(0);
  });

  it('keeps the parcels adding up: no lone amount changes or deletions', async () => {
    const user = await newUser();
    const created = (
      await post(user, '/installments', {
        description: 'Sofá',
        totalAmount: '900',
        installmentCount: 3,
        purchasedOn: '2026-03-01',
      }).expect(201)
    ).body as { id: string; parcels: Parcel[] };
    const [first, second] = created.parcels as [Parcel, Parcel];

    const amount = await patch(user, `/transactions/${first.id}`, {
      amount: '100',
    }).expect(422);
    expect(amount.body).toMatchObject({
      code: 'installment_parcel_locked',
      details: { fields: ['amount'] },
    });
    await patch(user, `/transactions/${first.id}`, { amount: '300.00' }).expect(200); // same value
    const removed = await del(user, `/transactions/${first.id}`).expect(422);
    expect(removed.body).toMatchObject({ code: 'installment_parcel_locked' });

    // Paying a parcel is allowed and shows in the progress.
    await patch(user, `/transactions/${second.id}`, {
      status: 'COMPLETED',
      paidOn: '2026-05-01',
    }).expect(200);
    const list = (await get(user, '/installments').expect(200)).body as Json[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      paidCount: 1,
      paidAmount: '300.00',
      pendingCount: 2,
      remainingAmount: '600.00',
      nextDueOn: first.dueOn,
    });
  });

  it('deletes the whole purchase with a full snapshot in the history', async () => {
    const user = await newUser();
    const created = (
      await post(user, '/installments', {
        description: 'Notebook',
        totalAmount: '4800',
        installmentCount: 10,
        purchasedOn: '2026-03-01',
      }).expect(201)
    ).body as { id: string };

    await del(user, `/installments/${created.id}`).expect(204);
    expect(await db.client.transaction.count({ where: { ownerId: user.id } })).toBe(0);
    await get(user, `/installments/${created.id}`).expect(404);

    const history = await db.client.actionHistory.findMany({
      where: { ownerId: user.id, entityType: 'INSTALLMENT' },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((entry) => entry.action)).toEqual(['CREATE', 'DELETE']);
    const before = history[1]?.beforeState as { totalAmount: string; parcels: Json[] };
    expect(before.totalAmount).toBe('4800');
    expect(before.parcels).toHaveLength(10);
    expect((history[0]?.afterState as { parcels: Json[] }).parcels).toHaveLength(10);
  });

  it('is atomic: a failing history write leaves no purchase and no parcel', async () => {
    const user = await newUser();
    const spy = vi
      .spyOn(app.get(ActionHistoryService), 'record')
      .mockRejectedValueOnce(new Error('history down'));
    await post(user, '/installments', {
      description: 'Não pode ficar',
      totalAmount: '120',
      installmentCount: 12,
      purchasedOn: '2026-03-01',
    }).expect(500);
    spy.mockRestore();
    expect(await db.client.installment.count({ where: { ownerId: user.id } })).toBe(0);
    expect(await db.client.transaction.count({ where: { ownerId: user.id } })).toBe(0);
  });
});

// ──────────────────────────────── Recurrences ───────────────────────────────

describe('recurrences', () => {
  it('validates the schedule shape and dates', async () => {
    const user = await newUser();
    const base = { type: 'EXPENSE', description: 'Internet', amount: '120' };
    await post(user, '/recurring-transactions', { ...base, frequency: 'CUSTOM' }).expect(
      400,
    );
    await post(user, '/recurring-transactions', {
      ...base,
      frequency: 'MONTHLY',
      intervalUnit: 'DAY',
    }).expect(400);
    await post(user, '/recurring-transactions', {
      ...base,
      frequency: 'WEEKLY',
      dayOfMonth: 10,
    }).expect(400);
    await post(user, '/recurring-transactions', {
      ...base,
      frequency: 'MONTHLY',
      intervalCount: 2,
    }).expect(400);
    await post(user, '/recurring-transactions', {
      ...base,
      type: 'TRANSFER',
      frequency: 'MONTHLY',
    }).expect(400);
    const end = await post(user, '/recurring-transactions', {
      ...base,
      frequency: 'MONTHLY',
      startOn: '2026-05-01',
      endOn: '2026-04-30',
    }).expect(422);
    expect(end.body).toMatchObject({ code: 'end_before_start' });
    const none = await post(user, '/recurring-transactions', {
      ...base,
      frequency: 'MONTHLY',
      dayOfMonth: 31,
      startOn: '2026-02-01',
      endOn: '2026-02-27',
    }).expect(422);
    expect(none.body).toMatchObject({ code: 'recurrence_without_occurrences' });
    const kind = await post(user, '/recurring-transactions', {
      ...base,
      type: 'INCOME',
      frequency: 'MONTHLY',
      categoryId: systemCategory.food,
    }).expect(422);
    expect(kind.body).toMatchObject({ code: 'category_kind_mismatch' });
  });

  it('"Pago R$ 2.500 de aluguel todo dia 5": materializes on demand, exactly once', async () => {
    const user = await newUser();
    const created = (
      await post(user, '/recurring-transactions', {
        type: 'EXPENSE',
        description: 'Aluguel',
        amount: '2500',
        frequency: 'MONTHLY',
        dayOfMonth: 5,
        startOn: '2026-01-01',
        endOn: '2026-04-30',
        categoryId: systemCategory.housing,
      }).expect(201)
    ).body as Json & { id: string };
    expect(created).toMatchObject({
      amount: '2500.00',
      dayOfMonth: 5,
      upcomingDates: ['2026-01-05', '2026-02-05', '2026-03-05'],
      lastMaterializedOn: null,
      category: { name: 'Moradia' },
    });
    expect(await occurrencesOf(created.id)).toHaveLength(0); // nothing until asked

    // Many concurrent queries: still one transaction per occurrence date.
    await Promise.all([
      get(user, '/transactions?from=2026-01-01&to=2026-12-31').expect(200),
      get(user, '/finance/summary?from=2026-01-01&to=2026-12-31').expect(200),
      get(user, '/finance/overdue-bills').expect(200),
      get(user, '/finance/expenses-by-period?from=2026-01-01&to=2026-12-31').expect(200),
      get(user, '/transactions?from=2026-01-01&to=2026-12-31').expect(200),
    ]);
    await get(user, '/finance/summary?from=2026-01-01&to=2026-12-31').expect(200);

    const rows = await occurrencesOf(created.id);
    expect(rows.map((row) => iso(row.recurrenceOccurrenceOn as Date))).toEqual([
      '2026-01-05',
      '2026-02-05',
      '2026-03-05',
      '2026-04-05',
    ]);
    expect(
      rows.every(
        (row) =>
          row.status === 'PENDING' &&
          row.amount.toString() === '2500' &&
          iso(row.dueOn as Date) === iso(row.occurredOn) &&
          row.categoryId === systemCategory.housing,
      ),
    ).toBe(true);
    const search = (
      await get(user, '/transactions?from=2026-01-01&to=2026-12-31').expect(200)
    ).body as { total: number; items: Json[] };
    expect(search.total).toBe(4);
    expect(search.items[0]).toMatchObject({
      recurrence: { id: created.id, occurrenceOn: '2026-04-05' },
      isOverdue: true,
    });
    const after = (await get(user, `/recurring-transactions/${created.id}`).expect(200))
      .body as Json;
    expect(after).toMatchObject({
      isFinished: true,
      upcomingDates: [],
      lastMaterializedOn: '2026-04-05',
    });

    // The unique index is the last line of defense against duplicates.
    const first = rows[0] as (typeof rows)[number];
    await expect(
      db.client.transaction.create({
        data: {
          ownerId: user.id,
          type: 'EXPENSE',
          description: 'dup',
          amount: '1',
          occurredOn: first.occurredOn,
          recurringTransactionId: created.id,
          recurrenceOccurrenceOn: first.recurrenceOccurrenceOn,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('supports biweekly, yearly (29/02) and custom schedules', async () => {
    const user = await newUser();
    const create = async (body: Json) =>
      (
        (
          await post(user, '/recurring-transactions', {
            type: 'INCOME',
            description: 'Renda',
            amount: '10',
            ...body,
          }).expect(201)
        ).body as { id: string }
      ).id;
    const biweekly = await create({
      frequency: 'BIWEEKLY',
      startOn: '2026-01-02',
      endOn: '2026-02-27',
    });
    const yearly = await create({
      frequency: 'YEARLY',
      startOn: '2024-02-29',
      endOn: '2026-12-31',
    });
    const quarterly = await create({
      frequency: 'CUSTOM',
      intervalUnit: 'MONTH',
      intervalCount: 3,
      dayOfMonth: 31,
      startOn: '2025-01-31',
      endOn: '2025-12-31',
    });
    await get(user, '/finance/income-by-period?from=2024-01-01&to=2026-12-31').expect(
      200,
    );

    const dates = async (id: string) =>
      (await occurrencesOf(id)).map((row) => iso(row.recurrenceOccurrenceOn as Date));
    expect(await dates(biweekly)).toEqual([
      '2026-01-02',
      '2026-01-16',
      '2026-01-30',
      '2026-02-13',
      '2026-02-27',
    ]);
    expect(await dates(yearly)).toEqual(['2024-02-29', '2025-02-28', '2026-02-28']);
    expect(await dates(quarterly)).toEqual([
      '2025-01-31',
      '2025-04-30',
      '2025-07-31',
      '2025-10-31',
    ]);
  });

  it('materializes future occurrences only up to the queried date', async () => {
    const user = await newUser();
    const start = today();
    const weekly = (
      await post(user, '/recurring-transactions', {
        type: 'EXPENSE',
        description: 'Feira',
        amount: '80',
        frequency: 'WEEKLY',
        startOn: iso(start),
      }).expect(201)
    ).body as { id: string };

    const upcoming = (await get(user, '/finance/upcoming-bills?days=15').expect(200))
      .body as { items: Parcel[]; totals: Json[] };
    expect(upcoming.items.map((item) => item.dueOn)).toEqual([
      iso(start),
      iso(addDays(start, 7)),
      iso(addDays(start, 14)),
    ]);
    expect(upcoming.totals).toEqual([{ currency: 'BRL', amount: '240.00', count: 3 }]);
    expect(await occurrencesOf(weekly.id)).toHaveLength(3);

    // Far-future queries are capped at today + 366 days.
    await get(
      user,
      `/transactions?from=${iso(start)}&to=${iso(addDays(start, 3000))}`,
    ).expect(200);
    const rows = await occurrencesOf(weekly.id);
    const last = rows.at(-1)?.recurrenceOccurrenceOn as Date;
    expect(last.getTime()).toBeLessThanOrEqual(addDays(start, 366).getTime());
    expect(rows.length).toBe(53);
  });

  it('edits flow to pending, unedited occurrences from today on; past and edited stay', async () => {
    const user = await newUser();
    const start = today();
    const recurrence = (
      await post(user, '/recurring-transactions', {
        type: 'EXPENSE',
        description: 'Academia',
        amount: '100',
        frequency: 'MONTHLY',
        startOn: iso(addMonthsAnchored(start, -2)),
        categoryId: systemCategory.health,
      }).expect(201)
    ).body as { id: string; version: number };
    await get(
      user,
      `/transactions?from=2020-01-01&to=${iso(addMonthsAnchored(start, 2))}`,
    ).expect(200);
    const before = await occurrencesOf(recurrence.id);
    expect(before).toHaveLength(5); // 2 past, today, 2 future
    const [past1, past2, current, future1, future2] = before as [
      (typeof before)[number],
      (typeof before)[number],
      (typeof before)[number],
      (typeof before)[number],
      (typeof before)[number],
    ];

    // The user pays a past one and edits a future one by hand.
    await patch(user, `/transactions/${past1.id}`, { status: 'COMPLETED' }).expect(200);
    await patch(user, `/transactions/${future1.id}`, { amount: '150' }).expect(200);

    const updated = await patch(user, `/recurring-transactions/${recurrence.id}`, {
      amount: '120',
      version: recurrence.version,
    }).expect(200);
    expect(updated.body).toMatchObject({ amount: '120.00', version: 2 });
    const amounts = async () =>
      Object.fromEntries(
        (await occurrencesOf(recurrence.id)).map((row) => [
          row.id,
          row.amount.toString(),
        ]),
      );
    expect(await amounts()).toEqual({
      [past1.id]: '100',
      [past2.id]: '100', // in the past: history is not rewritten
      [current.id]: '120', // due today, pending, unedited
      [future1.id]: '150', // edited by hand
      [future2.id]: '120',
    });
    const history = await db.client.actionHistory.findFirst({
      where: { entityId: recurrence.id, action: 'UPDATE' },
    });
    expect(history?.afterState).toMatchObject({
      amount: '120',
      updatedOccurrences: [current.id, future2.id],
      deletedOccurrences: [],
    });
    expect((history?.beforeState as { occurrences: Json[] }).occurrences).toHaveLength(2);

    // Stale version → 409.
    const stale = await patch(user, `/recurring-transactions/${recurrence.id}`, {
      amount: '130',
      version: 1,
    }).expect(409);
    expect(stale.body).toMatchObject({ code: 'version_conflict' });

    // Pausing removes the pending unedited future occurrences; resuming brings them back
    // without duplicating the hand-edited one.
    await patch(user, `/recurring-transactions/${recurrence.id}`, {
      isActive: false,
    }).expect(200);
    expect(Object.keys(await amounts()).sort()).toEqual(
      [past1.id, past2.id, future1.id].sort(),
    );
    await get(
      user,
      `/transactions?from=2020-01-01&to=${iso(addMonthsAnchored(start, 2))}`,
    ).expect(200);
    expect(await occurrencesOf(recurrence.id)).toHaveLength(3); // paused: nothing new

    await patch(user, `/recurring-transactions/${recurrence.id}`, {
      isActive: true,
    }).expect(200);
    await get(
      user,
      `/transactions?from=2020-01-01&to=${iso(addMonthsAnchored(start, 2))}`,
    ).expect(200);
    const resumed = await occurrencesOf(recurrence.id);
    expect(
      resumed.map((row) => [
        iso(row.recurrenceOccurrenceOn as Date),
        row.amount.toString(),
      ]),
    ).toEqual([
      [iso(past1.recurrenceOccurrenceOn as Date), '100'],
      [iso(past2.recurrenceOccurrenceOn as Date), '100'],
      [iso(current.recurrenceOccurrenceOn as Date), '120'],
      [iso(future1.recurrenceOccurrenceOn as Date), '150'],
      [iso(future2.recurrenceOccurrenceOn as Date), '120'],
    ]);

    // Deleting keeps realized/edited occurrences as plain transactions.
    await del(user, `/recurring-transactions/${recurrence.id}`).expect(204);
    const left = await db.client.transaction.findMany({ where: { ownerId: user.id } });
    expect(left.map((row) => row.id).sort()).toEqual(
      [past1.id, past2.id, future1.id].sort(),
    );
    expect(left.every((row) => row.recurringTransactionId === null)).toBe(true);
    const deleted = await db.client.actionHistory.findFirst({
      where: { entityId: recurrence.id, action: 'DELETE' },
    });
    expect((deleted?.beforeState as { occurrences: Json[] }).occurrences).toHaveLength(2);
  });

  it('shortening the end date removes the pending occurrences after it', async () => {
    const user = await newUser();
    const start = today();
    const recurrence = (
      await post(user, '/recurring-transactions', {
        type: 'EXPENSE',
        description: 'Streaming',
        amount: '40',
        frequency: 'MONTHLY',
        startOn: iso(start),
      }).expect(201)
    ).body as { id: string };
    await get(user, `/transactions?to=${iso(addMonthsAnchored(start, 3))}`).expect(200);
    expect(await occurrencesOf(recurrence.id)).toHaveLength(4);
    await patch(user, `/recurring-transactions/${recurrence.id}`, {
      endOn: iso(addMonthsAnchored(start, 1)),
    }).expect(200);
    expect(await occurrencesOf(recurrence.id)).toHaveLength(2);
  });
});

// ──────────────────────────────── Investments ───────────────────────────────

describe('investments', () => {
  it('"Investi R$ 1.000 em Bitcoin hoje": position, linked contribution and balance', async () => {
    const user = await newUser();
    const checking = await account(user, { initialBalance: '5000' });
    const bitcoin = (
      await post(user, '/investments', {
        assetClass: 'CRYPTO',
        name: 'Bitcoin',
        symbol: 'btc',
      }).expect(201)
    ).body as Json & { id: string };
    expect(bitcoin).toMatchObject({
      symbol: 'BTC',
      currency: 'BRL',
      quantity: '0',
      invested: '0.00',
    });

    const result = await post(user, `/investments/${bitcoin.id}/contributions`, {
      amount: '1000',
      quantity: '0.00512345',
      accountId: checking.id,
    }).expect(201);
    expect(result.body).toMatchObject({
      investment: {
        quantity: '0.00512345',
        contributed: '1000.00',
        invested: '1000.00',
        contributionCount: 1,
      },
      transaction: {
        type: 'INVESTMENT',
        status: 'COMPLETED',
        description: 'Bitcoin',
        amount: '1000.00',
        occurredOn: iso(today()),
        paidOn: iso(today()),
        category: { name: 'Investimentos' },
        investment: { id: bitcoin.id, name: 'Bitcoin' },
      },
    });
    const balance = (await get(user, `/accounts/${checking.id}`).expect(200))
      .body as Json;
    expect(balance.balance).toBe('4000.00');

    const detail = (await get(user, `/investments/${bitcoin.id}`).expect(200)).body as {
      contributions: Json[];
    };
    expect(detail.contributions).toHaveLength(1);

    // History: the contribution and the quantity change, in the same transaction.
    const history = await db.client.actionHistory.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((entry) => `${entry.entityType}:${entry.action}`)).toEqual([
      'FINANCIAL_ACCOUNT:CREATE',
      'INVESTMENT:CREATE',
      'TRANSACTION:CREATE',
      'INVESTMENT:UPDATE',
    ]);
  });

  it('supports every class and sums invested amounts per class and currency', async () => {
    const user = await newUser();
    const classes = [
      'STOCK',
      'REIT',
      'ETF',
      'CRYPTO',
      'TREASURY',
      'CDB',
      'LCI_LCA',
      'FUND',
      'PENSION',
      'OTHER',
    ];
    for (const assetClass of classes) {
      await post(user, '/investments', {
        assetClass,
        name: `Posição ${assetClass}`,
        totalCost: assetClass === 'STOCK' ? '500' : '0',
      }).expect(201);
    }
    await post(user, '/investments', {
      assetClass: 'STOCK',
      name: 'Apple',
      currency: 'USD',
      totalCost: '300.50',
    }).expect(201);
    const crypto = (
      (await get(user, '/investments?assetClass=CRYPTO').expect(200)).body as {
        id: string;
      }[]
    )[0] as { id: string };
    await post(user, `/investments/${crypto.id}/contributions`, {
      amount: '1000',
    }).expect(201);
    // Pending contributions do not count as invested yet.
    await post(user, `/investments/${crypto.id}/contributions`, {
      amount: '50',
      status: 'PENDING',
    }).expect(201);

    const summary = (await get(user, '/investments/summary').expect(200)).body as {
      currencies: { currency: string; invested: string; byClass: Json[] }[];
    };
    expect(summary.currencies.map((item) => [item.currency, item.invested])).toEqual([
      ['BRL', '1500.00'],
      ['USD', '300.50'],
    ]);
    expect(summary.currencies[0]?.byClass.slice(0, 2)).toEqual([
      { assetClass: 'CRYPTO', invested: '1000.00', share: '66.67', positions: 1 },
      { assetClass: 'STOCK', invested: '500.00', share: '33.33', positions: 1 },
    ]);
    const position = (await get(user, `/investments/${crypto.id}`).expect(200)).body;
    expect(position).toMatchObject({
      contributed: '1000.00',
      pendingContributions: '50.00',
      invested: '1000.00',
    });
    await post(user, '/investments', { assetClass: 'GOLD', name: 'Ouro' }).expect(400);
  });

  it('keeps currencies apart and contributions consistent', async () => {
    const user = await newUser();
    const brl = await account(user);
    const apple = (
      await post(user, '/investments', {
        assetClass: 'STOCK',
        name: 'Apple',
        symbol: 'AAPL',
        currency: 'USD',
      }).expect(201)
    ).body as { id: string };

    const mismatch = await post(user, `/investments/${apple.id}/contributions`, {
      amount: '100',
      accountId: brl.id,
    }).expect(422);
    expect(mismatch.body).toMatchObject({ code: 'currency_mismatch' });
    const onAccount = await post(user, '/investments', {
      assetClass: 'CDB',
      name: 'CDB',
      accountId: brl.id,
      currency: 'USD',
    }).expect(422);
    expect(onAccount.body).toMatchObject({ code: 'currency_mismatch' });
    await post(user, `/investments/${apple.id}/contributions`, {
      amount: '100',
      quantity: '1e3',
    }).expect(400);
    await post(user, `/investments/${apple.id}/contributions`, {
      amount: '100',
      quantity: '-1',
    }).expect(400);
    await post(user, `/investments/${apple.id}/contributions`, {
      amount: '100',
      categoryId: systemCategory.food,
    }).expect(422);

    const contribution = (
      (
        await post(user, `/investments/${apple.id}/contributions`, {
          amount: '100',
          quantity: '0.5',
        }).expect(201)
      ).body as { transaction: { id: string } }
    ).transaction;
    const typeChange = await patch(user, `/transactions/${contribution.id}`, {
      type: 'EXPENSE',
      categoryId: null,
    }).expect(422);
    expect(typeChange.body).toMatchObject({ code: 'investment_type_locked' });

    // Editing a contribution's amount changes the invested sum (always derived).
    await patch(user, `/transactions/${contribution.id}`, { amount: '120' }).expect(200);
    expect((await get(user, `/investments/${apple.id}`).expect(200)).body).toMatchObject({
      invested: '120.00',
      quantity: '0.5',
    });

    const inUse = await del(user, `/investments/${apple.id}`).expect(409);
    expect(inUse.body).toMatchObject({ code: 'investment_in_use' });
    await del(user, `/transactions/${contribution.id}`).expect(204);
    await del(user, `/investments/${apple.id}`).expect(204);
  });
});

// ─────────────────────────── Ownership and input ───────────────────────────

describe('ownership (IDOR) and mass assignment', () => {
  it('treats every plan of another user as missing', async () => {
    const alice = await newUser();
    const bob = await newUser();
    const aliceAccount = await account(alice);
    const purchase = (
      await post(alice, '/installments', {
        description: 'TV',
        totalAmount: '1200',
        installmentCount: 12,
        purchasedOn: '2026-03-01',
      }).expect(201)
    ).body as { id: string; parcels: Parcel[] };
    const recurrence = (
      await post(alice, '/recurring-transactions', {
        type: 'EXPENSE',
        description: 'Internet',
        amount: '120',
        frequency: 'MONTHLY',
        dayOfMonth: 10,
        startOn: '2026-01-01',
        endOn: '2026-03-31',
      }).expect(201)
    ).body as { id: string };
    const investment = (
      await post(alice, '/investments', { assetClass: 'ETF', name: 'BOVA11' }).expect(201)
    ).body as { id: string };

    await get(bob, `/installments/${purchase.id}`).expect(404);
    await del(bob, `/installments/${purchase.id}`).expect(404);
    await get(bob, `/recurring-transactions/${recurrence.id}`).expect(404);
    await patch(bob, `/recurring-transactions/${recurrence.id}`, { amount: '1' }).expect(
      404,
    );
    await del(bob, `/recurring-transactions/${recurrence.id}`).expect(404);
    await get(bob, `/investments/${investment.id}`).expect(404);
    await patch(bob, `/investments/${investment.id}`, { name: 'x' }).expect(404);
    await del(bob, `/investments/${investment.id}`).expect(404);
    await post(bob, `/investments/${investment.id}/contributions`, {
      amount: '1',
    }).expect(404);
    // Foreign references inside a body are also missing.
    await post(bob, '/installments', {
      description: 'x',
      totalAmount: '10',
      installmentCount: 2,
      purchasedOn: '2026-03-01',
      accountId: aliceAccount.id,
    }).expect(404);
    await post(bob, '/recurring-transactions', {
      type: 'EXPENSE',
      description: 'x',
      amount: '1',
      frequency: 'WEEKLY',
      accountId: aliceAccount.id,
    }).expect(404);
    await post(bob, '/investments', {
      assetClass: 'ETF',
      name: 'x',
      accountId: aliceAccount.id,
    }).expect(404);

    // Bob's queries never materialize nor show Alice's plans.
    await get(bob, '/transactions?from=2026-01-01&to=2026-12-31').expect(200);
    expect(await occurrencesOf(recurrence.id)).toHaveLength(0);
    expect((await get(bob, '/installments').expect(200)).body).toEqual([]);
    expect((await get(bob, '/recurring-transactions').expect(200)).body).toEqual([]);
    expect((await get(bob, '/investments').expect(200)).body).toEqual([]);
    expect(
      ((await get(bob, '/investments/summary').expect(200)).body as Json).currencies,
    ).toEqual([]);
    await get(bob, `/transactions/${purchase.parcels[0]?.id}`).expect(404);
  });

  it('refuses links and server-owned fields set by clients', async () => {
    const user = await newUser();
    const investment = (
      await post(user, '/investments', { assetClass: 'ETF', name: 'IVVB11' }).expect(201)
    ).body as { id: string };
    const purchase = (
      await post(user, '/installments', {
        description: 'TV',
        totalAmount: '100',
        installmentCount: 2,
        purchasedOn: '2026-03-01',
      }).expect(201)
    ).body as { id: string; parcels: Parcel[] };
    const base = {
      type: 'EXPENSE',
      description: 'x',
      amount: '1',
      occurredOn: '2026-03-01',
    };
    for (const field of [
      { investmentId: investment.id },
      { installmentId: purchase.id, installmentNumber: 3 },
      { recurringTransactionId: purchase.id },
      { recurrenceOccurrenceOn: '2026-03-01' },
    ]) {
      await post(user, '/transactions', { ...base, ...field }).expect(400);
    }
    await patch(user, `/transactions/${purchase.parcels[0]?.id}`, {
      installmentNumber: 9,
    }).expect(400);
    await post(user, '/installments', {
      description: 'x',
      totalAmount: '10',
      installmentCount: 2,
      purchasedOn: '2026-03-01',
      ownerId: user.id,
    }).expect(400);
    await post(user, '/recurring-transactions', {
      type: 'EXPENSE',
      description: 'x',
      amount: '1',
      frequency: 'WEEKLY',
      nextOccurrenceOn: '2020-01-01',
    }).expect(400);
    await patch(user, `/recurring-transactions/${investment.id}`, {
      frequency: 'WEEKLY',
    }).expect(400);
    await post(user, `/investments/${investment.id}/contributions`, {
      amount: '1',
      investmentId: investment.id,
    }).expect(400);
  });
});
