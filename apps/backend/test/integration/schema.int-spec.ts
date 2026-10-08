import { Prisma } from '../../src/generated/prisma/client.js';
import { seedDatabase } from '../../src/database/seed.js';
import { DEFAULT_CATEGORIES } from '../../src/database/seed-data.js';
import {
  createDisposableDatabase,
  type DisposableDatabase,
} from './disposable-database.js';

let db: DisposableDatabase;

beforeAll(async () => {
  db = await createDisposableDatabase();
});

afterAll(async () => {
  await db?.drop();
});

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function createUser(email: string) {
  return db.client.user.create({ data: { email } });
}

describe('seed', () => {
  it('is idempotent', async () => {
    await seedDatabase(db.client);
    await seedDatabase(db.client);

    expect(await db.client.role.count()).toBe(2);
    expect(await db.client.category.count({ where: { ownerId: null } })).toBe(
      DEFAULT_CATEGORIES.length,
    );
  });
});

describe('Decimal precision', () => {
  it('round-trips money and quantities exactly and sums without float error', async () => {
    const user = await createUser('decimal@example.com');
    const values = ['0.1', '0.2', '123456789012345.1234'];

    for (const amount of values) {
      await db.client.transaction.create({
        data: {
          ownerId: user.id,
          type: 'EXPENSE',
          description: `valor ${amount}`,
          amount,
          occurredOn: day('2026-10-01'),
        },
      });
    }

    const stored = await db.client.transaction.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(stored.map((row) => row.amount.toFixed(4))).toEqual([
      '0.1000',
      '0.2000',
      '123456789012345.1234',
    ]);

    const sum = await db.client.transaction.aggregate({
      where: { ownerId: user.id },
      _sum: { amount: true },
    });
    expect(sum._sum.amount?.toFixed(4)).toBe('123456789012345.4234');

    const investment = await db.client.investment.create({
      data: {
        ownerId: user.id,
        assetClass: 'CRYPTO',
        name: 'Bitcoin',
        symbol: 'BTC',
        quantity: '0.0000012345',
        totalCost: '1000',
      },
    });
    expect(investment.quantity.toFixed(10)).toBe('0.0000012345');
    expect(investment.quantity).toBeInstanceOf(Prisma.Decimal);
  });
});

describe('CHECK constraints', () => {
  let ownerId: string;
  let checkingId: string;

  beforeAll(async () => {
    const user = await createUser('checks@example.com');
    ownerId = user.id;
    const account = await db.client.financialAccount.create({
      data: { ownerId, type: 'CHECKING', name: 'Conta' },
    });
    checkingId = account.id;
  });

  const base = () => ({
    ownerId,
    type: 'EXPENSE' as const,
    description: 'teste',
    amount: '10',
    occurredOn: day('2026-10-01'),
  });

  it.each([
    ['zero amount', { amount: '0' }],
    ['negative amount', { amount: '-5' }],
    ['lower-case currency', { currency: 'brl' }],
    ['COMPLETED without paidOn', { status: 'COMPLETED' as const }],
    ['TRANSFER without destination', { type: 'TRANSFER' as const }],
    ['installment number without installment', { installmentNumber: 1 }],
  ])('rejects a transaction with %s', async (_label, override) => {
    await expect(
      db.client.transaction.create({ data: { ...base(), ...override } }),
    ).rejects.toThrow();
  });

  it('rejects a transfer to the same account', async () => {
    await expect(
      db.client.transaction.create({
        data: {
          ...base(),
          type: 'TRANSFER',
          accountId: checkingId,
          transferAccountId: checkingId,
        },
      }),
    ).rejects.toThrow();
  });

  it('accepts a COMPLETED transaction with paidOn', async () => {
    await expect(
      db.client.transaction.create({
        data: { ...base(), status: 'COMPLETED', paidOn: day('2026-10-01') },
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('rejects a non-normalized e-mail', async () => {
    await expect(createUser('Upper@Example.com')).rejects.toThrow();
    await expect(createUser(' spaced@example.com')).rejects.toThrow();
  });

  it('rejects credit card fields on a non-card account and invalid days', async () => {
    await expect(
      db.client.financialAccount.create({
        data: { ownerId, type: 'CHECKING', name: 'Errada', dueDay: 10 },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.financialAccount.create({
        data: { ownerId, type: 'CREDIT_CARD', name: 'Cartão', dueDay: 32 },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.financialAccount.create({
        data: { ownerId, type: 'CREDIT_CARD', name: 'Nubank', dueDay: 10, closingDay: 3 },
      }),
    ).resolves.toMatchObject({ dueDay: 10 });
  });

  it('allows only one active spreadsheet per owner', async () => {
    await db.client.spreadsheet.create({
      data: { ownerId, name: 'Pessoal', isActive: true },
    });
    await expect(
      db.client.spreadsheet.create({ data: { ownerId, name: 'Casa', isActive: true } }),
    ).rejects.toThrow();
    await expect(
      db.client.spreadsheet.create({
        data: { ownerId, name: 'Viagem', isActive: false },
      }),
    ).resolves.toMatchObject({ isActive: false });
  });

  it('requires an interval unit exactly for CUSTOM recurrences', async () => {
    const recurrence = {
      ownerId,
      type: 'EXPENSE' as const,
      description: 'Internet',
      amount: '120',
      startOn: day('2026-10-10'),
      nextOccurrenceOn: day('2026-10-10'),
    };

    await expect(
      db.client.recurringTransaction.create({
        data: { ...recurrence, frequency: 'CUSTOM' },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.recurringTransaction.create({
        data: { ...recurrence, frequency: 'MONTHLY', intervalUnit: 'DAY' },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.recurringTransaction.create({
        data: {
          ...recurrence,
          frequency: 'CUSTOM',
          intervalCount: 3,
          intervalUnit: 'WEEK',
        },
      }),
    ).resolves.toMatchObject({ intervalCount: 3 });
  });

  it('keeps installment numbers unique per purchase', async () => {
    const installment = await db.client.installment.create({
      data: {
        ownerId,
        description: 'TV',
        totalAmount: '3600',
        installmentCount: 12,
        purchasedOn: day('2026-10-01'),
        firstDueOn: day('2026-11-10'),
      },
    });
    const parcel = {
      ...base(),
      amount: '300',
      installmentId: installment.id,
      installmentNumber: 1,
    };

    await db.client.transaction.create({ data: parcel });
    await expect(db.client.transaction.create({ data: parcel })).rejects.toThrow();
  });

  it('materializes each recurrence occurrence at most once', async () => {
    const recurrence = await db.client.recurringTransaction.create({
      data: {
        ownerId,
        type: 'EXPENSE',
        description: 'Aluguel',
        amount: '2500',
        frequency: 'MONTHLY',
        dayOfMonth: 5,
        startOn: day('2026-10-05'),
        nextOccurrenceOn: day('2026-10-05'),
      },
    });
    const occurrence = {
      ...base(),
      amount: '2500',
      recurringTransactionId: recurrence.id,
      recurrenceOccurrenceOn: day('2026-10-05'),
    };

    await db.client.transaction.create({ data: occurrence });
    await expect(db.client.transaction.create({ data: occurrence })).rejects.toThrow();
  });

  it('enforces ActionHistory snapshot shape per action', async () => {
    const entityId = ownerId;
    await expect(
      db.client.actionHistory.create({
        data: {
          ownerId,
          entityType: 'TRANSACTION',
          entityId,
          action: 'CREATE',
          beforeState: { amount: '1' },
          afterState: { amount: '2' },
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.actionHistory.create({
        data: {
          ownerId,
          entityType: 'TRANSACTION',
          entityId,
          action: 'UPDATE',
          afterState: {},
        },
      }),
    ).rejects.toThrow();
  });

  it('requires owner XOR systemKey on categories', async () => {
    await expect(
      db.client.category.create({
        data: { ownerId, systemKey: 'hack', kind: 'EXPENSE', name: 'Hack' },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.category.create({ data: { kind: 'EXPENSE', name: 'Sem dono' } }),
    ).rejects.toThrow();
  });
});

describe('owner isolation', () => {
  let alice: { id: string };
  let bob: { id: string };
  let bobAccountId: string;
  let bobCategoryId: string;
  let bobSpreadsheetId: string;

  beforeAll(async () => {
    alice = await createUser('alice@example.com');
    bob = await createUser('bob@example.com');
    bobAccountId = (
      await db.client.financialAccount.create({
        data: { ownerId: bob.id, type: 'CHECKING', name: 'Bob' },
      })
    ).id;
    bobCategoryId = (
      await db.client.category.create({
        data: { ownerId: bob.id, kind: 'EXPENSE', name: 'Pets' },
      })
    ).id;
    bobSpreadsheetId = (
      await db.client.spreadsheet.create({ data: { ownerId: bob.id, name: 'Bob' } })
    ).id;
  });

  const aliceTransaction = () => ({
    ownerId: alice.id,
    type: 'EXPENSE' as const,
    description: 'cruzado',
    amount: '1',
    occurredOn: day('2026-10-01'),
  });

  it.each([
    ['account', () => ({ accountId: bobAccountId })],
    ['category', () => ({ categoryId: bobCategoryId })],
    ['spreadsheet', () => ({ spreadsheetId: bobSpreadsheetId })],
  ])("rejects a transaction pointing to another user's %s", async (_label, refs) => {
    await expect(
      db.client.transaction.create({ data: { ...aliceTransaction(), ...refs() } }),
    ).rejects.toThrow(/owner mismatch/);
  });

  it('rejects re-pointing an existing row to another user via UPDATE', async () => {
    const own = await db.client.transaction.create({ data: aliceTransaction() });
    await expect(
      db.client.transaction.update({
        where: { id: own.id },
        data: { accountId: bobAccountId },
      }),
    ).rejects.toThrow(/owner mismatch/);
  });

  it('rejects a user subcategory under another user category', async () => {
    await expect(
      db.client.category.create({
        data: {
          ownerId: alice.id,
          parentId: bobCategoryId,
          kind: 'EXPENSE',
          name: 'Gato',
        },
      }),
    ).rejects.toThrow(/owner mismatch/);
  });

  it('allows system categories for any user', async () => {
    await seedDatabase(db.client);
    const food = await db.client.category.findUniqueOrThrow({
      where: { systemKey: 'food' },
    });

    await expect(
      db.client.transaction.create({
        data: { ...aliceTransaction(), categoryId: food.id },
      }),
    ).resolves.toMatchObject({ categoryId: food.id });
    await expect(
      db.client.category.create({
        data: { ownerId: alice.id, parentId: food.id, kind: 'EXPENSE', name: 'Delivery' },
      }),
    ).resolves.toMatchObject({ parentId: food.id });
  });

  it('forbids changing owner_id of an owned row', async () => {
    await expect(
      db.client.financialAccount.update({
        where: { id: bobAccountId },
        data: { ownerId: alice.id },
      }),
    ).rejects.toThrow(/owner_id is immutable/);
  });

  it('deleting a user removes all of their data and nothing else', async () => {
    const carol = await createUser('carol@example.com');
    const account = await db.client.financialAccount.create({
      data: { ownerId: carol.id, type: 'CREDIT_CARD', name: 'Cartão', dueDay: 5 },
    });
    const category = await db.client.category.create({
      data: { ownerId: carol.id, kind: 'EXPENSE', name: 'Própria' },
    });
    const spreadsheet = await db.client.spreadsheet.create({
      data: { ownerId: carol.id, name: 'Carol', isActive: true },
    });
    const installment = await db.client.installment.create({
      data: {
        ownerId: carol.id,
        spreadsheetId: spreadsheet.id,
        accountId: account.id,
        categoryId: category.id,
        description: 'Geladeira',
        totalAmount: '2000',
        installmentCount: 2,
        purchasedOn: day('2026-10-01'),
        firstDueOn: day('2026-10-05'),
      },
    });
    await db.client.transaction.create({
      data: {
        ownerId: carol.id,
        spreadsheetId: spreadsheet.id,
        accountId: account.id,
        categoryId: category.id,
        installmentId: installment.id,
        installmentNumber: 1,
        type: 'EXPENSE',
        description: 'Geladeira 1/2',
        amount: '1000',
        occurredOn: day('2026-10-01'),
      },
    });
    const conversation = await db.client.conversation.create({
      data: { ownerId: carol.id, spreadsheetId: spreadsheet.id },
    });
    await db.client.conversationMessage.create({
      data: { conversationId: conversation.id, role: 'USER', content: 'oi' },
    });
    const bobTransactionsBefore = await db.client.transaction.count({
      where: { ownerId: bob.id },
    });

    await db.client.user.delete({ where: { id: carol.id } });

    const [remaining] = await db.query<{ total: string }>(
      `SELECT (
         (SELECT count(*) FROM financial_accounts WHERE owner_id = '${carol.id}') +
         (SELECT count(*) FROM categories WHERE owner_id = '${carol.id}') +
         (SELECT count(*) FROM spreadsheets WHERE owner_id = '${carol.id}') +
         (SELECT count(*) FROM installments WHERE owner_id = '${carol.id}') +
         (SELECT count(*) FROM transactions WHERE owner_id = '${carol.id}') +
         (SELECT count(*) FROM conversations WHERE owner_id = '${carol.id}') +
         (SELECT count(*) FROM conversation_messages WHERE conversation_id = '${conversation.id}')
       )::text AS total`,
    );
    expect(remaining?.total).toBe('0');
    expect(await db.client.transaction.count({ where: { ownerId: bob.id } })).toBe(
      bobTransactionsBefore,
    );
  });
});
