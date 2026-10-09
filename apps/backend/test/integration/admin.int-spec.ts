import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { seedDatabase } from '../../src/database/seed.js';
import {
  createDisposableDatabase,
  type DisposableDatabase,
} from './disposable-database.js';
import { FakeAiClients } from './fake-ai.js';
import { FakeVoiceClients } from './fake-voice.js';
import {
  connectGoogle,
  createTestApp,
  FakeGoogle,
  loginAs,
  type Session,
  testEnv,
} from './support.js';

let db: DisposableDatabase;
let app: NestExpressApplication;
let google: FakeGoogle;
let ai: FakeAiClients;
let voice: FakeVoiceClients;
let root: Actor;

const ROOT_EMAIL = 'root@example.com';
const AI_SECRET = 'sk-admin-very-secret-key-1234567890';
const STT_SECRET = 'stt-env-secret-abcdef';

type Json = Record<string, unknown>;
interface Actor extends Session {
  id: string;
  email: string;
}
interface UserView {
  id: string;
  email: string;
  status: string;
  roles: string[];
  adminFromEnvironment: boolean;
  isSelf: boolean;
}

let sequence = 0;
async function newUser(email?: string): Promise<Actor> {
  sequence += 1;
  const address = email ?? `adm${sequence}@example.com`;
  const session = await loginAs(app, google, {
    subject: `adm-${address}`,
    email: address,
  });
  const user = await db.client.user.findUniqueOrThrow({ where: { email: address } });
  return { ...session, id: user.id, email: address };
}

function call(
  s: Session | null,
  method: 'get' | 'post' | 'patch',
  path: string,
  body?: object,
) {
  const server = request(app.getHttpServer());
  const req = server[method](`/api/v1${path}`);
  if (s) {
    req.set('Cookie', s.cookie);
    if (method !== 'get') req.set('X-CSRF-Token', s.csrf);
  }
  return body ? req.send(body) : req;
}

const setAdmin = (actor: Session, target: string, admin: boolean) =>
  call(actor, 'patch', `/admin/users/${target}/admin`, { admin });
const setStatus = (actor: Session, target: string, status: 'ACTIVE' | 'BLOCKED') =>
  call(actor, 'patch', `/admin/users/${target}/status`, { status });
const settings = (actor: Session, body: Json) =>
  call(actor, 'patch', '/admin/settings', body);

beforeAll(async () => {
  db = await createDisposableDatabase();
  await seedDatabase(db.client);
  testEnv(db.url, {
    ADMIN_EMAILS: ROOT_EMAIL,
    STT_PROVIDER: 'openai',
    TTS_PROVIDER: 'openai',
    STT_API_KEY: STT_SECRET,
    OPENAI_API_KEY: 'sk-env-openai',
    GEMINI_API_KEY: 'gm-env-key',
  });
  google = new FakeGoogle();
  ai = new FakeAiClients();
  voice = new FakeVoiceClients();
  app = await createTestApp(google, [], undefined, undefined, ai, voice);
  root = await newUser(ROOT_EMAIL);
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
  for (const name of [
    'STT_PROVIDER',
    'TTS_PROVIDER',
    'STT_API_KEY',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
  ]) {
    delete process.env[name];
  }
});

beforeEach(async () => {
  ai.reset();
  voice.reset();
  // Every test starts from the default settings.
  await db.client.systemSetting.deleteMany();
  await call(root, 'get', '/admin/settings').expect(200); // refreshes the settings cache
});

describe('RBAC', () => {
  it('lets only admins in: 401 without a session, 403 for users', async () => {
    const ana = await newUser();
    const routes: ['get' | 'patch', string, Json?][] = [
      ['get', '/admin/overview'],
      ['get', '/admin/users'],
      ['get', '/admin/settings'],
      ['patch', `/admin/users/${root.id}/status`, { status: 'BLOCKED' }],
      ['patch', `/admin/users/${root.id}/admin`, { admin: false }],
      ['patch', '/admin/settings', { 'assistant.enabled': false }],
      ['get', '/admin/ai-providers'],
    ];
    for (const [method, path, body] of routes) {
      await call(null, method, path, body).expect(401);
      await call(ana, method, path, body).expect(403);
    }
    await call(root, 'get', '/admin/overview').expect(200);
    // Nothing changed through the refused requests.
    expect(
      (await db.client.user.findUniqueOrThrow({ where: { id: root.id } })).status,
    ).toBe('ACTIVE');
  });

  it('requires CSRF on writes', async () => {
    const ana = await newUser();
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${ana.id}/status`)
      .set('Cookie', root.cookie)
      .send({ status: 'BLOCKED' })
      .expect(403);
  });
});

describe('promotion and demotion', () => {
  it('promotes and demotes with immediate effect on access', async () => {
    const ana = await newUser();
    await call(ana, 'get', '/admin/overview').expect(403);

    const promoted = (await setAdmin(root, ana.id, true).expect(200)).body as UserView;
    expect(promoted.roles).toEqual(['ADMIN', 'USER']);
    await call(ana, 'get', '/admin/overview').expect(200); // same session, new role

    const demoted = (await setAdmin(root, ana.id, false).expect(200)).body as UserView;
    expect(demoted.roles).toEqual(['USER']);
    await call(ana, 'get', '/admin/overview').expect(403);
  });

  it('never lets an admin change themselves nor demote an ADMIN_EMAILS admin', async () => {
    const ana = await newUser();
    await setAdmin(root, ana.id, true).expect(200);

    const self = await setAdmin(root, root.id, false).expect(422);
    expect(self.body.code).toBe('admin_self_change');
    expect((await setStatus(root, root.id, 'BLOCKED').expect(422)).body.code).toBe(
      'admin_self_change',
    );

    const env = await setAdmin(ana, root.id, false).expect(422);
    expect(env.body.code).toBe('admin_from_environment');
    expect(
      await db.client.userRole.count({
        where: { userId: root.id, role: { name: 'ADMIN' } },
      }),
    ).toBe(1);
    await setAdmin(root, ana.id, false).expect(200);
  });

  it('keeps an admin when two admins demote each other at the same time', async () => {
    const ana = await newUser();
    const bia = await newUser();
    await setAdmin(root, ana.id, true).expect(200);
    await setAdmin(root, bia.id, true).expect(200);

    const [first, second] = await Promise.all([
      setAdmin(ana, bia.id, false),
      setAdmin(bia, ana.id, false),
    ]);

    // One wins; the other is no longer an admin when its turn comes.
    expect([first.status, second.status].sort()).toEqual([200, 403]);
    const remaining = await db.client.userRole.count({
      where: { userId: { in: [ana.id, bia.id] }, role: { name: 'ADMIN' } },
    });
    expect(remaining).toBe(1);
  });

  it('refuses to promote a blocked account and unknown users', async () => {
    const ana = await newUser();
    await setStatus(root, ana.id, 'BLOCKED').expect(200);
    expect((await setAdmin(root, ana.id, true).expect(422)).body.code).toBe(
      'user_blocked',
    );
    await setAdmin(root, '0192f000-0000-7000-8000-000000000000', true).expect(404);
    await setAdmin(root, 'nope', true).expect(400);
    await call(root, 'patch', `/admin/users/${ana.id}/admin`, { admin: 'yes' }).expect(
      400,
    );
  });
});

describe('blocking', () => {
  it('ends every session at once and refuses new logins until unblocked', async () => {
    const ana = await newUser();
    await newUser(ana.email); // a second device
    await call(ana, 'get', '/profile').expect(200);
    const open = () =>
      db.client.userSession.count({ where: { userId: ana.id, revokedAt: null } });
    expect(await open()).toBe(2);

    const blocked = (await setStatus(root, ana.id, 'BLOCKED').expect(200))
      .body as UserView;
    expect(blocked.status).toBe('BLOCKED');
    // Revoked right away, before any of those sessions is used again.
    expect(await open()).toBe(0);
    await call(ana, 'get', '/profile').expect(401);
    await expect(newUser(ana.email)).rejects.toThrow(/error=account_blocked/);

    await setStatus(root, ana.id, 'ACTIVE').expect(200);
    const again = await newUser(ana.email);
    await call(again, 'get', '/profile').expect(200);
  });

  it('blocking an admin keeps at least one active admin and removes their access', async () => {
    const ana = await newUser();
    await setAdmin(root, ana.id, true).expect(200);
    await setStatus(root, ana.id, 'BLOCKED').expect(200);
    await call(ana, 'get', '/admin/overview').expect(401);
    const overview = (await call(root, 'get', '/admin/overview').expect(200)).body as {
      users: { admins: number };
    };
    expect(overview.users.admins).toBeGreaterThanOrEqual(1);
  });
});

describe('users list', () => {
  it('searches, filters and pages, marking self and environment admins', async () => {
    const zeca = await newUser('zeca.unico@example.com');
    await setStatus(root, zeca.id, 'BLOCKED').expect(200);

    const search = (await call(root, 'get', '/admin/users?q=ZECA').expect(200)).body as {
      items: UserView[];
      total: number;
    };
    expect(search.total).toBe(1);
    expect(search.items[0]).toMatchObject({
      email: 'zeca.unico@example.com',
      status: 'BLOCKED',
      isSelf: false,
    });

    const blocked = (await call(root, 'get', '/admin/users?status=BLOCKED').expect(200))
      .body as { items: UserView[] };
    expect(blocked.items.every((user) => user.status === 'BLOCKED')).toBe(true);

    const admins = (await call(root, 'get', '/admin/users?role=ADMIN').expect(200))
      .body as { items: UserView[] };
    expect(admins.items.find((user) => user.email === ROOT_EMAIL)).toMatchObject({
      isSelf: true,
      adminFromEnvironment: true,
    });

    const page = (await call(root, 'get', '/admin/users?pageSize=2&page=1').expect(200))
      .body as {
      items: UserView[];
      total: number;
    };
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThan(2);
    await call(root, 'get', '/admin/users?pageSize=500').expect(400);
  });
});

describe('settings', () => {
  it('lists every setting with its default and validates changes strictly', async () => {
    const view = (await call(root, 'get', '/admin/settings').expect(200)).body as {
      values: Json;
      definitions: { key: string }[];
    };
    expect(view.values).toEqual({
      'signups.enabled': true,
      'assistant.enabled': true,
      'voice.transcription.enabled': true,
      'voice.speech.enabled': true,
      'usage.prices': [],
    });
    expect(view.definitions.map((item) => item.key)).toHaveLength(5);

    await settings(root, { 'unknown.key': true }).expect(400);
    await settings(root, { 'assistant.enabled': 'no' }).expect(400);
    await settings(root, {}).expect(400);
    await settings(root, {
      'usage.prices': [
        { kind: 'AI_CHAT', provider: 'openai', model: 'x', input: '-1', output: '1' },
      ],
    }).expect(400);
    await settings(root, {
      'usage.prices': [
        { kind: 'AI_CHAT', provider: 'openai', model: 'x', input: '1e3', output: '1' },
      ],
    }).expect(400);

    const saved = (await settings(root, { 'assistant.enabled': false }).expect(200))
      .body as { values: Json };
    expect(saved.values['assistant.enabled']).toBe(false);
    const row = await db.client.systemSetting.findUniqueOrThrow({
      where: { key: 'assistant.enabled' },
    });
    expect(row.updatedById).toBe(root.id);
  });

  it('closes signups for new accounts only (existing users and ADMIN_EMAILS still enter)', async () => {
    const ana = await newUser();
    await settings(root, { 'signups.enabled': false }).expect(200);

    await expect(newUser('newcomer@example.com')).rejects.toThrow(/error=signups_closed/);
    expect(await db.client.user.count({ where: { email: 'newcomer@example.com' } })).toBe(
      0,
    );
    await newUser(ana.email); // existing account
    await settings(root, { 'signups.enabled': true }).expect(200);
    await newUser('newcomer@example.com');
  });

  it('pauses the assistant and the voice', async () => {
    const ana = await newUser();
    await settings(root, {
      'assistant.enabled': false,
      'voice.transcription.enabled': false,
      'voice.speech.enabled': false,
    }).expect(200);

    const paused = await call(ana, 'post', '/assistant/messages', {
      message: 'oi',
    }).expect(503);
    expect(paused.body.code).toBe('assistant_disabled');
    const caps = (await call(ana, 'get', '/voice/capabilities').expect(200)).body as Json;
    expect(caps).toMatchObject({ transcription: false, speech: false });
    const stt = await call(ana, 'post', '/voice/transcriptions')
      .set('Content-Type', 'audio/ogg')
      .send(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64)]))
      .expect(503);
    expect(stt.body.code).toBe('voice_disabled');
    expect(voice.openai.transcriptions).toHaveLength(0);
  });
});

describe('overview and usage', () => {
  it('counts the platform and estimates consumption from the configured prices', async () => {
    await db.client.aIProvider.updateMany({ data: { isActive: true } });
    const openai = await db.client.aIProvider.findFirstOrThrow({
      where: { type: 'OPENAI' },
    });
    const gemini = await db.client.aIProvider.findFirstOrThrow({
      where: { type: 'GEMINI' },
    });
    await db.client.aIConfiguration.deleteMany();
    await db.client.aIConfiguration.createMany({
      data: [
        { providerId: gemini.id, purpose: 'CHAT', model: 'gemini-test', priority: 1 },
        { providerId: openai.id, purpose: 'CHAT', model: 'gpt-test', priority: 2 },
      ],
    });
    await db.client.usageEvent.deleteMany();
    const ana = await newUser();
    await connectGoogle(app, ana);

    // Gemini is down: one failed attempt, then OpenAI answers (1 + 1 tokens in the fake).
    ai.GEMINI.behavior = 'unavailable';
    await call(ana, 'post', '/assistant/messages', { message: 'oi' }).expect(200);
    await call(ana, 'post', '/assistant/messages', { message: 'tudo bem?' }).expect(200);
    // Voice: one transcription of 68 bytes.
    await call(ana, 'post', '/voice/transcriptions')
      .set('Content-Type', 'audio/ogg')
      .send(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64)]))
      .expect(200);

    await settings(root, {
      'usage.prices': [
        {
          kind: 'AI_CHAT',
          provider: 'OPENAI',
          model: 'gpt-test',
          input: '2.50',
          output: '10',
        },
      ],
    }).expect(200);

    const overview = (await call(root, 'get', '/admin/overview').expect(200)).body as {
      users: Json;
      google: Json;
      assistant: Json;
      usage: { rows: Json[]; estimatedCostUsd: string; unpriced: number };
      voice: { transcription: { providers: Json[] } };
    };
    expect(overview.users).toMatchObject({
      admins: expect.any(Number),
      blocked: expect.any(Number),
    });
    expect(Number(overview.google.connected)).toBeGreaterThanOrEqual(1);
    expect(Number(overview.assistant.messagesInWindow)).toBeGreaterThanOrEqual(2);

    const row = (provider: string, kind = 'AI_CHAT') =>
      overview.usage.rows.find(
        (item) => item.provider === provider && item.kind === kind,
      );
    expect(row('GEMINI')).toMatchObject({
      model: 'gemini-test',
      requests: 2,
      failures: 2,
      estimatedCostUsd: null,
    });
    expect(row('OPENAI')).toMatchObject({
      model: 'gpt-test',
      requests: 2,
      failures: 0,
      inputUnits: 2,
      outputUnits: 2,
      // 2 tokens × 2.50/M + 2 tokens × 10/M
      estimatedCostUsd: '0.000025',
    });
    expect(row('openai', 'VOICE_TRANSCRIPTION')).toMatchObject({
      requests: 1,
      inputUnits: 68,
    });
    expect(overview.usage.unpriced).toBe(2);
    expect(overview.voice.transcription.providers).toEqual([
      { provider: 'openai', keyConfigured: true, model: null },
    ]);
  });

  it('computes the estimate exactly with decimals', async () => {
    const { estimateCost } = await import('../../src/admin/admin-overview.service.js');
    expect(
      estimateCost(
        {
          kind: 'AI_CHAT',
          provider: 'openai',
          model: 'm',
          inputUnits: 1_250_000,
          outputUnits: 300_000,
        },
        [
          {
            kind: 'AI_CHAT',
            provider: 'OPENAI',
            model: 'm',
            input: '2.50',
            output: '10',
          },
        ],
      ),
    ).toBe('6.125000');
    expect(
      estimateCost(
        {
          kind: 'VOICE_SPEECH',
          provider: 'openai',
          model: 't',
          inputUnits: 2_000_000,
          outputUnits: 999,
        },
        [
          {
            kind: 'VOICE_SPEECH',
            provider: 'openai',
            model: 't',
            input: '15',
            output: '99',
          },
        ],
      ),
    ).toBe('30.000000');
    expect(
      estimateCost(
        { kind: 'AI_CHAT', provider: 'x', model: 'y', inputUnits: 1, outputUnits: 1 },
        [],
      ),
    ).toBeNull();
  });
});

describe('secrets', () => {
  it('never returns an API key in any admin response', async () => {
    const openai = await db.client.aIProvider.findFirstOrThrow({
      where: { type: 'OPENAI' },
    });
    const created = await call(
      root,
      'post',
      `/admin/ai-providers/${openai.id}/configurations`,
      {
        purpose: 'ANALYSIS',
        model: 'gpt-secret-test',
        apiKey: AI_SECRET,
      },
    );
    expect([200, 201]).toContain(created.status);

    const bodies = await Promise.all(
      ['/admin/overview', '/admin/users', '/admin/settings', '/admin/ai-providers'].map(
        async (path) => JSON.stringify((await call(root, 'get', path).expect(200)).body),
      ),
    );
    for (const body of [...bodies, JSON.stringify(created.body)]) {
      expect(body).not.toContain(AI_SECRET);
      expect(body).not.toContain(AI_SECRET.slice(0, 12));
      expect(body).not.toContain(STT_SECRET);
      expect(body).not.toContain('sk-env-openai');
      expect(body).not.toContain('gm-env-key');
    }
    const stored = await db.client.aIConfiguration.findFirstOrThrow({
      where: { model: 'gpt-secret-test' },
    });
    expect(stored.apiKeyEncrypted).not.toContain(AI_SECRET);
  });
});
