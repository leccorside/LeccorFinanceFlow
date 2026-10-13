import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  AiService,
  apiKeyContext,
  rotateAiCredentials,
} from '../../src/ai/ai.service.js';
import { CredentialVault } from '../../src/common/crypto/credential-vault.js';
import { seedDatabase } from '../../src/database/seed.js';
import {
  createDisposableDatabase,
  type DisposableDatabase,
} from './disposable-database.js';
import { FakeAiClients } from './fake-ai.js';
import {
  createTestApp,
  FakeGoogle,
  loginAs,
  type Session,
  TEST_ENCRYPTION_KEY_V1,
  testEnv,
} from './support.js';

let db: DisposableDatabase;
let app: NestExpressApplication;
let google: FakeGoogle;
let ai: FakeAiClients;
let admin: Session;
let user: Session;
let gemini: string;

const KEY_A = 'AIza-gemini-PLAINTEXT-aaa';
const KEY_B = 'AIza-gemini-PLAINTEXT-bbb';
const ENV_KEY = 'AIza-gemini-ENVIRONMENT-ccc';

type Json = Record<string, unknown>;
const vault = () =>
  new CredentialVault(
    new Map([['v1', Buffer.from(TEST_ENCRYPTION_KEY_V1, 'base64')]]),
    'v1',
  );

function call(
  session: Session | null,
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  body?: object,
  csrf = true,
) {
  const server = request(app.getHttpServer());
  const req = server[method](`/api/v1${path}`);
  if (session) {
    req.set('Cookie', session.cookie);
    if (method !== 'get' && csrf) req.set('X-CSRF-Token', session.csrf);
  }
  return body ? req.send(body) : req;
}

/** Adds a Gemini model to a purpose (CHAT by default) and returns that configuration. */
async function configure(
  model: string,
  body: Json = {},
): Promise<{ id: string; keySource: string }> {
  const purpose = (body.purpose as string | undefined) ?? 'CHAT';
  const response = await call(
    admin,
    'post',
    `/admin/ai-providers/${gemini}/configurations`,
    { purpose, model, ...body },
  ).expect(201);
  return (
    (response.body as { configurations: Json[] }).configurations as {
      id: string;
      purpose: string;
      model: string;
      keySource: string;
    }[]
  ).find((item) => item.purpose === purpose && item.model === model) as {
    id: string;
    keySource: string;
  };
}

const chat = () =>
  app.get(AiService).chat('CHAT', { messages: [{ role: 'user', content: 'Oi' }] });

/** The ApiException thrown by `work` (fails the test if nothing is thrown). */
async function failureOf(
  work: Promise<unknown>,
): Promise<{ getStatus(): number; getResponse(): Json }> {
  try {
    await work;
  } catch (error) {
    return error as { getStatus(): number; getResponse(): Json };
  }
  throw new Error('expected a failure');
}

beforeAll(async () => {
  db = await createDisposableDatabase();
  await seedDatabase(db.client);
  testEnv(db.url, {
    ADMIN_EMAILS: 'admin@example.com',
    AI_REQUEST_TIMEOUT_MS: '150',
    GEMINI_API_KEY: ENV_KEY,
    GEMINI_DEFAULT_CHAT_MODEL: 'gemini-default',
  });
  google = new FakeGoogle();
  ai = new FakeAiClients();
  app = await createTestApp(google, [], undefined, undefined, ai);
  admin = await loginAs(app, google, { subject: 'ai-admin', email: 'admin@example.com' });
  user = await loginAs(app, google, { subject: 'ai-user', email: 'user@example.com' });
  gemini = (await db.client.aIProvider.findUniqueOrThrow({ where: { type: 'GEMINI' } }))
    .id;
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
  for (const name of [
    'GEMINI_API_KEY',
    'GEMINI_DEFAULT_CHAT_MODEL',
    'AI_REQUEST_TIMEOUT_MS',
  ]) {
    delete process.env[name];
  }
});

beforeEach(async () => {
  ai.reset();
  await db.client.aIConfiguration.deleteMany();
  await db.client.aIProvider.updateMany({ data: { isActive: true } });
});

describe('administration and RBAC', () => {
  it('is for administrators only, and Gemini is the only provider', async () => {
    await call(null, 'get', '/admin/ai-providers').expect(401);
    const forbidden = await call(user, 'get', '/admin/ai-providers').expect(403);
    expect(forbidden.body).toMatchObject({ code: 'forbidden' });
    await call(user, 'post', `/admin/ai-providers/${gemini}/configurations`, {
      purpose: 'CHAT',
      model: 'x',
      apiKey: KEY_A,
    }).expect(403);
    await call(user, 'post', '/admin/ai-configurations/reorder', {
      purpose: 'CHAT',
      configurationIds: [],
    }).expect(403);
    expect(await db.client.aIConfiguration.count()).toBe(0);

    const list = (await call(admin, 'get', '/admin/ai-providers').expect(200))
      .body as Json[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      type: 'GEMINI',
      displayName: 'Google Gemini',
      hasEnvironmentKey: true,
      defaultModel: 'gemini-default',
      capabilities: ['CHAT', 'FINANCIAL_INTERPRETATION', 'ANALYSIS'],
    });
  });

  it('requires CSRF and refuses unknown or server-owned fields', async () => {
    await call(
      admin,
      'post',
      `/admin/ai-providers/${gemini}/configurations`,
      { purpose: 'CHAT', model: 'gemini' },
      false,
    ).expect(403);
    for (const body of [
      { purpose: 'CHAT', model: 'gemini', apiKeyEncrypted: 'v1.x.y.z' },
      { purpose: 'CHAT', model: 'gemini', encryptionKeyVersion: 'v9' },
      { purpose: 'CHAT', model: 'gemini', apiKey: 'tem espaço no meio' },
      { purpose: 'CHAT', model: 'gemini', apiKey: 'curta' },
      { purpose: 'CHAT', model: 'gemini com espaço' },
      { purpose: 'TRADING', model: 'gemini' },
      { purpose: 'CHAT', model: 'gemini', priority: 0 },
      { purpose: 'CHAT', model: 'gemini', provider: 'OPENAI' },
    ]) {
      await call(
        admin,
        'post',
        `/admin/ai-providers/${gemini}/configurations`,
        body,
      ).expect(400);
    }
    expect(await db.client.aIConfiguration.count()).toBe(0);
  });
});

describe('keys: encrypted at rest, never returned', () => {
  it('stores the key with AES-GCM bound to the configuration and never echoes it', async () => {
    const response = await call(
      admin,
      'post',
      `/admin/ai-providers/${gemini}/configurations`,
      { purpose: 'CHAT', model: 'gemini-x', apiKey: KEY_A },
    ).expect(201);
    const text = JSON.stringify(response.body);
    expect(text).not.toContain(KEY_A);
    expect(text).not.toContain('apiKeyEncrypted');
    expect(text).not.toMatch(/v1\.[A-Za-z0-9_-]+\./);
    const configuration = (response.body as { configurations: Json[] }).configurations[0];
    expect(configuration).toMatchObject({
      purpose: 'CHAT',
      model: 'gemini-x',
      priority: 1,
      isActive: true,
      keySource: 'stored',
      keyVersion: 'v1',
    });
    expect(Object.keys(configuration as Json).sort()).toEqual([
      'id',
      'isActive',
      'keySource',
      'keyVersion',
      'model',
      'priority',
      'purpose',
      'updatedAt',
    ]);

    const row = await db.client.aIConfiguration.findFirstOrThrow();
    expect(row.apiKeyEncrypted).toMatch(/^v1\./);
    expect(row.apiKeyEncrypted).not.toContain(KEY_A);
    expect(vault().decrypt(row.apiKeyEncrypted as string, apiKeyContext(row.id))).toBe(
      KEY_A,
    );
    // Bound to its row: the same ciphertext under another id does not decrypt.
    expect(() =>
      vault().decrypt(row.apiKeyEncrypted as string, apiKeyContext(gemini)),
    ).toThrow('credential could not be decrypted');

    const list = JSON.stringify(
      (await call(admin, 'get', '/admin/ai-providers').expect(200)).body,
    );
    expect(list).not.toContain(KEY_A);
    expect(list).not.toContain(row.apiKeyEncrypted as string);

    // Gemini receives the decrypted key; nothing else ever does.
    await chat();
    expect(ai.GEMINI.calls[0]?.apiKey).toBe(KEY_A);
  });

  it('a ciphertext copied to another configuration is unusable (skipped, not leaked)', async () => {
    const source = await configure('gemini-a', { apiKey: KEY_A });
    const target = await configure('gemini-b', { priority: 2 });
    const stolen = await db.client.aIConfiguration.findUniqueOrThrow({
      where: { id: source.id },
    });
    await db.client.aIConfiguration.update({
      where: { id: target.id },
      data: { apiKeyEncrypted: stolen.apiKeyEncrypted, encryptionKeyVersion: 'v1' },
    });
    await db.client.aIConfiguration.update({
      where: { id: source.id },
      data: { isActive: false },
    });
    const failure = await failureOf(chat());
    expect(failure.getResponse()).toMatchObject({
      code: 'ai_unavailable',
      details: {
        attempts: [
          { provider: 'GEMINI', model: 'gemini-b', outcome: 'credential_unreadable' },
        ],
      },
    });
    expect(ai.GEMINI.calls).toHaveLength(0);
    expect(JSON.stringify(failure.getResponse())).not.toContain(KEY_A);
  });

  it('replaces and removes keys; without a stored key the server key is used', async () => {
    const fromEnvironment = await configure('gemini-c');
    expect(fromEnvironment.keySource).toBe('environment');
    await chat();
    expect(ai.GEMINI.calls[0]?.apiKey).toBe(ENV_KEY);

    const stored = await configure('gemini-a', { apiKey: KEY_A, priority: 5 });
    await call(admin, 'patch', `/admin/ai-configurations/${stored.id}`, {
      apiKey: 'AIza-gemini-NEW-999999',
    }).expect(200);
    const replaced = await db.client.aIConfiguration.findUniqueOrThrow({
      where: { id: stored.id },
    });
    expect(
      vault().decrypt(replaced.apiKeyEncrypted as string, apiKeyContext(stored.id)),
    ).toBe('AIza-gemini-NEW-999999');
    const cleared = await call(admin, 'patch', `/admin/ai-configurations/${stored.id}`, {
      apiKey: null,
    }).expect(200);
    const view = (cleared.body as { configurations: Json[] }).configurations.find(
      (item) => item.id === stored.id,
    );
    // Without its stored key the configuration falls back to the server Gemini key.
    expect(view?.keySource).toBe('environment');
    expect(
      (await db.client.aIConfiguration.findUniqueOrThrow({ where: { id: stored.id } }))
        .apiKeyEncrypted,
    ).toBeNull();
  });

  it('rotates stored keys to a new key version', async () => {
    await configure('gemini-a', { apiKey: KEY_A });
    const v2 = Buffer.alloc(32, 0x22);
    const rotating = new CredentialVault(
      new Map([
        ['v1', Buffer.from(TEST_ENCRYPTION_KEY_V1, 'base64')],
        ['v2', v2],
      ]),
      'v2',
    );
    expect(await rotateAiCredentials(db.client, rotating)).toEqual({
      checked: 1,
      rotated: 1,
      failed: 0,
    });
    const row = await db.client.aIConfiguration.findFirstOrThrow();
    expect(row.apiKeyEncrypted).toMatch(/^v2\./);
    expect(row.encryptionKeyVersion).toBe('v2');
    expect(rotating.decrypt(row.apiKeyEncrypted as string, apiKeyContext(row.id))).toBe(
      KEY_A,
    );
    expect(await rotateAiCredentials(db.client, rotating)).toMatchObject({ rotated: 0 });
  });
});

describe('priority and fallback between Gemini models', () => {
  async function three() {
    const a = await configure('gemini-a', { apiKey: KEY_A, priority: 1 });
    const b = await configure('gemini-b', { apiKey: KEY_B, priority: 2 });
    const c = await configure('gemini-c', { priority: 3 });
    return { a, b, c };
  }

  it('uses the first model by priority, and the order can be changed', async () => {
    const { a, b, c } = await three();
    const first = await chat();
    expect(first).toMatchObject({
      provider: 'GEMINI',
      model: 'gemini-a',
      result: { text: 'resposta de GEMINI (gemini-a)' },
      attempts: [{ provider: 'GEMINI', model: 'gemini-a', outcome: 'ok' }],
    });
    expect(ai.GEMINI.calls).toHaveLength(1);

    await call(admin, 'post', '/admin/ai-configurations/reorder', {
      purpose: 'CHAT',
      configurationIds: [c.id, b.id, a.id],
    }).expect(200);
    expect((await chat()).model).toBe('gemini-c');
    const priorities = await db.client.aIConfiguration.findMany({
      orderBy: { priority: 'asc' },
    });
    expect(priorities.map((row) => [row.id, row.priority])).toEqual([
      [c.id, 1],
      [b.id, 2],
      [a.id, 3],
    ]);

    const mismatch = await call(admin, 'post', '/admin/ai-configurations/reorder', {
      purpose: 'CHAT',
      configurationIds: [c.id, b.id],
    }).expect(422);
    expect(mismatch.body).toMatchObject({ code: 'ai_reorder_mismatch' });
    const taken = await call(admin, 'patch', `/admin/ai-configurations/${a.id}`, {
      priority: 1,
    }).expect(409);
    expect(taken.body).toMatchObject({ code: 'ai_priority_taken' });
  });

  it('accepts several models per purpose but never the same model twice', async () => {
    await three();
    const duplicate = await call(
      admin,
      'post',
      `/admin/ai-providers/${gemini}/configurations`,
      { purpose: 'CHAT', model: 'gemini-b' },
    ).expect(409);
    expect(duplicate.body).toMatchObject({ code: 'ai_configuration_exists' });
    // The same model may serve another purpose.
    await configure('gemini-b', { purpose: 'ANALYSIS' });
    // Renaming a configuration onto another model of the purpose is a conflict too.
    const rows = await db.client.aIConfiguration.findMany({ where: { purpose: 'CHAT' } });
    const a = rows.find((row) => row.model === 'gemini-a')!;
    const clash = await call(admin, 'patch', `/admin/ai-configurations/${a.id}`, {
      model: 'gemini-b',
    }).expect(409);
    expect(clash.body).toMatchObject({ code: 'ai_configuration_conflict' });
  });

  it.each([
    'unavailable',
    'timeout',
    'rate_limited',
    'credential_rejected',
    'model_not_found',
    'invalid_response',
  ] as const)(
    'falls back to the next model after a recoverable %s failure',
    async (kind) => {
      await three();
      ai.GEMINI.behaviorOf['gemini-a'] = kind;
      const outcome = await chat();
      expect(outcome.model).toBe('gemini-b');
      expect(outcome.attempts).toEqual([
        { provider: 'GEMINI', model: 'gemini-a', outcome: kind },
        { provider: 'GEMINI', model: 'gemini-b', outcome: 'ok' },
      ]);
      // Each model is called with its own key.
      expect(ai.GEMINI.calls.map((item) => [item.request.model, item.apiKey])).toEqual([
        ['gemini-a', KEY_A],
        ['gemini-b', KEY_B],
      ]);
    },
  );

  it.each([
    ['invalid_request', 'ai_request_rejected'],
    ['content_blocked', 'ai_content_blocked'],
  ] as const)('never falls back after a %s error', async (kind, code) => {
    await three();
    ai.GEMINI.behaviorOf['gemini-a'] = kind;
    const failure = await failureOf(chat());
    expect(failure.getStatus()).toBe(422);
    expect(failure.getResponse()).toMatchObject({
      code,
      details: { attempts: [{ provider: 'GEMINI', model: 'gemini-a', outcome: kind }] },
    });
    expect(ai.GEMINI.calls).toHaveLength(1);
  });

  it('times out a hanging model and moves on', async () => {
    await three();
    ai.GEMINI.behaviorOf['gemini-a'] = 'hang';
    const started = Date.now();
    const outcome = await chat();
    expect(outcome.model).toBe('gemini-b');
    expect(outcome.attempts[0]).toMatchObject({ outcome: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('answers 503 with every attempt when all models fail', async () => {
    await three();
    ai.GEMINI.behaviorOf = {
      'gemini-a': 'unavailable',
      'gemini-b': 'rate_limited',
      'gemini-c': 'timeout',
    };
    const failure = await failureOf(chat());
    expect(failure.getStatus()).toBe(503);
    expect(failure.getResponse()).toMatchObject({
      code: 'ai_unavailable',
      details: {
        attempts: [
          { model: 'gemini-a', outcome: 'unavailable' },
          { model: 'gemini-b', outcome: 'rate_limited' },
          { model: 'gemini-c', outcome: 'timeout' },
        ],
      },
    });
    const text = JSON.stringify(failure.getResponse());
    for (const key of [KEY_A, KEY_B, ENV_KEY]) expect(text).not.toContain(key);
  });

  it('skips inactive configurations, an inactive provider and unconfigured keys', async () => {
    const { a, b } = await three();
    await call(admin, 'patch', `/admin/ai-configurations/${a.id}`, {
      isActive: false,
    }).expect(200);
    await call(admin, 'patch', `/admin/ai-configurations/${b.id}`, {
      isActive: false,
    }).expect(200);
    expect((await chat()).model).toBe('gemini-c');
    expect(ai.GEMINI.calls.map((item) => item.request.model)).toEqual(['gemini-c']);

    // Turning the provider off turns every model off.
    await call(admin, 'patch', `/admin/ai-providers/${gemini}`, {
      isActive: false,
    }).expect(200);
    expect((await failureOf(chat())).getResponse()).toMatchObject({
      code: 'ai_not_configured',
    });

    // Without a stored key and without GEMINI_API_KEY the attempt is skipped.
    await db.client.aIProvider.updateMany({ data: { isActive: true } });
    await db.client.aIConfiguration.deleteMany();
    const noKey = await configure('gemini-a');
    await db.client.aIConfiguration.update({
      where: { id: noKey.id },
      data: { apiKeyEncrypted: null },
    });
    process.env.GEMINI_API_KEY = '';
    const keyless = await createTestApp(google, [], undefined, undefined, ai);
    try {
      const failure = await failureOf(
        keyless
          .get(AiService)
          .chat('CHAT', { messages: [{ role: 'user', content: 'Oi' }] }),
      );
      expect(failure.getResponse()).toMatchObject({
        code: 'ai_unavailable',
        details: { attempts: [{ model: 'gemini-a', outcome: 'not_configured' }] },
      });
    } finally {
      await keyless.close();
      process.env.GEMINI_API_KEY = ENV_KEY;
    }

    await db.client.aIConfiguration.deleteMany();
    const none = await failureOf(chat());
    expect(none.getResponse()).toMatchObject({ code: 'ai_not_configured' });
  });

  it('keeps purposes separate', async () => {
    await configure('gemini-pro', { apiKey: KEY_A, purpose: 'ANALYSIS' });
    await configure('gemini-flash', { apiKey: KEY_B });
    expect((await chat()).model).toBe('gemini-flash');
    expect(
      (
        await app
          .get(AiService)
          .chat('ANALYSIS', { messages: [{ role: 'user', content: 'x' }] })
      ).model,
    ).toBe('gemini-pro');
  });
});

describe('connection test', () => {
  it('tests one configuration without fallback and without returning the key', async () => {
    const first = await configure('gemini-a', { apiKey: KEY_A });
    await configure('gemini-b', { apiKey: KEY_B, priority: 2 });
    const ok = await call(
      admin,
      'post',
      `/admin/ai-configurations/${first.id}/test`,
    ).expect(200);
    expect(ok.body).toMatchObject({
      ok: true,
      provider: 'GEMINI',
      model: 'gemini-a',
      error: null,
    });
    expect(ai.GEMINI.calls[0]?.request.maxOutputTokens).toBe(16);

    ai.GEMINI.behaviorOf['gemini-a'] = 'credential_rejected';
    const failed = await call(
      admin,
      'post',
      `/admin/ai-configurations/${first.id}/test`,
    ).expect(200);
    expect(failed.body).toMatchObject({ ok: false, error: 'credential_rejected' });
    // No fallback in a test: gemini-b was never called.
    expect(ai.GEMINI.calls.map((item) => item.request.model)).toEqual([
      'gemini-a',
      'gemini-a',
    ]);
    expect(JSON.stringify(failed.body)).not.toContain(KEY_A);

    await call(user, 'post', `/admin/ai-configurations/${first.id}/test`).expect(403);
    await call(
      admin,
      'post',
      '/admin/ai-configurations/00000000-0000-4000-8000-000000000000/test',
    ).expect(404);
    await call(admin, 'delete', `/admin/ai-configurations/${first.id}`).expect(204);
    await call(admin, 'delete', `/admin/ai-configurations/${first.id}`).expect(404);
  });
});
