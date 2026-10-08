import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  createDisposableDatabase,
  type DisposableDatabase,
} from './disposable-database.js';
import { PolicyProbeModule } from './policy-probe.module.js';
import {
  createTestApp,
  FakeGoogle,
  FRONTEND,
  loginAs,
  type Session,
  testEnv,
} from './support.js';

const OTHER_ALLOWED_ORIGIN = 'https://app.example.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let db: DisposableDatabase;
let app: NestExpressApplication;
let google: FakeGoogle;
let alice: Session;
let bob: Session;
let admin: Session;

beforeAll(async () => {
  db = await createDisposableDatabase();
  testEnv(db.url, {
    ADMIN_EMAILS: 'Admin@Example.com',
    CORS_ALLOWED_ORIGINS: OTHER_ALLOWED_ORIGIN,
    MAX_JSON_BODY_SIZE: '2kb',
  });
  google = new FakeGoogle();
  app = await createTestApp(google, [PolicyProbeModule]);

  alice = await loginAs(app, google, {
    subject: 'sub-alice',
    email: 'alice@example.com',
  });
  bob = await loginAs(app, google, { subject: 'sub-bob', email: 'bob@example.com' });
  admin = await loginAs(app, google, {
    subject: 'sub-admin',
    email: 'admin@example.com',
  });
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

const http = () => request(app.getHttpServer());

/** Authenticated request with session cookie and (for writes) CSRF header. */
function as(session: Session, method: 'get' | 'post' | 'patch' | 'delete', path: string) {
  const call = http()[method](path).set('Cookie', session.cookie);
  return method === 'get' ? call : call.set('X-CSRF-Token', session.csrf);
}

async function createAccount(session: Session, name = 'Nubank') {
  const response = await as(session, 'post', '/api/v1/probe/accounts')
    .send({ name, type: 'DIGITAL' })
    .expect(201);
  return (response.body as { id: string }).id;
}

describe('admin bootstrap', () => {
  it('grants ADMIN to e-mails in ADMIN_EMAILS (case-insensitive) and only USER to others', async () => {
    const adminMe = await as(admin, 'get', '/api/v1/auth/me').expect(200);
    const aliceMe = await as(alice, 'get', '/api/v1/auth/me').expect(200);

    expect((adminMe.body as { roles: string[] }).roles.sort()).toEqual(['ADMIN', 'USER']);
    expect((aliceMe.body as { roles: string[] }).roles).toEqual(['USER']);
  });
});

describe('permission matrix', () => {
  const cases: [string, string, number, number, number][] = [
    // route, description, anonymous, user, admin
    ['/api/v1/probe/public', 'public route', 200, 200, 200],
    ['/api/v1/health', 'health', 200, 200, 200],
    ['/api/v1/probe/private', 'authenticated route', 401, 200, 200],
    ['/api/v1/auth/me', 'current user', 401, 200, 200],
    ['/api/v1/auth/csrf', 'csrf token', 401, 200, 200],
    ['/api/v1/admin/probe', 'admin-only route', 401, 403, 200],
  ];

  it.each(cases)(
    '%s (%s): anonymous %i, user %i, admin %i',
    async (path, _label, anon, user, adm) => {
      await http().get(path).expect(anon);
      await as(alice, 'get', path).expect(user);
      await as(admin, 'get', path).expect(adm);
    },
  );

  it('default-deny also covers unknown routes for anonymous clients', async () => {
    const response = await http().get('/api/v1/does-not-exist').expect(404);
    expect(response.body).toMatchObject({ code: 'not_found' });
  });
});

describe('ownership (IDOR)', () => {
  it('lets the owner read, update and delete their resource', async () => {
    const id = await createAccount(alice, 'Própria');

    const read = await as(alice, 'get', `/api/v1/probe/accounts/${id}`).expect(200);
    expect(read.body).toMatchObject({ id, name: 'Própria' });
    await as(alice, 'patch', `/api/v1/probe/accounts/${id}`)
      .send({ name: 'Renomeada' })
      .expect(200);
    await as(alice, 'delete', `/api/v1/probe/accounts/${id}`).expect(204);
  });

  it("answers another user's id exactly like a missing id, and changes nothing", async () => {
    const id = await createAccount(alice, 'Da Alice');
    const missing = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

    const foreign = await as(bob, 'get', `/api/v1/probe/accounts/${id}`).expect(404);
    const absent = await as(bob, 'get', `/api/v1/probe/accounts/${missing}`).expect(404);
    // requestId and timestamp differ per request by design; everything else must match.
    const strip = (body: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(body).filter(
          ([key]) => key !== 'requestId' && key !== 'timestamp',
        ),
      );
    expect(strip(foreign.body as Record<string, unknown>)).toEqual(
      strip(absent.body as Record<string, unknown>),
    );

    await as(bob, 'patch', `/api/v1/probe/accounts/${id}`)
      .send({ name: 'Hackeada' })
      .expect(404);
    await as(bob, 'delete', `/api/v1/probe/accounts/${id}`).expect(404);

    const stored = await db.client.financialAccount.findUniqueOrThrow({ where: { id } });
    expect(stored.name).toBe('Da Alice');
  });

  it('gives ADMIN no implicit bypass on user routes', async () => {
    const id = await createAccount(alice, 'Privada');
    await as(admin, 'get', `/api/v1/probe/accounts/${id}`).expect(404);
  });

  it('rejects malformed ids before querying', async () => {
    const response = await as(alice, 'get', '/api/v1/probe/accounts/123').expect(400);
    expect(response.body).toMatchObject({ code: 'validation_failed' });
  });
});

describe('input validation (mass assignment)', () => {
  it.each([
    ['ownerId', { ownerId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }],
    ['id', { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }],
    ['role', { role: 'ADMIN' }],
    ['isArchived', { isArchived: true }],
  ])('rejects the extra field %s and persists nothing', async (field, extra) => {
    const before = await db.client.financialAccount.count();

    const response = await as(alice, 'post', '/api/v1/probe/accounts')
      .send({ name: `Extra ${field}`, type: 'CASH', ...extra })
      .expect(400);

    expect(response.body).toMatchObject({ code: 'validation_failed' });
    const issues = (
      response.body as { details: { issues: { code: string; message: string }[] } }
    ).details.issues;
    expect(
      issues.some(
        (issue) => issue.code === 'unrecognized_keys' && issue.message.includes(field),
      ),
    ).toBe(true);
    expect(await db.client.financialAccount.count()).toBe(before);
  });

  it('reports invalid values without echoing them', async () => {
    const response = await as(alice, 'post', '/api/v1/probe/accounts')
      .send({ name: 12345, type: 'BITCOIN-WALLET-XYZ' })
      .expect(400);

    const serialized = JSON.stringify(response.body);
    expect(serialized).toContain('validation_failed');
    expect(serialized).not.toContain('BITCOIN-WALLET-XYZ');
  });

  it('rejects payloads above MAX_JSON_BODY_SIZE with 413', async () => {
    const response = await http()
      .post('/api/v1/probe/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ text: 'x'.repeat(4096) }))
      .expect(413);
    expect(response.body).toMatchObject({ code: 'payload_too_large' });
  });

  it('rejects malformed JSON with 400 under the error contract', async () => {
    const response = await http()
      .post('/api/v1/probe/echo')
      .set('Content-Type', 'application/json')
      .send('{"text": ')
      .expect(400);
    expect(response.body).toMatchObject({ code: 'bad_request' });
  });
});

describe('CSRF', () => {
  let sequence = 0;
  const post = (session: Session) =>
    http()
      .post('/api/v1/probe/accounts')
      .set('Cookie', session.cookie)
      .send({ name: `CSRF ${(sequence += 1)}`, type: 'CASH' });

  it('maps a unique violation to 409 conflict', async () => {
    await createAccount(bob, 'Duplicada');
    const response = await as(bob, 'post', '/api/v1/probe/accounts')
      .send({ name: 'Duplicada', type: 'DIGITAL' })
      .expect(409);
    expect(response.body).toMatchObject({ code: 'conflict' });
  });

  it('requires the session CSRF token on authenticated writes', async () => {
    const missing = await post(alice).expect(403);
    expect(missing.body).toMatchObject({ code: 'csrf_failed' });

    await post(alice).set('X-CSRF-Token', 'x'.repeat(43)).expect(403);
    await post(alice).set('X-CSRF-Token', bob.csrf).expect(403);
    await post(alice).set('X-CSRF-Token', alice.csrf).expect(201);
  });

  it('keeps the token stable across calls and refreshes (multi-tab)', async () => {
    const again = await as(alice, 'get', '/api/v1/auth/csrf').expect(200);
    expect((again.body as { csrfToken: string }).csrfToken).toBe(alice.csrf);

    const session = await loginAs(app, google, {
      subject: 'sub-refresh',
      email: 'refresh@example.com',
    });
    const rotated = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `lff_refresh=${session.refresh}`)
      .expect(204);
    const newAccess =
      /lff_session=([^;]+)/.exec(String(rotated.headers['set-cookie']))?.[1] ?? '';
    const csrf = await http()
      .get('/api/v1/auth/csrf')
      .set('Cookie', `lff_session=${newAccess}`)
      .expect(200);
    expect((csrf.body as { csrfToken: string }).csrfToken).toBe(session.csrf);
  });

  it('does not require the token on safe methods', async () => {
    await as(alice, 'get', '/api/v1/probe/private').expect(200);
  });

  it('rejects writes from foreign origins, even with a valid token', async () => {
    await post(alice)
      .set('X-CSRF-Token', alice.csrf)
      .set('Origin', 'https://evil.example')
      .expect(403);
    await post(alice)
      .set('X-CSRF-Token', alice.csrf)
      .set('Referer', 'https://evil.example/page')
      .expect(403);
    await post(alice).set('X-CSRF-Token', alice.csrf).set('Origin', 'null').expect(403);
    // Public write routes (logout) are origin-checked too.
    await http()
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://evil.example')
      .expect(403);
  });

  it('accepts writes from allowed origins', async () => {
    await post(alice).set('X-CSRF-Token', alice.csrf).set('Origin', FRONTEND).expect(201);
    await post(alice)
      .set('X-CSRF-Token', alice.csrf)
      .set('Origin', OTHER_ALLOWED_ORIGIN)
      .expect(201);
  });
});

describe('error contract', () => {
  it('returns code, message, details, requestId and timestamp, with X-Request-Id', async () => {
    const response = await http().get('/api/v1/probe/private').expect(401);
    const body = response.body as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual([
      'code',
      'details',
      'message',
      'requestId',
      'timestamp',
    ]);
    expect(body).toMatchObject({ code: 'unauthenticated', details: null });
    expect(body.requestId).toMatch(UUID);
    expect(response.headers['x-request-id']).toBe(body.requestId);
    expect(new Date(body.timestamp as string).toISOString()).toBe(body.timestamp);
  });

  it('ignores client-provided request ids', async () => {
    const response = await http()
      .get('/api/v1/probe/private')
      .set('X-Request-Id', 'injected')
      .expect(401);
    expect(response.headers['x-request-id']).not.toBe('injected');
  });

  it('never leaks internal error details', async () => {
    const response = await http().get('/api/v1/probe/crash').expect(500);
    const serialized = JSON.stringify(response.body);

    expect(response.body).toMatchObject({ code: 'internal_error' });
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toMatch(/stack|at .*\.ts/);
  });
});

describe('HTTP hardening', () => {
  it('sends security headers and hides the framework', async () => {
    const response = await http().get('/api/v1/health').expect(200);

    expect(response.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'cache-control': 'no-store',
    });
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS only for configured origins, with credentials', async () => {
    const allowed = await http()
      .options('/api/v1/probe/accounts')
      .set('Origin', OTHER_ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    expect(allowed.headers['access-control-allow-origin']).toBe(OTHER_ALLOWED_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(String(allowed.headers['access-control-allow-headers'])).toMatch(
      /x-csrf-token/i,
    );

    const denied = await http()
      .options('/api/v1/probe/accounts')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('rate limiting', () => {
  it('applies route-specific limits with 429 and Retry-After', async () => {
    for (let index = 0; index < 3; index += 1) {
      await http().get('/api/v1/probe/limited').expect(200);
    }
    const blocked = await http().get('/api/v1/probe/limited').expect(429);

    expect(blocked.body).toMatchObject({ code: 'rate_limited' });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('enforces the global and the auth budgets per client', async () => {
    testEnv(db.url, { RATE_LIMIT_MAX_REQUESTS: '5', AUTH_RATE_LIMIT_MAX_REQUESTS: '2' });
    const throttled = await createTestApp(new FakeGoogle(), [PolicyProbeModule]);
    try {
      const server = throttled.getHttpServer();

      await request(server).get('/api/v1/auth/google/login').expect(302);
      await request(server).get('/api/v1/auth/google/login').expect(302);
      await request(server).get('/api/v1/auth/google/login').expect(429);

      await request(server).get('/api/v1/health').expect(200);
      await request(server).get('/api/v1/health').expect(200);
      // 3 auth + 2 health = 5: the global budget is now exhausted for every route.
      const blocked = await request(server).get('/api/v1/health').expect(429);
      expect(blocked.body).toMatchObject({ code: 'rate_limited' });
    } finally {
      await throttled.close();
    }
  });
});
