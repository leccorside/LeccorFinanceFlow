import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { hashToken, pkceChallenge } from '../../src/auth/tokens.js';
import {
  createDisposableDatabase,
  type DisposableDatabase,
} from './disposable-database.js';
import {
  createTestApp,
  defaultIdentity,
  FakeGoogle,
  FRONTEND,
  setCookies,
  testEnv,
} from './support.js';

let db: DisposableDatabase;
let app: NestExpressApplication;
let google: FakeGoogle;

const createApp = createTestApp;

beforeAll(async () => {
  db = await createDisposableDatabase();
  testEnv(db.url);
  google = new FakeGoogle();
  app = await createApp(google);
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

beforeEach(() => {
  google.identity = defaultIdentity();
  google.failExchange = false;
});

const http = () => request(app.getHttpServer());

async function startLogin(redirectTo?: string) {
  const response = await http()
    .get('/api/v1/auth/google/login')
    .query(redirectTo === undefined ? {} : { redirectTo })
    .expect(302);
  const state =
    new URL(response.headers.location as string).searchParams.get('state') ?? '';
  return { response, state, cookie: setCookies(response).lff_oauth_state };
}

async function callback(query: Record<string, string>, stateCookie?: string) {
  const call = http().get('/api/v1/auth/google/callback').query(query);
  if (stateCookie !== undefined) {
    call.set('Cookie', `lff_oauth_state=${stateCookie}`);
  }
  return call.expect(302);
}

/** Full successful login; returns the session cookies. */
async function login(redirectTo?: string) {
  const { state } = await startLogin(redirectTo);
  const response = await callback({ code: 'code-1', state }, state);
  const cookies = setCookies(response);
  return {
    response,
    access: cookies.lff_session?.value ?? '',
    refresh: cookies.lff_refresh?.value ?? '',
  };
}

const me = (access: string) =>
  http().get('/api/v1/auth/me').set('Cookie', `lff_session=${access}`);

function errorRedirect(response: request.Response): string | null {
  return new URL(response.headers.location as string).searchParams.get('error');
}

describe('GET /auth/google/login', () => {
  it('redirects to Google with state, nonce and S256 PKCE, binding state in a cookie', async () => {
    const { response, state, cookie } = await startLogin('/dashboard');

    expect(response.headers.location).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie?.value).toBe(state);
    expect(cookie?.attributes).toMatch(/HttpOnly/i);
    expect(cookie?.attributes).toMatch(/SameSite=Lax/i);
    expect(cookie?.attributes).toMatch(/Path=\/api\/v1\/auth\/google/);
    expect(cookie?.attributes).toMatch(/Max-Age=600/);

    // Only the hash of the state is stored.
    const attempts = await db.client.authLoginAttempt.findMany({
      where: { stateHash: hashToken(state) },
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.redirectPath).toBe('/dashboard');
    expect(await db.client.authLoginAttempt.count({ where: { stateHash: state } })).toBe(
      0,
    );
  });

  it('neutralizes open redirects in redirectTo', async () => {
    const { response } = await login('//evil.example/phish');
    expect(response.headers.location).toBe(`${FRONTEND}/`);
  });
});

describe('GET /auth/google/callback', () => {
  it('creates the user, opens a session and sets secure cookies', async () => {
    const { response, access, refresh } = await login('/dashboard');

    expect(response.headers.location).toBe(`${FRONTEND}/dashboard`);
    const cookies = setCookies(response);
    expect(cookies.lff_session?.attributes).toMatch(/HttpOnly/i);
    expect(cookies.lff_session?.attributes).toMatch(/Path=\/api(;|$)/);
    expect(cookies.lff_session?.attributes).toMatch(/SameSite=Lax/i);
    expect(cookies.lff_refresh?.attributes).toMatch(/HttpOnly/i);
    expect(cookies.lff_refresh?.attributes).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookies.lff_refresh?.attributes).toMatch(/SameSite=Strict/i);
    expect(cookies.lff_oauth_state?.attributes).toMatch(/Expires=Thu, 01 Jan 1970/);

    // PKCE and nonce: the verifier sent to Google matches the challenge, and the nonce round-trips.
    expect(pkceChallenge(google.lastExchange?.codeVerifier ?? '')).toBe(
      google.lastAuthorization?.codeChallenge,
    );
    expect(google.lastExchange?.nonce).toBe(google.lastAuthorization?.nonce);

    const user = await db.client.user.findUniqueOrThrow({
      where: { googleSubject: 'google-sub-ana' },
      include: { roles: { include: { role: true } }, profile: true },
    });
    expect(user.email).toBe('ana.silva@example.com');
    expect(user.lastLoginAt).not.toBeNull();
    expect(user.roles.map(({ role }) => role.name)).toEqual(['USER']);
    expect(user.profile).toMatchObject({ firstName: 'Ana', lastName: 'Silva' });

    // Tokens are stored only as hashes.
    const session = await db.client.userSession.findUniqueOrThrow({
      where: { accessTokenHash: hashToken(access) },
    });
    expect(session.refreshTokenHash).toBe(hashToken(refresh));

    const body = (await me(access).expect(200)).body as Record<string, unknown>;
    expect(body).toMatchObject({
      email: 'ana.silva@example.com',
      status: 'ACTIVE',
      roles: ['USER'],
      profile: { firstName: 'Ana', lastName: 'Silva' },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(access);
    expect(serialized).not.toContain(refresh);
  });

  it('logs in the same user again without duplicating it', async () => {
    await login();
    await login();
    expect(
      await db.client.user.count({ where: { googleSubject: 'google-sub-ana' } }),
    ).toBe(1);
  });

  it('rejects a replayed callback (state is single-use)', async () => {
    const { state } = await startLogin();
    await callback({ code: 'code-1', state }, state);
    const sessionsBefore = await db.client.userSession.count();

    const replay = await callback({ code: 'code-1', state }, state);

    expect(errorRedirect(replay)).toBe('invalid_state');
    expect(setCookies(replay).lff_session).toBeUndefined();
    expect(await db.client.userSession.count()).toBe(sessionsBefore);
  });

  it.each([
    [
      'missing state cookie',
      (state: string) => [{ code: 'c', state }, undefined] as const,
    ],
    [
      'state cookie from another login',
      (state: string) => [{ code: 'c', state }, 'other'] as const,
    ],
    ['missing state parameter', (state: string) => [{ code: 'c' }, state] as const],
  ])('rejects %s without consuming the pending login', async (_label, build) => {
    const { state } = await startLogin();
    const [query, cookie] = build(state);

    expect(errorRedirect(await callback(query, cookie))).toBe('invalid_state');
    expect(
      await db.client.authLoginAttempt.count({ where: { stateHash: hashToken(state) } }),
    ).toBe(1);
  });

  it('rejects an expired pending login', async () => {
    const { state } = await startLogin();
    await db.client.authLoginAttempt.update({
      where: { stateHash: hashToken(state) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(errorRedirect(await callback({ code: 'c', state }, state))).toBe(
      'expired_state',
    );
  });

  it('maps a provider failure and a user cancellation', async () => {
    google.failExchange = true;
    const { state } = await startLogin();
    expect(errorRedirect(await callback({ code: 'c', state }, state))).toBe(
      'provider_error',
    );

    const second = await startLogin();
    expect(
      errorRedirect(
        await callback({ error: 'access_denied', state: second.state }, second.state),
      ),
    ).toBe('access_denied');
  });

  it('refuses an unverified e-mail and creates nothing', async () => {
    google.identity = {
      ...defaultIdentity(),
      subject: 'unverified',
      email: 'x@example.com',
      emailVerified: false,
    };
    const { state } = await startLogin();

    expect(errorRedirect(await callback({ code: 'c', state }, state))).toBe(
      'email_not_verified',
    );
    expect(await db.client.user.count({ where: { googleSubject: 'unverified' } })).toBe(
      0,
    );
  });

  it('refuses a blocked user and opens no session', async () => {
    const blocked = await db.client.user.create({
      data: {
        email: 'blocked@example.com',
        googleSubject: 'google-sub-blocked',
        status: 'BLOCKED',
      },
    });
    google.identity = {
      ...defaultIdentity(),
      subject: 'google-sub-blocked',
      email: 'blocked@example.com',
    };
    const { state } = await startLogin();

    expect(errorRedirect(await callback({ code: 'c', state }, state))).toBe(
      'account_blocked',
    );
    expect(await db.client.userSession.count({ where: { userId: blocked.id } })).toBe(0);
  });

  it('links an existing account by e-mail, but never steals one bound to another Google account', async () => {
    const invited = await db.client.user.create({
      data: { email: 'invited@example.com' },
    });
    google.identity = {
      ...defaultIdentity(),
      subject: 'google-sub-invited',
      email: 'Invited@Example.com',
    };
    await login();
    expect(
      (await db.client.user.findUniqueOrThrow({ where: { id: invited.id } }))
        .googleSubject,
    ).toBe('google-sub-invited');

    google.identity = {
      ...defaultIdentity(),
      subject: 'google-sub-attacker',
      email: 'invited@example.com',
    };
    const { state } = await startLogin();
    expect(errorRedirect(await callback({ code: 'c', state }, state))).toBe(
      'account_conflict',
    );
  });
});

describe('session lifecycle', () => {
  it('rejects requests without a valid session', async () => {
    await http().get('/api/v1/auth/me').expect(401);
    await me('not-a-real-token').expect(401);
  });

  it('rejects an expired access token', async () => {
    const { access } = await login();
    await db.client.userSession.update({
      where: { accessTokenHash: hashToken(access) },
      data: { accessExpiresAt: new Date(Date.now() - 1000) },
    });
    await me(access).expect(401);
  });

  it('rotates tokens on refresh and invalidates the previous access token', async () => {
    const { access, refresh } = await login();

    const rotated = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `lff_refresh=${refresh}`)
      .expect(204);
    const cookies = setCookies(rotated);
    const newAccess = cookies.lff_session?.value ?? '';
    const newRefresh = cookies.lff_refresh?.value ?? '';

    expect(newAccess).not.toBe(access);
    expect(newRefresh).not.toBe(refresh);
    await me(access).expect(401);
    await me(newAccess).expect(200);
  });

  it('revokes the whole session when a rotated refresh token is replayed', async () => {
    const { refresh } = await login();
    const rotated = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `lff_refresh=${refresh}`)
      .expect(204);
    const newAccess = setCookies(rotated).lff_session?.value ?? '';

    const replay = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `lff_refresh=${refresh}`)
      .expect(401);

    expect(replay.body).toMatchObject({ code: 'invalid_session' });
    await me(newAccess).expect(401);
    const session = await db.client.userSession.findUniqueOrThrow({
      where: { accessTokenHash: hashToken(newAccess) },
    });
    expect(session.revokedReason).toBe('refresh_reuse');
  });

  it('rejects an expired refresh token and clears cookies', async () => {
    const { refresh } = await login();
    await db.client.userSession.update({
      where: { refreshTokenHash: hashToken(refresh) },
      data: {
        refreshExpiresAt: new Date(Date.now() - 1000),
        accessExpiresAt: new Date(Date.now() - 2000),
      },
    });

    const response = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `lff_refresh=${refresh}`)
      .expect(401);
    expect(setCookies(response).lff_refresh?.attributes).toMatch(
      /Expires=Thu, 01 Jan 1970/,
    );
  });

  it('logout revokes the session and is idempotent', async () => {
    const { access, refresh } = await login();

    const response = await http()
      .post('/api/v1/auth/logout')
      .set('Cookie', `lff_session=${access}; lff_refresh=${refresh}`)
      .expect(204);

    expect(setCookies(response).lff_session?.attributes).toMatch(
      /Expires=Thu, 01 Jan 1970/,
    );
    await me(access).expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `lff_refresh=${refresh}`)
      .expect(401);
    await http().post('/api/v1/auth/logout').expect(204);
  });

  it('cuts off an existing session as soon as the user is blocked', async () => {
    google.identity = {
      ...defaultIdentity(),
      subject: 'google-sub-later-blocked',
      email: 'later@example.com',
    };
    const { access, refresh } = await login();
    await me(access).expect(200);

    await db.client.user.update({
      where: { email: 'later@example.com' },
      data: { status: 'BLOCKED' },
    });

    await me(access).expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `lff_refresh=${refresh}`)
      .expect(401);
    const session = await db.client.userSession.findUniqueOrThrow({
      where: { accessTokenHash: hashToken(access) },
    });
    expect(session.revokedReason).toBe('user_blocked');
  });
});

describe('without Google configuration', () => {
  it('answers 503 on login instead of failing at startup', async () => {
    const unconfigured = await createApp(null);
    try {
      const response = await request(unconfigured.getHttpServer())
        .get('/api/v1/auth/google/login')
        .expect(503);
      expect(response.body).toMatchObject({ code: 'oauth_not_configured' });
    } finally {
      await unconfigured.close();
    }
  });
});
