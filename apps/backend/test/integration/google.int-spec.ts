import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { hashToken } from '../../src/auth/tokens.js';
import { CredentialVault } from '../../src/common/crypto/credential-vault.js';
import {
  GoogleConnectionService,
  rotateGoogleCredentials,
  tokenContext,
} from '../../src/google/google-connection.service.js';
import {
  createDisposableDatabase,
  type DisposableDatabase,
} from './disposable-database.js';
import {
  createTestApp,
  defaultGrant,
  DRIVE_FILE,
  FakeGoogle,
  FakeGoogleOAuth,
  FRONTEND,
  loginAs,
  type Session,
  setCookies,
  TEST_ENCRYPTION_KEY_V1,
  testEnv,
} from './support.js';

let db: DisposableDatabase;
let app: NestExpressApplication;
let google: FakeGoogle;
let oauth: FakeGoogleOAuth;
let service: GoogleConnectionService;

let sequence = 0;
async function newUser(): Promise<Session & { id: string; email: string }> {
  sequence += 1;
  const email = `user${sequence}@example.com`;
  const session = await loginAs(app, google, { subject: `sub-${sequence}`, email });
  const user = await db.client.user.findUniqueOrThrow({ where: { email } });
  return { ...session, id: user.id, email };
}

beforeAll(async () => {
  db = await createDisposableDatabase();
  testEnv(db.url);
  google = new FakeGoogle();
  oauth = new FakeGoogleOAuth();
  app = await createTestApp(google, [], oauth);
  service = app.get(GoogleConnectionService);
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

beforeEach(() => {
  oauth.grant = defaultGrant();
  oauth.failExchange = false;
  oauth.refreshBehavior = 'ok';
  oauth.revokeResult = true;
  oauth.refreshCalls = [];
  oauth.revokeCalls = [];
});

const http = () => request(app.getHttpServer());
const status = (session: Session) =>
  http().get('/api/v1/google/connection').set('Cookie', session.cookie);

async function startConnect(session: Session, redirectTo?: string) {
  const response = await http()
    .get('/api/v1/google/connect')
    .query(redirectTo ? { redirectTo } : {})
    .set('Cookie', session.cookie)
    .expect(302);
  const state =
    new URL(response.headers.location as string).searchParams.get('state') ?? '';
  return { response, state, cookie: setCookies(response).lff_google_state };
}

function callback(query: Record<string, string>, cookies: string[]) {
  return http()
    .get('/api/v1/google/callback')
    .query(query)
    .set('Cookie', cookies.join('; '))
    .expect(302);
}

async function connect(session: Session) {
  const { state } = await startConnect(session);
  return callback({ code: 'code', state }, [session.cookie, `lff_google_state=${state}`]);
}

const errorOf = (response: request.Response) =>
  new URL(response.headers.location as string).searchParams.get('googleError');

describe('status', () => {
  it('starts as NOT_CONNECTED and requires a session', async () => {
    const user = await newUser();
    const response = await status(user).expect(200);
    expect(response.body).toEqual({
      status: 'NOT_CONNECTED',
      googleEmail: null,
      grantedScopes: [],
      requiredScopes: [DRIVE_FILE],
      missingScopes: [DRIVE_FILE],
      connectedAt: null,
      lastRefreshedAt: null,
    });
    await http().get('/api/v1/google/connection').expect(401);
  });
});

describe('connect flow', () => {
  it('redirects anonymous visitors to the login page', async () => {
    const response = await http().get('/api/v1/google/connect').expect(302);
    expect(response.headers.location).toBe(`${FRONTEND}/login?redirectTo=%2Fprofile`);
  });

  it('starts an incremental consent bound to the user and the browser', async () => {
    const user = await newUser();
    const { state, cookie } = await startConnect(user, '/profile');

    expect(oauth.lastConsent?.loginHint).toBe(user.email);
    expect(cookie?.attributes).toMatch(/HttpOnly/i);
    expect(cookie?.attributes).toMatch(/Path=\/api\/v1\/google/);
    const attempt = await db.client.authLoginAttempt.findUniqueOrThrow({
      where: { stateHash: hashToken(state) },
    });
    expect(attempt).toMatchObject({ purpose: 'GOOGLE_CONNECTION', userId: user.id });
  });

  it('stores only encrypted tokens and exposes only the status', async () => {
    const user = await newUser();
    const response = await connect(user);

    expect(response.headers.location).toBe(`${FRONTEND}/profile?google=connected`);
    const row = await db.client.googleConnection.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(row).toMatchObject({
      status: 'ACTIVE',
      googleSubject: 'google-sub-ana',
      googleEmail: 'ana.silva@example.com',
      encryptionKeyVersion: 'v1',
      grantedScopes: ['openid', DRIVE_FILE],
    });
    const stored = JSON.stringify(
      await db.query(`SELECT * FROM google_connections WHERE user_id = '${user.id}'`),
    );
    expect(stored).not.toContain('plain-access-token-123');
    expect(stored).not.toContain('plain-refresh-token-456');
    expect(row.refreshTokenEncrypted).toMatch(/^v1\./);

    const body = (await status(user).expect(200)).body as Record<string, unknown>;
    expect(body).toMatchObject({
      status: 'ACTIVE',
      googleEmail: 'ana.silva@example.com',
      missingScopes: [],
    });
    expect(JSON.stringify(body)).not.toMatch(/plain-|v1\./);
  });

  it("refuses a callback finished by another user's session (attempt kept)", async () => {
    const owner = await newUser();
    const other = await newUser();
    const { state } = await startConnect(owner);

    const response = await callback({ code: 'c', state }, [
      other.cookie,
      `lff_google_state=${state}`,
    ]);

    expect(errorOf(response)).toBe('invalid_state');
    expect(await db.client.googleConnection.count({ where: { userId: other.id } })).toBe(
      0,
    );
    expect(
      await db.client.authLoginAttempt.count({ where: { stateHash: hashToken(state) } }),
    ).toBe(1);
  });

  it('sends a callback without session to login and keeps login/connection states apart', async () => {
    const user = await newUser();
    const { state } = await startConnect(user);

    const anonymous = await callback({ code: 'c', state }, [`lff_google_state=${state}`]);
    expect(anonymous.headers.location).toBe(
      `${FRONTEND}/login?googleError=unauthenticated`,
    );

    // A connection state cannot finish a login…
    const login = await http()
      .get('/api/v1/auth/google/callback')
      .query({ code: 'c', state })
      .set('Cookie', `lff_oauth_state=${state}`)
      .expect(302);
    expect(new URL(login.headers.location as string).searchParams.get('error')).toBe(
      'invalid_state',
    );

    // …and a login state cannot finish a connection.
    const loginStart = await http().get('/api/v1/auth/google/login').expect(302);
    const loginState =
      new URL(loginStart.headers.location as string).searchParams.get('state') ?? '';
    const mixed = await callback({ code: 'c', state: loginState }, [
      user.cookie,
      `lff_google_state=${loginState}`,
    ]);
    expect(errorOf(mixed)).toBe('invalid_state');
  });

  it.each([
    [
      'missing state cookie',
      (state: string, user: Session) => [{ code: 'c', state }, [user.cookie]] as const,
    ],
    [
      'user cancelled',
      (state: string, user: Session) =>
        [
          { error: 'access_denied', state },
          [user.cookie, `lff_google_state=${state}`],
        ] as const,
    ],
  ])('handles %s', async (label, build) => {
    const user = await newUser();
    const { state } = await startConnect(user);
    const [query, cookies] = build(state, user);

    const response = await callback(query, [...cookies]);
    expect(errorOf(response)).toBe(
      label === 'user cancelled' ? 'access_denied' : 'invalid_state',
    );
  });

  it('rejects a consent without the Drive scope and stores nothing', async () => {
    const user = await newUser();
    oauth.grant = { ...defaultGrant(), scopes: ['openid', 'email'] };

    expect(errorOf(await connect(user))).toBe('insufficient_scopes');
    expect(await db.client.googleConnection.count({ where: { userId: user.id } })).toBe(
      0,
    );
  });

  it('needs a refresh token on the first connection but keeps the stored one on reconsent', async () => {
    const user = await newUser();
    const withoutRefresh = defaultGrant();
    delete withoutRefresh.refreshToken;
    oauth.grant = withoutRefresh;
    expect(errorOf(await connect(user))).toBe('missing_refresh_token');

    oauth.grant = defaultGrant();
    await connect(user);
    oauth.grant = { ...withoutRefresh, accessToken: 'second-access' };
    await connect(user);

    const row = await db.client.googleConnection.findUniqueOrThrow({
      where: { userId: user.id },
    });
    const vault = new CredentialVault(
      new Map([['v1', Buffer.from(TEST_ENCRYPTION_KEY_V1, 'base64')]]),
      'v1',
    );
    expect(
      vault.decrypt(
        row.refreshTokenEncrypted ?? '',
        tokenContext(user.id, 'refresh_token'),
      ),
    ).toBe('plain-refresh-token-456');
  });
});

describe('access tokens (internal use)', () => {
  it('returns the stored token while valid and refreshes it near expiry', async () => {
    const user = await newUser();
    await connect(user);

    expect(await service.getAccessToken(user.id)).toBe('plain-access-token-123');
    expect(oauth.refreshCalls).toEqual([]);

    await db.client.googleConnection.update({
      where: { userId: user.id },
      data: { accessTokenExpiresAt: new Date(Date.now() + 10_000) },
    });
    const refreshed = await service.getAccessToken(user.id);

    expect(refreshed).toMatch(/^refreshed-access-/);
    expect(oauth.refreshCalls).toEqual(['plain-refresh-token-456']);
    const row = await db.client.googleConnection.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(row.accessTokenEncrypted).not.toContain(refreshed);
    expect(row.lastRefreshedAt).not.toBeNull();
    expect(await service.getAccessToken(user.id)).toBe(refreshed);
  });

  it('marks the connection NEEDS_REAUTH when Google revoked the grant, then allows reconnection', async () => {
    const user = await newUser();
    await connect(user);
    await db.client.googleConnection.update({
      where: { userId: user.id },
      data: { accessTokenExpiresAt: new Date(Date.now() - 1000) },
    });
    oauth.refreshBehavior = 'revoked';

    await expect(service.getAccessToken(user.id)).rejects.toMatchObject({
      response: { code: 'google_reauth_required' },
    });
    const row = await db.client.googleConnection.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(row).toMatchObject({
      status: 'NEEDS_REAUTH',
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
    });
    expect((await status(user).expect(200)).body).toMatchObject({
      status: 'NEEDS_REAUTH',
      missingScopes: [DRIVE_FILE],
    });

    oauth.refreshBehavior = 'ok';
    expect(
      new URL((await connect(user)).headers.location as string).searchParams.get(
        'google',
      ),
    ).toBe('connected');
    expect((await status(user).expect(200)).body).toMatchObject({ status: 'ACTIVE' });
  });

  it('keeps the connection on transient Google failures', async () => {
    const user = await newUser();
    await connect(user);
    await db.client.googleConnection.update({
      where: { userId: user.id },
      data: { accessTokenExpiresAt: new Date(Date.now() - 1000) },
    });
    oauth.refreshBehavior = 'outage';

    await expect(service.getAccessToken(user.id)).rejects.toMatchObject({
      response: { code: 'google_unavailable' },
    });
    expect(
      (await db.client.googleConnection.findUniqueOrThrow({ where: { userId: user.id } }))
        .status,
    ).toBe('ACTIVE');
  });

  it('cannot decrypt a token copied into another user (context-bound ciphertext)', async () => {
    const victim = await newUser();
    const attacker = await newUser();
    await connect(victim);
    await connect(attacker);
    const stolen = await db.client.googleConnection.findUniqueOrThrow({
      where: { userId: victim.id },
    });
    await db.client.googleConnection.update({
      where: { userId: attacker.id },
      data: { accessTokenEncrypted: stolen.accessTokenEncrypted },
    });

    await expect(service.getAccessToken(attacker.id)).rejects.toMatchObject({
      response: { code: 'google_reauth_required' },
    });
    // The unreadable value is kept (recoverable by an operator) and the victim is unaffected.
    expect(
      (
        await db.client.googleConnection.findUniqueOrThrow({
          where: { userId: attacker.id },
        })
      ).accessTokenEncrypted,
    ).toBe(stolen.accessTokenEncrypted);
    expect(await service.getAccessToken(victim.id)).toBe('plain-access-token-123');
  });

  it('reports not connected / reauth for users without an active connection', async () => {
    const user = await newUser();
    await expect(service.getAccessToken(user.id)).rejects.toMatchObject({
      response: { code: 'google_not_connected' },
    });
  });
});

describe('disconnect', () => {
  it('revokes at Google, deletes local tokens and keeps spreadsheets', async () => {
    const user = await newUser();
    await connect(user);
    await db.client.spreadsheet.create({
      data: {
        ownerId: user.id,
        name: 'Pessoal',
        googleSpreadsheetId: `sheet-${user.id}`,
        status: 'ACTIVE',
      },
    });

    const response = await http()
      .delete('/api/v1/google/connection')
      .set('Cookie', user.cookie)
      .set('X-CSRF-Token', user.csrf)
      .expect(200);

    expect(response.body).toEqual({ status: 'REVOKED', remoteRevocation: 'revoked' });
    expect(oauth.revokeCalls).toEqual(['plain-refresh-token-456']);
    const row = await db.client.googleConnection.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(row).toMatchObject({
      status: 'REVOKED',
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      grantedScopes: [],
    });
    expect(row.revokedAt).not.toBeNull();
    expect(await db.client.spreadsheet.count({ where: { ownerId: user.id } })).toBe(1);
    await expect(service.getAccessToken(user.id)).rejects.toMatchObject({
      response: { code: 'google_reauth_required' },
    });
  });

  it('still deletes local tokens when Google cannot be reached', async () => {
    const user = await newUser();
    await connect(user);
    oauth.revokeResult = false;

    const response = await http()
      .delete('/api/v1/google/connection')
      .set('Cookie', user.cookie)
      .set('X-CSRF-Token', user.csrf)
      .expect(200);

    expect(response.body).toEqual({ status: 'REVOKED', remoteRevocation: 'failed' });
    expect(
      (await db.client.googleConnection.findUniqueOrThrow({ where: { userId: user.id } }))
        .refreshTokenEncrypted,
    ).toBeNull();
  });

  it("requires CSRF and only touches the caller's connection", async () => {
    const owner = await newUser();
    const other = await newUser();
    await connect(owner);

    await http()
      .delete('/api/v1/google/connection')
      .set('Cookie', other.cookie)
      .expect(403);
    await http()
      .delete('/api/v1/google/connection')
      .set('Cookie', other.cookie)
      .set('X-CSRF-Token', other.csrf)
      .expect(200)
      .expect({ status: 'NOT_CONNECTED', remoteRevocation: 'skipped' });

    expect((await status(owner).expect(200)).body).toMatchObject({ status: 'ACTIVE' });
    expect((await status(other).expect(200)).body).toMatchObject({
      status: 'NOT_CONNECTED',
    });
  });
});

describe('storage guarantees', () => {
  it('refuses plaintext tokens and inconsistent states at the database level', async () => {
    const user = await newUser();
    const base = {
      userId: user.id,
      googleSubject: 's',
      googleEmail: 'e@example.com',
      grantedScopes: [],
    };

    await expect(
      db.client.googleConnection.create({
        data: {
          ...base,
          status: 'ACTIVE',
          refreshTokenEncrypted: 'plain-refresh-token',
          encryptionKeyVersion: 'v1',
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.googleConnection.create({ data: { ...base, status: 'ACTIVE' } }),
    ).rejects.toThrow();
    await expect(
      db.client.googleConnection.create({ data: { ...base, status: 'REVOKED' } }),
    ).rejects.toThrow();
  });

  it('rotates every stored credential to the active key version', async () => {
    const user = await newUser();
    await connect(user);
    const keyV1 = Buffer.from(TEST_ENCRYPTION_KEY_V1, 'base64');
    const vaultV2 = new CredentialVault(
      new Map([
        ['v1', keyV1],
        ['v2', Buffer.alloc(32, 0x22)],
      ]),
      'v2',
    );

    const first = await rotateGoogleCredentials(db.client, vaultV2);
    expect(first.rotated).toBeGreaterThanOrEqual(1);
    // The deliberately corrupted credential from the context-binding test is skipped, not fatal.
    expect(first.failed).toBe(1);
    const row = await db.client.googleConnection.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(row.encryptionKeyVersion).toBe('v2');
    expect(row.refreshTokenEncrypted).toMatch(/^v2\./);
    expect(
      vaultV2.decrypt(
        row.refreshTokenEncrypted ?? '',
        tokenContext(user.id, 'refresh_token'),
      ),
    ).toBe('plain-refresh-token-456');

    expect((await rotateGoogleCredentials(db.client, vaultV2)).rotated).toBe(0);
  });
});

describe('without configuration', () => {
  it('redirects with google_connection_unavailable when no encryption key is set', async () => {
    testEnv(db.url, { DATA_ENCRYPTION_KEY_V1: '' });
    const unconfigured = await createTestApp(google, [], new FakeGoogleOAuth());
    try {
      const user = await loginAs(unconfigured, google, {
        subject: 'sub-nokey',
        email: 'nokey@example.com',
      });
      const response = await request(unconfigured.getHttpServer())
        .get('/api/v1/google/connect')
        .set('Cookie', user.cookie)
        .expect(302);
      expect(response.headers.location).toBe(
        `${FRONTEND}/profile?googleError=google_connection_unavailable`,
      );
    } finally {
      await unconfigured.close();
      testEnv(db.url);
    }
  });
});
