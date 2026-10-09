import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { ToolOutcome } from '../../src/assistant/tools/tool.types.js';
import { seedDatabase } from '../../src/database/seed.js';
import { RETENTION, RetentionService } from '../../src/retention/retention.service.js';
import {
  createDisposableDatabase,
  type DisposableDatabase,
} from './disposable-database.js';
import {
  connectGoogle,
  createTestApp,
  defaultGrant,
  FakeGoogle,
  FakeGoogleOAuth,
  FRONTEND,
  loginAs,
  type Session,
  testEnv,
} from './support.js';

let db: DisposableDatabase;
let app: NestExpressApplication;
let google: FakeGoogle;
let oauth: FakeGoogleOAuth;
let reportsDir: string;

const ROOT_EMAIL = 'privacy-root@example.com';
const DAY = 86_400_000;

type Json = Record<string, unknown>;
interface Actor extends Session {
  id: string;
  email: string;
}

let sequence = 0;
async function newUser(email?: string, target = app): Promise<Actor> {
  sequence += 1;
  const address = email ?? `priv${sequence}@example.com`;
  oauth.grant = {
    ...defaultGrant(),
    subject: `gp-${sequence}`,
    accessToken: `priv-access-${sequence}`,
    refreshToken: `priv-refresh-${sequence}`,
  };
  const session = await loginAs(target, google, {
    subject: `priv-${address}`,
    email: address,
  });
  const user = await db.client.user.findUniqueOrThrow({ where: { email: address } });
  return { ...session, id: user.id, email: address };
}

function http(
  actor: Actor | null,
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  target = app,
) {
  const req = request(target.getHttpServer())[method](`/api/v1${path}`);
  if (actor) {
    req.set('Cookie', actor.cookie);
    if (method !== 'get') req.set('X-CSRF-Token', actor.csrf);
  }
  return req;
}

async function populate(actor: Actor): Promise<void> {
  await http(actor, 'patch', '/profile')
    .send({ firstName: 'Ana', lastName: 'Souza', timeZone: 'America/Sao_Paulo' })
    .expect(200);
  await http(actor, 'post', '/accounts')
    .send({ type: 'CASH', name: 'Carteira' })
    .expect(201);
  await http(actor, 'post', '/categories')
    .send({ name: 'Pets', kind: 'EXPENSE' })
    .expect(201);
  await http(actor, 'post', '/transactions')
    .send({
      type: 'EXPENSE',
      description: 'Ração',
      amount: '89.90',
      occurredOn: '2026-03-10',
    })
    .expect(201);
  await http(actor, 'post', '/installments')
    .send({
      description: 'TV',
      totalAmount: '100',
      installmentCount: 2,
      purchasedOn: '2026-03-01',
    })
    .expect(201);
  const conversation = await db.client.conversation.create({
    data: { ownerId: actor.id, title: 'Gastos de março' },
  });
  await db.client.conversationMessage.create({
    data: { conversationId: conversation.id, role: 'USER', content: 'Quanto gastei?' },
  });
  await http(actor, 'post', '/reports')
    .send({ type: 'MONTHLY', format: 'PDF', month: '2026-03' })
    .expect(201);
}

const ask = async (actor: Actor, body: Json) =>
  (await http(actor, 'post', '/assistant/data-deletions').send(body).expect(200))
    .body as ToolOutcome & { confirmation: { id: string; summary: Json } };
const confirm = (actor: Actor, id: string) =>
  http(actor, 'post', `/assistant/confirmations/${id}/confirm`);

/** Rows in ANY table that still point at `userId` (generic: catches tables added later). */
async function referencesTo(userId: string): Promise<string[]> {
  const columns = await db.client.$queryRawUnsafe<
    { table_name: string; column_name: string }[]
  >(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name IN ('owner_id', 'user_id', 'actor_id', 'target_user_id', 'updated_by_id')`,
  );
  const found: string[] = [];
  for (const { table_name, column_name } of columns) {
    const rows = await db.client.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "${table_name}" WHERE "${column_name}"::text = $1`,
      userId,
    );
    if (Number(rows[0]?.n ?? 0) > 0) found.push(`${table_name}.${column_name}`);
  }
  return found;
}

beforeAll(async () => {
  db = await createDisposableDatabase();
  await seedDatabase(db.client);
  reportsDir = mkdtempSync(join(tmpdir(), 'leccor-privacy-'));
  testEnv(db.url, { REPORT_TEMP_DIRECTORY: reportsDir, ADMIN_EMAILS: ROOT_EMAIL });
  google = new FakeGoogle();
  oauth = new FakeGoogleOAuth();
  app = await createTestApp(google, [], oauth);
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
  rmSync(reportsDir, { recursive: true, force: true });
  delete process.env.REPORT_TEMP_DIRECTORY;
  delete process.env.ADMIN_EMAILS;
});

beforeEach(() => {
  oauth.revokeResult = true;
});

// ─────────────────────────────── Export ───────────────────────────────

describe('data export', () => {
  it('downloads only the requester data, as an attachment, without secrets', async () => {
    const actor = await newUser();
    const other = await newUser();
    await connectGoogle(app, actor);
    await populate(actor);
    await http(other, 'post', '/transactions')
      .send({
        type: 'EXPENSE',
        description: 'Segredo alheio',
        amount: '1',
        occurredOn: '2026-03-01',
      })
      .expect(201);

    const response = await http(actor, 'get', '/privacy/export').expect(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="leccor-meus-dados-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(response.headers['cache-control']).toBe('no-store');

    const data = JSON.parse(response.text) as Json & {
      account: Json & { profile: Json; googleConnection: Json; roles: Json[] };
      transactions: Json[];
      conversations: (Json & { messages: Json[] })[];
      reports: Json[];
      sessions: Json[];
    };
    expect(data).toMatchObject({
      format: 'leccor-finance-flow/export@1',
      account: {
        id: actor.id,
        email: actor.email,
        roles: [{ role: 'USER' }],
        profile: { firstName: 'Ana', lastName: 'Souza' },
        googleConnection: { status: 'ACTIVE' },
      },
    });
    expect(data.transactions.map((t) => t.description).sort()).toEqual([
      'Ração',
      'TV',
      'TV',
    ]);
    expect(data.transactions.find((t) => t.description === 'Ração')).toMatchObject({
      amount: '89.9',
    });
    expect(data.conversations[0]?.messages[0]).toMatchObject({
      content: 'Quanto gastei?',
    });
    expect(data.reports).toHaveLength(1);
    expect(data.sessions.length).toBeGreaterThan(0);

    const text = response.text;
    expect(text).not.toContain('Segredo alheio');
    expect(text).not.toContain(other.id);
    for (const secret of [
      actor.access,
      actor.refresh,
      actor.csrf,
      'priv-access-',
      'priv-refresh-',
      'Encrypted',
      'Hash',
      'csrf',
      'storageKey',
      'ownerId',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('requires a session', async () => {
    await http(null, 'get', '/privacy/export').expect(401);
  });
});

// ─────────────────────────────── Deletion ───────────────────────────────

describe('deletion', () => {
  it('financial data also removes the reports and their files', async () => {
    const actor = await newUser();
    await populate(actor);
    expect(existsSync(join(reportsDir, actor.id))).toBe(true);

    const asked = await ask(actor, { scope: 'financial_data' });
    expect((await confirm(actor, asked.confirmation.id).expect(200)).body).toMatchObject({
      status: 'ok',
      data: { deleted: { reports: 1 }, reportFiles: 'removed' },
    });
    expect(await db.client.report.count({ where: { ownerId: actor.id } })).toBe(0);
    expect(existsSync(join(reportsDir, actor.id))).toBe(false);
    // The account itself stays.
    await http(actor, 'get', '/auth/me').expect(200);
  });

  it('account: integral, with no orphan reference anywhere, and Google revoked', async () => {
    const actor = await newUser();
    const other = await newUser();
    await connectGoogle(app, actor);
    await populate(actor);
    await populate(other);
    const revokesBefore = oauth.revokeCalls.length;
    expect(await referencesTo(actor.id)).not.toEqual([]);

    const asked = await ask(actor, { scope: 'account' });
    expect((await confirm(actor, asked.confirmation.id).expect(200)).body).toMatchObject({
      status: 'ok',
      data: {
        deleted: { account: true },
        googleRevocation: 'revoked',
        reportFiles: 'removed',
      },
    });
    expect(oauth.revokeCalls.length).toBe(revokesBefore + 1);
    expect(await referencesTo(actor.id)).toEqual([]);
    expect(await db.client.user.count({ where: { email: actor.email } })).toBe(0);
    expect(existsSync(join(reportsDir, actor.id))).toBe(false);
    await http(actor, 'get', '/auth/me').expect(401);
    // The refresh token is dead too.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `lff_refresh=${actor.refresh}`)
      .set('Origin', FRONTEND)
      .expect(401);

    // The other user is untouched.
    expect(await db.client.transaction.count({ where: { ownerId: other.id } })).toBe(3);
    expect(readdirSync(join(reportsDir, other.id))).toHaveLength(1);
  });

  it('partial failure: Google refusing the revocation does not keep the account', async () => {
    const actor = await newUser();
    await connectGoogle(app, actor);
    await populate(actor);
    oauth.revokeResult = false;

    const asked = await ask(actor, { scope: 'account' });
    expect((await confirm(actor, asked.confirmation.id).expect(200)).body).toMatchObject({
      status: 'ok',
      data: { deleted: { account: true }, googleRevocation: 'failed' },
    });
    // Local tokens go with the account even when Google could not be reached.
    expect(await referencesTo(actor.id)).toEqual([]);
  });

  it('disconnecting Google revokes and wipes the tokens, keeping the account', async () => {
    const actor = await newUser();
    await connectGoogle(app, actor);
    const revokesBefore = oauth.revokeCalls.length;
    await http(actor, 'delete', '/google/connection').expect(200);
    expect(oauth.revokeCalls.length).toBe(revokesBefore + 1);
    const connection = await db.client.googleConnection.findUniqueOrThrow({
      where: { userId: actor.id },
    });
    expect(connection).toMatchObject({
      status: 'REVOKED',
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
    });
    await http(actor, 'get', '/auth/me').expect(200);
  });
});

// ─────────────────────────────── Retention ───────────────────────────────

describe('retention sweep', () => {
  it('removes only records past their retention period', async () => {
    const actor = await newUser();
    const now = new Date();
    const old = (days: number) => new Date(now.getTime() - (days + 1) * DAY);
    const recent = new Date(now.getTime() - DAY);

    const [oldReport, newReport] = await Promise.all(
      [old(RETENTION.reportsDays), recent].map((createdAt) =>
        db.client.report.create({
          data: {
            ownerId: actor.id,
            type: 'MONTHLY',
            format: 'PDF',
            periodStart: new Date('2026-03-01'),
            periodEnd: new Date('2026-03-31'),
            status: 'EXPIRED',
            expiresAt: createdAt,
            createdAt,
          },
        }),
      ),
    );
    const [oldUsage, newUsage] = await Promise.all(
      [old(RETENTION.usageDays), recent].map((createdAt) =>
        db.client.usageEvent.create({
          data: {
            kind: 'AI_CHAT',
            provider: 'openai',
            model: 'gpt-test',
            outcome: 'ok',
            createdAt,
          },
        }),
      ),
    );
    const [oldAudit, newAudit] = await Promise.all(
      [old(RETENTION.adminAuditDays), recent].map((createdAt) =>
        db.client.adminAuditEvent.create({
          data: { action: 'settings.update', details: {}, createdAt },
        }),
      ),
    );
    const hash = () => randomBytes(32).toString('hex');
    const revoked = await db.client.userSession.create({
      data: {
        userId: actor.id,
        accessTokenHash: hash(),
        accessExpiresAt: old(RETENTION.sessionsDays),
        refreshTokenHash: hash(),
        refreshExpiresAt: now,
        csrfToken: 'c'.repeat(43),
        revokedAt: old(RETENTION.sessionsDays),
        revokedReason: 'logout',
      },
    });

    const result = await app.get(RetentionService).sweep(now);
    expect(result.reports).toBeGreaterThanOrEqual(1);
    expect(await db.client.report.count({ where: { id: oldReport!.id } })).toBe(0);
    expect(await db.client.report.count({ where: { id: newReport!.id } })).toBe(1);
    expect(await db.client.usageEvent.count({ where: { id: oldUsage!.id } })).toBe(0);
    expect(await db.client.usageEvent.count({ where: { id: newUsage!.id } })).toBe(1);
    expect(await db.client.adminAuditEvent.count({ where: { id: oldAudit!.id } })).toBe(
      0,
    );
    expect(await db.client.adminAuditEvent.count({ where: { id: newAudit!.id } })).toBe(
      1,
    );
    expect(await db.client.userSession.count({ where: { id: revoked.id } })).toBe(0);
    // The live session is kept.
    await http(actor, 'get', '/auth/me').expect(200);
  });
});

// ─────────────────────────────── Admin audit ───────────────────────────────

describe('administrative audit trail', () => {
  it('records status, role and settings changes, readable only by admins', async () => {
    const root = await newUser(ROOT_EMAIL);
    const target = await newUser();
    await http(root, 'patch', `/admin/users/${target.id}/status`)
      .send({ status: 'BLOCKED' })
      .expect(200);
    await http(root, 'patch', `/admin/users/${target.id}/status`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    await http(root, 'patch', `/admin/users/${target.id}/admin`)
      .send({ admin: true })
      .expect(200);
    await http(root, 'patch', '/admin/settings')
      .send({ 'assistant.enabled': true })
      .expect(200);

    const events = (await http(root, 'get', '/admin/audit').expect(200)).body as Json[];
    expect(events.slice(0, 4)).toMatchObject([
      {
        action: 'settings.update',
        actor: ROOT_EMAIL,
        target: null,
        details: { keys: ['assistant.enabled'] },
      },
      {
        action: 'user.admin',
        actor: ROOT_EMAIL,
        target: target.email,
        details: { admin: true },
      },
      { action: 'user.status', target: target.email, details: { status: 'ACTIVE' } },
      { action: 'user.status', target: target.email, details: { status: 'BLOCKED' } },
    ]);

    const plain = await newUser();
    await http(plain, 'get', '/admin/audit').expect(403);
    await http(null, 'get', '/admin/audit').expect(401);
  });
});

// ─────────────────────────────── Limits and abuse ───────────────────────────────

describe('limits and abuse', () => {
  it('counts route budgets per user: a noisy account does not starve others on the same IP', async () => {
    testEnv(db.url, {
      REPORT_TEMP_DIRECTORY: reportsDir,
      REPORT_RATE_LIMIT_MAX_REQUESTS: '2',
    });
    const limited = await createTestApp(google, [], oauth);
    try {
      const ana = await newUser(undefined, limited);
      const bia = await newUser(undefined, limited);
      await http(ana, 'get', '/privacy/export', limited).expect(200);
      await http(ana, 'get', '/privacy/export', limited).expect(200);
      const blocked = await http(ana, 'get', '/privacy/export', limited).expect(429);
      expect(blocked.body).toMatchObject({ code: 'rate_limited' });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      // Same IP, other account: its own budget.
      await http(bia, 'get', '/privacy/export', limited).expect(200);
    } finally {
      await limited.close();
      testEnv(db.url, { REPORT_TEMP_DIRECTORY: reportsDir, ADMIN_EMAILS: ROOT_EMAIL });
    }
  });

  it('rejects oversized, polluted, cross-site and traversal requests', async () => {
    const actor = await newUser();
    // Oversized body.
    await http(actor, 'post', '/transactions')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ description: 'x'.repeat(2_000_000) }))
      .expect(413);
    // Prototype pollution and unknown keys are rejected by the strict schemas.
    await http(actor, 'post', '/transactions')
      .set('Content-Type', 'application/json')
      .send(
        '{"type":"EXPENSE","description":"a","amount":"1","occurredOn":"2026-03-01","__proto__":{"admin":true}}',
      )
      .expect(400);
    await http(actor, 'post', '/transactions')
      .send({
        type: 'EXPENSE',
        description: 'a',
        amount: '1',
        occurredOn: '2026-03-01',
        ownerId: '00000000-0000-0000-0000-000000000000',
      })
      .expect(400);
    expect(({} as Json).admin).toBeUndefined();
    // Account deletion from a foreign site, even with the right token.
    await http(actor, 'post', '/assistant/data-deletions')
      .set('Origin', 'https://evil.example')
      .send({ scope: 'account' })
      .expect(403);
    // Path traversal in ids never reaches storage.
    await http(actor, 'get', '/reports/..%2F..%2Fetc%2Fpasswd/download').expect(400);
    // CORS: no grant for foreign origins.
    const preflight = await request(app.getHttpServer())
      .options('/api/v1/privacy/export')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(await db.client.user.count({ where: { id: actor.id } })).toBe(1);
  });
});
