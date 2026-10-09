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
let providers: Record<'OPENAI' | 'GEMINI' | 'ANTHROPIC', string>;

const OPENAI_KEY = 'sk-openai-PLAINTEXT-111';
const GEMINI_KEY = 'AIza-gemini-PLAINTEXT-222';
const ENV_ANTHROPIC_KEY = 'sk-ant-ENVIRONMENT-333';

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

async function configure(
  type: keyof typeof providers,
  body: Json,
): Promise<{ id: string; keySource: string }> {
  const response = await call(
    admin,
    'post',
    `/admin/ai-providers/${providers[type]}/configurations`,
    { purpose: 'CHAT', model: `${type.toLowerCase()}-model`, ...body },
  ).expect(201);
  const configuration = (
    (response.body as { configurations: Json[] }).configurations as {
      id: string;
      purpose: string;
      keySource: string;
    }[]
  ).find((item) => item.purpose === (body.purpose ?? 'CHAT'));
  return configuration as { id: string; keySource: string };
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
    ANTHROPIC_API_KEY: ENV_ANTHROPIC_KEY,
    ANTHROPIC_DEFAULT_CHAT_MODEL: 'claude-default',
  });
  google = new FakeGoogle();
  ai = new FakeAiClients();
  app = await createTestApp(google, [], undefined, undefined, ai);
  admin = await loginAs(app, google, { subject: 'ai-admin', email: 'admin@example.com' });
  user = await loginAs(app, google, { subject: 'ai-user', email: 'user@example.com' });
  const rows = await db.client.aIProvider.findMany();
  providers = Object.fromEntries(
    rows.map((row) => [row.type, row.id]),
  ) as typeof providers;
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
  for (const name of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_DEFAULT_CHAT_MODEL',
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
  it('is for administrators only', async () => {
    await call(null, 'get', '/admin/ai-providers').expect(401);
    const forbidden = await call(user, 'get', '/admin/ai-providers').expect(403);
    expect(forbidden.body).toMatchObject({ code: 'forbidden' });
    await call(user, 'post', `/admin/ai-providers/${providers.OPENAI}/configurations`, {
      purpose: 'CHAT',
      model: 'x',
      apiKey: OPENAI_KEY,
    }).expect(403);
    await call(user, 'post', '/admin/ai-configurations/reorder', {
      purpose: 'CHAT',
      configurationIds: [],
    }).expect(403);
    expect(await db.client.aIConfiguration.count()).toBe(0);

    const list = (await call(admin, 'get', '/admin/ai-providers').expect(200))
      .body as Json[];
    expect(list.map((item) => [item.type, item.displayName])).toEqual([
      ['OPENAI', 'OpenAI'],
      ['GEMINI', 'Google Gemini'],
      ['ANTHROPIC', 'Anthropic Claude'],
    ]);
    expect(list.find((item) => item.type === 'ANTHROPIC')).toMatchObject({
      hasEnvironmentKey: true,
      defaultModel: 'claude-default',
      capabilities: ['CHAT', 'FINANCIAL_INTERPRETATION', 'ANALYSIS'],
    });
  });

  it('requires CSRF and refuses unknown or server-owned fields', async () => {
    await call(
      admin,
      'post',
      `/admin/ai-providers/${providers.OPENAI}/configurations`,
      { purpose: 'CHAT', model: 'gpt' },
      false,
    ).expect(403);
    for (const body of [
      { purpose: 'CHAT', model: 'gpt', apiKeyEncrypted: 'v1.x.y.z' },
      { purpose: 'CHAT', model: 'gpt', encryptionKeyVersion: 'v9' },
      { purpose: 'CHAT', model: 'gpt', apiKey: 'tem espaço no meio' },
      { purpose: 'CHAT', model: 'gpt', apiKey: 'curta' },
      { purpose: 'CHAT', model: 'gpt com espaço' },
      { purpose: 'TRADING', model: 'gpt' },
      { purpose: 'CHAT', model: 'gpt', priority: 0 },
    ]) {
      await call(
        admin,
        'post',
        `/admin/ai-providers/${providers.OPENAI}/configurations`,
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
      `/admin/ai-providers/${providers.OPENAI}/configurations`,
      { purpose: 'CHAT', model: 'gpt-x', apiKey: OPENAI_KEY },
    ).expect(201);
    const text = JSON.stringify(response.body);
    expect(text).not.toContain(OPENAI_KEY);
    expect(text).not.toContain('apiKeyEncrypted');
    expect(text).not.toMatch(/v1\.[A-Za-z0-9_-]+\./);
    const configuration = (response.body as { configurations: Json[] }).configurations[0];
    expect(configuration).toMatchObject({
      purpose: 'CHAT',
      model: 'gpt-x',
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
    expect(row.apiKeyEncrypted).not.toContain(OPENAI_KEY);
    expect(vault().decrypt(row.apiKeyEncrypted as string, apiKeyContext(row.id))).toBe(
      OPENAI_KEY,
    );
    // Bound to its row: the same ciphertext under another id does not decrypt.
    expect(() =>
      vault().decrypt(row.apiKeyEncrypted as string, apiKeyContext(providers.OPENAI)),
    ).toThrow('credential could not be decrypted');

    const list = JSON.stringify(
      (await call(admin, 'get', '/admin/ai-providers').expect(200)).body,
    );
    expect(list).not.toContain(OPENAI_KEY);
    expect(list).not.toContain(row.apiKeyEncrypted as string);

    // The provider receives the decrypted key; nothing else ever does.
    await chat();
    expect(ai.OPENAI.calls[0]?.apiKey).toBe(OPENAI_KEY);
  });

  it('a ciphertext copied to another configuration is unusable (skipped, not leaked)', async () => {
    const source = await configure('OPENAI', { apiKey: OPENAI_KEY });
    const target = await configure('GEMINI', { priority: 2 });
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
      details: { attempts: [{ provider: 'GEMINI', outcome: 'credential_unreadable' }] },
    });
    expect(ai.GEMINI.calls).toHaveLength(0);
    expect(JSON.stringify(failure.getResponse())).not.toContain(OPENAI_KEY);
  });

  it('replaces and removes keys; without a stored key the server key is used', async () => {
    const anthropic = await configure('ANTHROPIC', {});
    expect(anthropic.keySource).toBe('environment');
    await chat();
    expect(ai.ANTHROPIC.calls[0]?.apiKey).toBe(ENV_ANTHROPIC_KEY);

    const openai = await configure('OPENAI', { apiKey: OPENAI_KEY, priority: 5 });
    await call(admin, 'patch', `/admin/ai-configurations/${openai.id}`, {
      apiKey: 'sk-openai-NEW-999999',
    }).expect(200);
    const replaced = await db.client.aIConfiguration.findUniqueOrThrow({
      where: { id: openai.id },
    });
    expect(
      vault().decrypt(replaced.apiKeyEncrypted as string, apiKeyContext(openai.id)),
    ).toBe('sk-openai-NEW-999999');
    const cleared = await call(admin, 'patch', `/admin/ai-configurations/${openai.id}`, {
      apiKey: null,
    }).expect(200);
    expect(
      ((cleared.body as { configurations: Json[] }).configurations[0] as Json).keySource,
    ).toBe('missing');
    expect(
      (await db.client.aIConfiguration.findUniqueOrThrow({ where: { id: openai.id } }))
        .apiKeyEncrypted,
    ).toBeNull();
  });

  it('rotates stored keys to a new key version', async () => {
    await configure('OPENAI', { apiKey: OPENAI_KEY });
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
      OPENAI_KEY,
    );
    expect(await rotateAiCredentials(db.client, rotating)).toMatchObject({ rotated: 0 });
  });
});

describe('priority and fallback', () => {
  async function three() {
    const openai = await configure('OPENAI', { apiKey: OPENAI_KEY, priority: 1 });
    const gemini = await configure('GEMINI', { apiKey: GEMINI_KEY, priority: 2 });
    const anthropic = await configure('ANTHROPIC', { priority: 3 });
    return { openai, gemini, anthropic };
  }

  it('uses the first provider by priority, and the order can be changed', async () => {
    const { openai, gemini, anthropic } = await three();
    const first = await chat();
    expect(first).toMatchObject({
      provider: 'OPENAI',
      model: 'openai-model',
      result: { text: 'resposta de OPENAI (openai-model)' },
      attempts: [{ provider: 'OPENAI', outcome: 'ok' }],
    });
    expect(ai.GEMINI.calls).toHaveLength(0);

    await call(admin, 'post', '/admin/ai-configurations/reorder', {
      purpose: 'CHAT',
      configurationIds: [anthropic.id, gemini.id, openai.id],
    }).expect(200);
    expect((await chat()).provider).toBe('ANTHROPIC');
    const priorities = await db.client.aIConfiguration.findMany({
      orderBy: { priority: 'asc' },
    });
    expect(priorities.map((row) => [row.id, row.priority])).toEqual([
      [anthropic.id, 1],
      [gemini.id, 2],
      [openai.id, 3],
    ]);

    const mismatch = await call(admin, 'post', '/admin/ai-configurations/reorder', {
      purpose: 'CHAT',
      configurationIds: [anthropic.id, gemini.id],
    }).expect(422);
    expect(mismatch.body).toMatchObject({ code: 'ai_reorder_mismatch' });
    const taken = await call(admin, 'patch', `/admin/ai-configurations/${openai.id}`, {
      priority: 1,
    }).expect(409);
    expect(taken.body).toMatchObject({ code: 'ai_priority_taken' });
    const duplicate = await call(
      admin,
      'post',
      `/admin/ai-providers/${providers.OPENAI}/configurations`,
      { purpose: 'CHAT', model: 'other' },
    ).expect(409);
    expect(duplicate.body).toMatchObject({ code: 'ai_configuration_exists' });
  });

  it.each([
    'unavailable',
    'timeout',
    'rate_limited',
    'credential_rejected',
    'model_not_found',
    'invalid_response',
  ] as const)('falls back after a recoverable %s failure', async (kind) => {
    await three();
    ai.OPENAI.behavior = kind;
    const outcome = await chat();
    expect(outcome.provider).toBe('GEMINI');
    expect(outcome.attempts).toEqual([
      { provider: 'OPENAI', model: 'openai-model', outcome: kind },
      { provider: 'GEMINI', model: 'gemini-model', outcome: 'ok' },
    ]);
    expect(ai.GEMINI.calls[0]?.apiKey).toBe(GEMINI_KEY);
  });

  it.each([
    ['invalid_request', 'ai_request_rejected'],
    ['content_blocked', 'ai_content_blocked'],
  ] as const)('never falls back after a %s error', async (kind, code) => {
    await three();
    ai.OPENAI.behavior = kind;
    const failure = await failureOf(chat());
    expect(failure.getStatus()).toBe(422);
    expect(failure.getResponse()).toMatchObject({
      code,
      details: { attempts: [{ provider: 'OPENAI', outcome: kind }] },
    });
    expect(ai.GEMINI.calls).toHaveLength(0);
    expect(ai.ANTHROPIC.calls).toHaveLength(0);
  });

  it('times out a hanging provider and moves on', async () => {
    await three();
    ai.OPENAI.behavior = 'hang';
    const started = Date.now();
    const outcome = await chat();
    expect(outcome.provider).toBe('GEMINI');
    expect(outcome.attempts[0]).toMatchObject({ outcome: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('answers 503 with every attempt when all providers fail', async () => {
    await three();
    ai.OPENAI.behavior = 'unavailable';
    ai.GEMINI.behavior = 'rate_limited';
    ai.ANTHROPIC.behavior = 'timeout';
    const failure = await failureOf(chat());
    expect(failure.getStatus()).toBe(503);
    expect(failure.getResponse()).toMatchObject({
      code: 'ai_unavailable',
      details: {
        attempts: [
          { provider: 'OPENAI', outcome: 'unavailable' },
          { provider: 'GEMINI', outcome: 'rate_limited' },
          { provider: 'ANTHROPIC', outcome: 'timeout' },
        ],
      },
    });
    const text = JSON.stringify(failure.getResponse());
    for (const key of [OPENAI_KEY, GEMINI_KEY, ENV_ANTHROPIC_KEY])
      expect(text).not.toContain(key);
  });

  it('skips inactive providers and configurations and unconfigured keys', async () => {
    const { gemini } = await three();
    await call(admin, 'patch', `/admin/ai-providers/${providers.OPENAI}`, {
      isActive: false,
    }).expect(200);
    await call(admin, 'patch', `/admin/ai-configurations/${gemini.id}`, {
      isActive: false,
    }).expect(200);
    expect((await chat()).provider).toBe('ANTHROPIC');
    expect(ai.OPENAI.calls).toHaveLength(0);
    expect(ai.GEMINI.calls).toHaveLength(0);

    await db.client.aIConfiguration.deleteMany();
    await db.client.aIProvider.updateMany({ data: { isActive: true } });
    const noKey = await configure('OPENAI', {});
    expect(noKey.keySource).toBe('missing');
    await configure('ANTHROPIC', { priority: 2 });
    const outcome = await chat();
    expect(outcome.attempts).toEqual([
      { provider: 'OPENAI', model: 'openai-model', outcome: 'not_configured' },
      { provider: 'ANTHROPIC', model: 'anthropic-model', outcome: 'ok' },
    ]);

    await db.client.aIConfiguration.deleteMany();
    const none = await failureOf(chat());
    expect(none.getResponse()).toMatchObject({ code: 'ai_not_configured' });
  });

  it('keeps purposes separate', async () => {
    await configure('OPENAI', { apiKey: OPENAI_KEY, purpose: 'ANALYSIS' });
    await configure('GEMINI', { apiKey: GEMINI_KEY });
    expect((await chat()).provider).toBe('GEMINI');
    expect(
      (
        await app
          .get(AiService)
          .chat('ANALYSIS', { messages: [{ role: 'user', content: 'x' }] })
      ).provider,
    ).toBe('OPENAI');
  });
});

describe('connection test', () => {
  it('tests one configuration without fallback and without returning the key', async () => {
    const openai = await configure('OPENAI', { apiKey: OPENAI_KEY });
    await configure('GEMINI', { apiKey: GEMINI_KEY, priority: 2 });
    const ok = await call(
      admin,
      'post',
      `/admin/ai-configurations/${openai.id}/test`,
    ).expect(200);
    expect(ok.body).toMatchObject({
      ok: true,
      provider: 'OPENAI',
      model: 'openai-model',
      error: null,
    });
    expect(ai.OPENAI.calls[0]?.request.maxOutputTokens).toBe(16);

    ai.OPENAI.behavior = 'credential_rejected';
    const failed = await call(
      admin,
      'post',
      `/admin/ai-configurations/${openai.id}/test`,
    ).expect(200);
    expect(failed.body).toMatchObject({ ok: false, error: 'credential_rejected' });
    expect(ai.GEMINI.calls).toHaveLength(0); // no fallback in a test
    expect(JSON.stringify(failed.body)).not.toContain(OPENAI_KEY);

    await call(user, 'post', `/admin/ai-configurations/${openai.id}/test`).expect(403);
    await call(
      admin,
      'post',
      '/admin/ai-configurations/00000000-0000-4000-8000-000000000000/test',
    ).expect(404);
    await call(admin, 'delete', `/admin/ai-configurations/${openai.id}`).expect(204);
    await call(admin, 'delete', `/admin/ai-configurations/${openai.id}`).expect(404);
  });
});
