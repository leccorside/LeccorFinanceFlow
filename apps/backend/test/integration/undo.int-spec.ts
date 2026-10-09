import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ToolExecutor } from '../../src/assistant/tools/tool-executor.js';
import type { ToolOutcome } from '../../src/assistant/tools/tool.types.js';
import { seedDatabase } from '../../src/database/seed.js';
import {
  createDisposableDatabase,
  type DisposableDatabase,
} from './disposable-database.js';
import { FakeWorkspace } from './fake-workspace.js';
import {
  connectGoogle,
  createTestApp,
  defaultGrant,
  FakeGoogle,
  FakeGoogleOAuth,
  loginAs,
  type Session,
  testEnv,
} from './support.js';

let db: DisposableDatabase;
let app: NestExpressApplication;
let google: FakeGoogle;
let oauth: FakeGoogleOAuth;
let workspace: FakeWorkspace;

type Json = Record<string, unknown>;
interface Actor extends Session {
  id: string;
  email: string;
}

let sequence = 0;
async function newUser(): Promise<Actor> {
  sequence += 1;
  const email = `undo${sequence}@example.com`;
  oauth.grant = {
    ...defaultGrant(),
    subject: `gu-${sequence}`,
    accessToken: `undo-access-${sequence}`,
  };
  const session = await loginAs(app, google, {
    subject: `undo-${sequence}`,
    email,
    givenName: `P${sequence}`,
  });
  const user = await db.client.user.findUniqueOrThrow({ where: { email } });
  return { ...session, id: user.id, email };
}

function http(
  actor: Actor | null,
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
) {
  const req = request(app.getHttpServer())[method](`/api/v1${path}`);
  if (actor) {
    req.set('Cookie', actor.cookie);
    if (method !== 'get') req.set('X-CSRF-Token', actor.csrf);
  }
  return req;
}

const undo = async (actor: Actor) =>
  (await http(actor, 'post', '/assistant/undo').expect(200)).body as ToolOutcome & {
    data?: { undone: Json[] };
    error?: string;
  };

const run = (
  actor: Actor,
  name: string,
  args: Json = {},
  conversationId: string | null = null,
) =>
  app
    .get(ToolExecutor)
    .execute(
      { user: { id: actor.id, email: actor.email, roles: ['USER'] }, conversationId },
      { name, arguments: args },
    );

async function transaction(actor: Actor, body: Json = {}) {
  return (
    await http(actor, 'post', '/transactions')
      .send({
        type: 'EXPENSE',
        description: 'Mercado',
        amount: '10',
        occurredOn: '2026-10-01',
        ...body,
      })
      .expect(201)
  ).body as Json & { id: string; version: number };
}

const tx = (id: string) => db.client.transaction.findUnique({ where: { id } });
const confirm = (actor: Actor, id: string) =>
  http(actor, 'post', `/assistant/confirmations/${id}/confirm`);
const confirmationId = (outcome: ToolOutcome) =>
  (outcome as { confirmation: { id: string } }).confirmation.id;

beforeAll(async () => {
  db = await createDisposableDatabase();
  await seedDatabase(db.client);
  testEnv(db.url);
  google = new FakeGoogle();
  oauth = new FakeGoogleOAuth();
  workspace = new FakeWorkspace();
  app = await createTestApp(google, [], oauth, workspace);
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

beforeEach(() => {
  workspace.failOnce = {};
});

// ─────────────────────────────── Undo ───────────────────────────────

describe('undo of create, update and delete', () => {
  it('undoes step by step, newest first, and never redoes', async () => {
    const actor = await newUser();
    expect(await undo(actor)).toMatchObject({
      status: 'error',
      error: 'nothing_to_undo',
    });

    const created = await transaction(actor, { amount: '10' });
    await http(actor, 'patch', `/transactions/${created.id}`)
      .send({ amount: '20' })
      .expect(200);

    // 1st undo: the edit.
    expect(await undo(actor)).toMatchObject({
      status: 'ok',
      data: {
        undone: [
          {
            entityType: 'TRANSACTION',
            action: 'UPDATE',
            entityId: created.id,
            label: 'Mercado',
          },
        ],
      },
      sync: 'NO_SPREADSHEET',
    });
    const restored = await tx(created.id);
    expect(restored?.amount.toString()).toBe('10');
    expect(restored?.version).toBe(3);
    expect(restored?.syncStatus).toBe('PENDING_SYNC');

    // 2nd undo goes further back (the creation), it does not redo the edit.
    expect(await undo(actor)).toMatchObject({ data: { undone: [{ action: 'CREATE' }] } });
    expect(await tx(created.id)).toBeNull();
    expect(await undo(actor)).toMatchObject({ error: 'nothing_to_undo' });

    // The undo itself is in the history, as non-reversible audit rows.
    const history = await db.client.actionHistory.findMany({
      where: { ownerId: actor.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(
      history.map((row) => [
        row.action,
        row.revertedAt !== null,
        row.undoOfId !== null,
        row.isReversible,
      ]),
    ).toEqual([
      ['CREATE', true, false, true],
      ['UPDATE', true, false, true],
      ['UPDATE', false, true, false],
      ['DELETE', false, true, false],
    ]);
  });

  it('restores a deleted record with the same id', async () => {
    const actor = await newUser();
    const food = await db.client.category.findFirstOrThrow({
      where: { systemKey: 'food' },
    });
    const created = await transaction(actor, {
      amount: '87.45',
      categoryId: food.id,
      tags: ['casa'],
    });
    await http(actor, 'delete', `/transactions/${created.id}`).expect(204);
    expect(await undo(actor)).toMatchObject({
      data: { undone: [{ action: 'DELETE', entityId: created.id }] },
    });
    const back = await tx(created.id);
    expect(back).toMatchObject({
      description: 'Mercado',
      categoryId: food.id,
      tags: ['casa'],
      syncStatus: 'PENDING_SYNC',
      version: 2,
    });
    expect(back?.amount.toString()).toBe('87.45');
  });

  it('undoes one operation as a whole (a contribution: transaction + quantity)', async () => {
    const actor = await newUser();
    const btc = (
      await http(actor, 'post', '/investments')
        .send({ assetClass: 'CRYPTO', name: 'Bitcoin' })
        .expect(201)
    ).body as { id: string };
    await http(
      actor,
      'post',
      `/investments/${btc}/contributions`.replace(`${btc}`, btc.id),
    )
      .send({ amount: '1000', quantity: '0.5' })
      .expect(201);
    const outcome = await undo(actor);
    expect(
      outcome.data?.undone
        .map((item) => `${String(item.entityType)}:${String(item.action)}`)
        .sort(),
    ).toEqual(['INVESTMENT:UPDATE', 'TRANSACTION:CREATE']);
    const position = await db.client.investment.findUniqueOrThrow({
      where: { id: btc.id },
    });
    expect(position.quantity.toString()).toBe('0');
    expect(await db.client.transaction.count({ where: { ownerId: actor.id } })).toBe(0);
  });

  it('installments and recurrences come back with their parcels and occurrences', async () => {
    const actor = await newUser();
    const purchase = (
      await http(actor, 'post', '/installments')
        .send({
          description: 'TV',
          totalAmount: '1200',
          installmentCount: 12,
          purchasedOn: '2026-03-01',
        })
        .expect(201)
    ).body as { id: string; parcels: { id: string }[] };
    await http(actor, 'delete', `/installments/${purchase.id}`).expect(204);
    await undo(actor);
    expect(
      await db.client.transaction.count({ where: { installmentId: purchase.id } }),
    ).toBe(12);
    // A paid parcel blocks undoing the purchase; undoing the payment first frees it.
    await http(actor, 'patch', `/transactions/${purchase.parcels[0]?.id}`)
      .send({ status: 'COMPLETED' })
      .expect(200);
    expect(await undo(actor)).toMatchObject({ data: { undone: [{ action: 'UPDATE' }] } }); // the payment
    // A change made outside the history (e.g. a recurrence or another tool) blocks it.
    await db.client.transaction.update({
      where: { id: purchase.parcels[1]?.id as string },
      data: { notes: 'mudou fora do app' },
    });
    expect(await undo(actor)).toMatchObject({ error: 'undo_target_changed' });
    expect(await db.client.installment.count({ where: { id: purchase.id } })).toBe(1);
    await db.client.transaction.update({
      where: { id: purchase.parcels[1]?.id as string },
      data: { notes: null },
    });
    expect(await undo(actor)).toMatchObject({ data: { undone: [{ action: 'CREATE' }] } });
    expect(await db.client.installment.count({ where: { id: purchase.id } })).toBe(0);
    expect(
      await db.client.transaction.count({ where: { installmentId: purchase.id } }),
    ).toBe(0);

    const other = await newUser();
    const rule = (
      await http(other, 'post', '/recurring-transactions')
        .send({
          type: 'EXPENSE',
          description: 'Aluguel',
          amount: '2500',
          frequency: 'MONTHLY',
          dayOfMonth: 5,
          startOn: '2026-01-01',
          endOn: '2026-03-31',
        })
        .expect(201)
    ).body as { id: string };
    await http(other, 'get', '/transactions?from=2026-01-01&to=2026-12-31').expect(200);
    await http(other, 'delete', `/recurring-transactions/${rule.id}`).expect(204);
    await undo(other);
    expect(await db.client.recurringTransaction.count({ where: { id: rule.id } })).toBe(
      1,
    );
  });
});

describe('when undo is not possible, it is explained and nothing changes', () => {
  it('a record changed outside the history is not overwritten', async () => {
    const actor = await newUser();
    const created = await transaction(actor);
    await db.client.transaction.update({
      where: { id: created.id },
      data: { description: 'Mudou' },
    });
    const outcome = await undo(actor);
    expect(outcome).toMatchObject({ status: 'error', error: 'undo_target_changed' });
    expect((await tx(created.id))?.description).toBe('Mudou');
    expect(
      (
        await db.client.actionHistory.findFirstOrThrow({
          where: { entityId: created.id },
        })
      ).revertedAt,
    ).toBeNull();
  });

  it('references that appeared meanwhile stop the undo (and roll it back)', async () => {
    const actor = await newUser();
    const account = (
      await http(actor, 'post', '/accounts')
        .send({ type: 'CASH', name: 'Carteira' })
        .expect(201)
    ).body as { id: string };
    await db.client.transaction.create({
      data: {
        ownerId: actor.id,
        type: 'EXPENSE',
        status: 'PENDING',
        description: 'x',
        amount: '1',
        occurredOn: new Date('2026-10-01'),
        accountId: account.id,
      },
    });
    expect(await undo(actor)).toMatchObject({ error: 'undo_not_possible' });
    expect(await db.client.financialAccount.count({ where: { id: account.id } })).toBe(1);
    expect(
      (
        await db.client.actionHistory.findFirstOrThrow({
          where: { entityId: account.id },
        })
      ).revertedAt,
    ).toBeNull();
  });

  it('an irreversible action is explained', async () => {
    const actor = await newUser();
    const created = await transaction(actor);
    await db.client.actionHistory.updateMany({
      where: { entityId: created.id },
      data: { isReversible: false },
    });
    expect(await undo(actor)).toMatchObject({
      error: 'undo_irreversible',
      message: expect.stringMatching(/não pode ser desfeita/),
    });
    expect(await tx(created.id)).not.toBeNull();
  });

  it('two simultaneous undos never revert the same action twice', async () => {
    const actor = await newUser();
    const created = await transaction(actor);
    const results = await Promise.all([undo(actor), undo(actor), undo(actor)]);
    expect(results.filter((item) => item.status === 'ok')).toHaveLength(1);
    expect(
      results
        .filter((item) => item.status !== 'ok')
        .every((item) =>
          ['undo_in_progress', 'nothing_to_undo'].includes(item.error as string),
        ),
    ).toBe(true);
    expect(await tx(created.id)).toBeNull();
    expect(
      await db.client.actionHistory.count({
        where: { ownerId: actor.id, undoOfId: { not: null } },
      }),
    ).toBe(1);
  });

  it("never touches another user's history", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const created = await transaction(alice);
    expect(await undo(bob)).toMatchObject({ error: 'nothing_to_undo' });
    expect(await tx(created.id)).not.toBeNull();
  });
});

describe('undo through the assistant and the spreadsheet', () => {
  it('records the conversation and syncs the reversal to the sheet', async () => {
    const actor = await newUser();
    await connectGoogle(app, actor);
    const sheet = (await http(actor, 'post', '/spreadsheets').send({}).expect(200))
      .body as { googleSpreadsheetId: string };
    const conversation = await db.client.conversation.create({
      data: { ownerId: actor.id },
    });
    const created = (await run(
      actor,
      'create_transaction',
      { type: 'EXPENSE', description: 'Padaria', amount: '12' },
      conversation.id,
    )) as ToolOutcome & { data: { id: string } };
    expect(created).toMatchObject({ status: 'ok', sync: 'SYNCED' });
    expect(
      workspace
        .rows(sheet.googleSpreadsheetId, 'transactions')
        .map((row) => row.values.record_id),
    ).toContain(created.data.id);

    const undone = await run(actor, 'undo_last_action', {}, conversation.id);
    expect(undone).toMatchObject({ status: 'ok', sync: 'SYNCED' });
    expect(workspace.rows(sheet.googleSpreadsheetId, 'transactions')).toHaveLength(0);
    const audit = await db.client.actionHistory.findFirstOrThrow({
      where: { undoOfId: { not: null }, ownerId: actor.id },
    });
    expect(audit.conversationId).toBe(conversation.id);
  });
});

// ──────────────────────── Configurable confirmation ────────────────────────

describe('confirmation of simple deletions is configurable', () => {
  it('runs an unambiguous transaction deletion directly when turned off; the rest still asks', async () => {
    const actor = await newUser();
    const one = await transaction(actor, { description: 'Café', amount: '5' });
    await transaction(actor, { description: 'Mercado', amount: '120' });
    await transaction(actor, { description: 'Mercado', amount: '187' });
    expect(
      await run(actor, 'delete_transaction', { transactionId: one.id }),
    ).toMatchObject({ status: 'confirmation_required' });

    await http(actor, 'patch', '/profile')
      .send({ preferences: { confirmSimpleDeletes: false } })
      .expect(200);
    expect(
      await run(actor, 'delete_transaction', { transactionId: one.id }),
    ).toMatchObject({ status: 'ok', data: { deleted: { description: 'Café' } } });
    expect(await tx(one.id)).toBeNull();
    // Ambiguity still never deletes; other kinds still ask.
    expect(
      await run(actor, 'delete_transaction', { match: { text: 'mercado' } }),
    ).toMatchObject({ status: 'ambiguous' });
    const account = (
      await http(actor, 'post', '/accounts')
        .send({ type: 'CASH', name: 'Cofre' })
        .expect(201)
    ).body as { id: string };
    expect(await run(actor, 'delete_account', { accountId: account.id })).toMatchObject({
      status: 'confirmation_required',
    });
    // And the immediate deletion can be undone (the account creation is newer: undo it first).
    await undo(actor);
    await undo(actor);
    expect(await tx(one.id)).not.toBeNull();
  });
});

// ─────────────────────────── High-impact deletions ───────────────────────────

describe('high-impact deletions', () => {
  const ask = async (actor: Actor, body: Json) =>
    (await http(actor, 'post', '/assistant/data-deletions').send(body).expect(200))
      .body as ToolOutcome & {
      confirmation: { id: string; summary: Json };
    };

  it('conversation history: confirmed, single use, stale when it changes, scoped to the user', async () => {
    const actor = await newUser();
    const other = await newUser();
    const first = await db.client.conversation.create({ data: { ownerId: actor.id } });
    await db.client.conversationMessage.create({
      data: { conversationId: first.id, role: 'USER', content: 'Oi' },
    });
    const theirs = await db.client.conversation.create({ data: { ownerId: other.id } });

    const asked = await ask(actor, { scope: 'conversations' });
    expect(asked).toMatchObject({
      status: 'confirmation_required',
      tool: 'delete_conversation_history',
      confirmation: {
        summary: {
          scope: 'all_conversations',
          conversations: 1,
          messages: 1,
          irreversible: true,
        },
      },
    });
    await db.client.conversation.create({ data: { ownerId: actor.id } }); // the target changed
    expect((await confirm(actor, asked.confirmation.id).expect(409)).body).toMatchObject({
      code: 'confirmation_stale',
    });

    const again = await ask(actor, { scope: 'conversations' });
    await confirm(other, again.confirmation.id).expect(404);
    expect((await confirm(actor, again.confirmation.id).expect(200)).body).toMatchObject({
      status: 'ok',
      data: { deleted: { conversations: 2 } },
    });
    expect((await confirm(actor, again.confirmation.id).expect(409)).body).toMatchObject({
      code: 'confirmation_used',
    });
    expect(await db.client.conversation.count({ where: { ownerId: actor.id } })).toBe(0);
    expect(await db.client.conversation.count({ where: { id: theirs.id } })).toBe(1);
    expect(
      await ask(actor, { scope: 'conversations', conversationId: theirs.id }),
    ).toMatchObject({ status: 'error', error: 'not_found' });
  });

  it('deleting the conversation it was asked in still answers (nothing left to store it in)', async () => {
    const actor = await newUser();
    const conversation = await db.client.conversation.create({
      data: { ownerId: actor.id },
    });
    const asked = await run(
      actor,
      'delete_conversation_history',
      { conversationId: conversation.id },
      conversation.id,
    );
    const turn = (
      await http(
        actor,
        'post',
        `/assistant/conversations/${conversation.id}/confirmations/${confirmationId(asked)}/confirm`,
      ).expect(200)
    ).body as Json;
    expect(turn).toMatchObject({
      state: 'answered',
      reply: { id: '', content: 'Pronto. Apaguei 1 conversa(s) do histórico.' },
    });
    expect(await db.client.conversation.count({ where: { id: conversation.id } })).toBe(
      0,
    );
  });

  it('financial data: everything of the user goes, system categories and other users stay', async () => {
    const actor = await newUser();
    const other = await newUser();
    await transaction(actor);
    await http(actor, 'post', '/accounts')
      .send({ type: 'CASH', name: 'Carteira' })
      .expect(201);
    await http(actor, 'post', '/categories')
      .send({ name: 'Pets', kind: 'EXPENSE' })
      .expect(201);
    await http(actor, 'post', '/installments')
      .send({
        description: 'TV',
        totalAmount: '100',
        installmentCount: 2,
        purchasedOn: '2026-03-01',
      })
      .expect(201);
    const kept = await transaction(other);
    const systemCategories = await db.client.category.count({ where: { ownerId: null } });

    const asked = await ask(actor, { scope: 'financial_data' });
    expect(asked.confirmation.summary).toMatchObject({
      transactions: 3,
      accounts: 1,
      installments: 1,
      irreversible: true,
      spreadsheetUntouched: true,
    });
    expect((await confirm(actor, asked.confirmation.id).expect(200)).body).toMatchObject({
      status: 'ok',
      data: { deleted: { transactions: 3, accounts: 1, installments: 1, categories: 1 } },
    });
    for (const count of await Promise.all([
      db.client.transaction.count({ where: { ownerId: actor.id } }),
      db.client.financialAccount.count({ where: { ownerId: actor.id } }),
      db.client.category.count({ where: { ownerId: actor.id } }),
      db.client.installment.count({ where: { ownerId: actor.id } }),
      db.client.actionHistory.count({ where: { ownerId: actor.id } }),
    ])) {
      expect(count).toBe(0);
    }
    expect(await db.client.category.count({ where: { ownerId: null } })).toBe(
      systemCategories,
    );
    expect(await tx(kept.id)).not.toBeNull();
    expect(await undo(actor)).toMatchObject({ error: 'nothing_to_undo' });
  });

  it('spreadsheet: goes to the Drive trash first; a Google failure deletes nothing', async () => {
    const actor = await newUser();
    await connectGoogle(app, actor);
    const sheet = (await http(actor, 'post', '/spreadsheets').send({}).expect(200))
      .body as { id: string; googleSpreadsheetId: string; name: string };
    const kept = await transaction(actor);
    expect(
      (await db.client.transaction.findUniqueOrThrow({ where: { id: kept.id } }))
        .spreadsheetId,
    ).toBe(sheet.id);

    const failing = await ask(actor, { scope: 'spreadsheet' });
    expect(failing.confirmation.summary).toMatchObject({
      id: sheet.id,
      name: sheet.name,
      googleDriveTrash: true,
    });
    workspace.failOnce.trash = 'unavailable';
    expect(
      (await confirm(actor, failing.confirmation.id).expect(200)).body,
    ).toMatchObject({ status: 'error', error: 'google_unavailable' });
    expect(await db.client.spreadsheet.count({ where: { id: sheet.id } })).toBe(1);

    const asked = await ask(actor, { scope: 'spreadsheet', spreadsheetId: sheet.id });
    expect((await confirm(actor, asked.confirmation.id).expect(200)).body).toMatchObject({
      status: 'ok',
      data: { deleted: { name: sheet.name }, trashedInGoogleDrive: true },
    });
    expect(workspace.files.get(sheet.googleSpreadsheetId)?.deleted).toBe(true);
    expect(await db.client.spreadsheet.count({ where: { id: sheet.id } })).toBe(0);
    expect((await tx(kept.id))?.spreadsheetId).toBeNull(); // financial data stays
  });

  it('account: the user, sessions and data go; Google is revoked; others stay', async () => {
    const actor = await newUser();
    const other = await newUser();
    await connectGoogle(app, actor);
    await transaction(actor);
    const theirs = await transaction(other);
    const asked = await ask(actor, { scope: 'account' });
    expect(asked.confirmation.summary).toMatchObject({
      email: actor.email,
      transactions: 1,
      irreversible: true,
      spreadsheetsStayInGoogleDrive: true,
    });
    expect((await confirm(actor, asked.confirmation.id).expect(200)).body).toMatchObject({
      status: 'ok',
      data: { deleted: { account: true }, googleRevocation: 'revoked' },
    });
    expect(await db.client.user.count({ where: { id: actor.id } })).toBe(0);
    expect(await db.client.transaction.count({ where: { ownerId: actor.id } })).toBe(0);
    await http(actor, 'get', '/auth/me').expect(401);
    expect(await tx(theirs.id)).not.toBeNull();
  });

  it('expired confirmations never run, and the request is validated', async () => {
    const actor = await newUser();
    const asked = await ask(actor, { scope: 'financial_data' });
    await db.client.assistantConfirmation.update({
      where: { id: asked.confirmation.id },
      data: {
        createdAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await confirm(actor, asked.confirmation.id).expect(410);
    for (const body of [
      { scope: 'everything' },
      { scope: 'conversations', spreadsheetId: actor.id },
      { scope: 'account', confirmed: true },
    ]) {
      await http(actor, 'post', '/assistant/data-deletions').send(body).expect(400);
    }
    await request(app.getHttpServer())
      .post('/api/v1/assistant/data-deletions')
      .send({ scope: 'account' })
      .expect(401);
    expect(await db.client.user.count({ where: { id: actor.id } })).toBe(1);
  });
});
