import { type Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AI_PROVIDER_CLIENTS, type AiProviderClients } from '../../src/ai/ai.types.js';
import { VOICE_CLIENTS, type VoiceClients } from '../../src/voice/voice.types.js';
import { FakeVoiceClients } from './fake-voice.js';
import { AppModule } from '../../src/app.module.js';
import {
  type AuthorizationRequest,
  type CodeExchange,
  GOOGLE_IDENTITY_PROVIDER,
  type GoogleIdentity,
  type GoogleIdentityProvider,
} from '../../src/auth/google-identity.provider.js';
import { configureApp } from '../../src/common/security/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import {
  type ConsentExchange,
  type ConsentRequest,
  GOOGLE_OAUTH_CLIENT,
  type GoogleConnectionGrant,
  GoogleGrantRevokedError,
  type GoogleOAuthClient,
  type GoogleTokenSet,
} from '../../src/google/google-oauth.client.js';
import {
  GOOGLE_WORKSPACE_CLIENT,
  type GoogleWorkspaceClient,
} from '../../src/spreadsheets/google-workspace.client.js';
import { FakeAiClients } from './fake-ai.js';
import { FakeWorkspace } from './fake-workspace.js';

export const FRONTEND = 'http://localhost:5173';
export const REDIRECT_URI = 'http://localhost:5173/api/v1/auth/google/callback';

/** Environment shared by integration apps; generous limits so tests are not throttled. */
export function testEnv(
  databaseUrl: string,
  overrides: Record<string, string> = {},
): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    FRONTEND_URL: FRONTEND,
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_REDIRECT_URI: REDIRECT_URI,
    RATE_LIMIT_MAX_REQUESTS: '100000',
    AUTH_RATE_LIMIT_MAX_REQUESTS: '100000',
    SPREADSHEET_RATE_LIMIT_MAX_REQUESTS: '100000',
    ASSISTANT_RATE_LIMIT_MAX_REQUESTS: '100000',
    VOICE_RATE_LIMIT_MAX_REQUESTS: '100000',
    REPORT_RATE_LIMIT_MAX_REQUESTS: '100000',
    ADMIN_EMAILS: '',
    DATA_ENCRYPTION_KEY_V1: TEST_ENCRYPTION_KEY_V1,
    DATA_ENCRYPTION_KEY_ACTIVE_VERSION: 'v1',
    ...overrides,
  });
}

/** Fixed test-only key (base64 of 32 bytes). */
export const TEST_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 0x11).toString('base64');

export class FakeGoogle implements GoogleIdentityProvider {
  identity: GoogleIdentity = defaultIdentity();
  failExchange = false;
  lastAuthorization?: AuthorizationRequest;
  lastExchange?: CodeExchange;

  buildAuthorizationUrl(authorization: AuthorizationRequest): URL {
    this.lastAuthorization = authorization;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('state', authorization.state);
    url.searchParams.set('nonce', authorization.nonce);
    url.searchParams.set('code_challenge', authorization.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url;
  }

  async exchangeCode(exchange: CodeExchange): Promise<GoogleIdentity> {
    this.lastExchange = exchange;
    if (this.failExchange) {
      throw new Error('token endpoint failure');
    }
    return this.identity;
  }
}

export function defaultIdentity(): GoogleIdentity {
  return {
    subject: 'google-sub-ana',
    email: '  Ana.Silva@Example.com ',
    emailVerified: true,
    givenName: 'Ana',
    familyName: 'Silva',
    picture: 'https://lh3.googleusercontent.com/a/ana',
  };
}

export const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';

/** Fake Google OAuth for the Drive/Sheets connection. Records every call. */
export class FakeGoogleOAuth implements GoogleOAuthClient {
  grant: GoogleConnectionGrant = defaultGrant();
  failExchange = false;
  refreshBehavior: 'ok' | 'revoked' | 'outage' = 'ok';
  revokeResult = true;
  lastConsent?: ConsentRequest;
  lastExchange?: ConsentExchange;
  refreshCalls: string[] = [];
  revokeCalls: string[] = [];
  private counter = 0;

  buildConsentUrl(request: ConsentRequest): URL {
    this.lastConsent = request;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('state', request.state);
    url.searchParams.set('scope', 'openid email ' + DRIVE_FILE);
    return url;
  }

  async exchangeCode(exchange: ConsentExchange): Promise<GoogleConnectionGrant> {
    this.lastExchange = exchange;
    if (this.failExchange) throw new Error('token endpoint failure');
    return this.grant;
  }

  async refresh(refreshToken: string): Promise<GoogleTokenSet> {
    this.refreshCalls.push(refreshToken);
    if (this.refreshBehavior === 'revoked') throw new GoogleGrantRevokedError();
    if (this.refreshBehavior === 'outage') throw new Error('503 from Google');
    this.counter += 1;
    return {
      accessToken: `refreshed-access-${this.counter}`,
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: [DRIVE_FILE],
    };
  }

  async revoke(token: string): Promise<boolean> {
    this.revokeCalls.push(token);
    return this.revokeResult;
  }
}

export function defaultGrant(): GoogleConnectionGrant {
  return {
    subject: 'google-sub-ana',
    email: 'Ana.Silva@Example.com',
    accessToken: 'plain-access-token-123',
    refreshToken: 'plain-refresh-token-456',
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: ['openid', DRIVE_FILE],
  };
}

/** Builds the real AppModule (+ extra modules) with the same HTTP hardening as main.ts. */
export async function createTestApp(
  provider: GoogleIdentityProvider | null,
  extraModules: Type[] = [],
  oauth: GoogleOAuthClient | null = new FakeGoogleOAuth(),
  workspace: GoogleWorkspaceClient = new FakeWorkspace(),
  ai: AiProviderClients = new FakeAiClients(),
  voice: VoiceClients = new FakeVoiceClients(),
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...extraModules],
  })
    .overrideProvider(GOOGLE_IDENTITY_PROVIDER)
    .useValue(provider)
    .overrideProvider(GOOGLE_OAUTH_CLIENT)
    .useValue(oauth)
    .overrideProvider(GOOGLE_WORKSPACE_CLIENT)
    .useValue(workspace)
    .overrideProvider(AI_PROVIDER_CLIENTS)
    .useValue(ai)
    .overrideProvider(VOICE_CLIENTS)
    .useValue(voice)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, loadEnv(process.env));
  await app.init();
  return app;
}

export interface SetCookie {
  value: string;
  attributes: string;
}

export function setCookies(response: request.Response): Record<string, SetCookie> {
  const header = response.headers['set-cookie'] as unknown;
  const list = Array.isArray(header) ? (header as string[]) : [];
  return Object.fromEntries(
    list.map((line) => {
      const [pair = '', ...attributes] = line.split(';');
      const separator = pair.indexOf('=');
      return [
        pair.slice(0, separator),
        {
          value: decodeURIComponent(pair.slice(separator + 1)),
          attributes: attributes.join(';'),
        },
      ];
    }),
  );
}

export interface Session {
  access: string;
  refresh: string;
  csrf: string;
  /** Cookie header with the access token. */
  cookie: string;
}

/** Full Google login through the HTTP API; returns cookies and the CSRF token. */
export async function loginAs(
  app: NestExpressApplication,
  google: FakeGoogle,
  identity: Partial<GoogleIdentity> = {},
): Promise<Session> {
  google.identity = { ...defaultIdentity(), ...identity };
  const server = app.getHttpServer();

  const start = await request(server).get('/api/v1/auth/google/login').expect(302);
  const state = new URL(start.headers.location as string).searchParams.get('state') ?? '';
  const callback = await request(server)
    .get('/api/v1/auth/google/callback')
    .query({ code: 'code', state })
    .set('Cookie', `lff_oauth_state=${state}`)
    .expect(302);

  const cookies = setCookies(callback);
  const access = cookies.lff_session?.value ?? '';
  const refresh = cookies.lff_refresh?.value ?? '';
  if (!access) {
    throw new Error(`login failed: ${String(callback.headers.location)}`);
  }

  const csrf = await request(server)
    .get('/api/v1/auth/csrf')
    .set('Cookie', `lff_session=${access}`)
    .expect(200);

  return {
    access,
    refresh,
    csrf: (csrf.body as { csrfToken: string }).csrfToken,
    cookie: `lff_session=${access}`,
  };
}

/** Completes the Drive/Sheets consent for `session` through the HTTP API (fake Google). */
export async function connectGoogle(
  app: NestExpressApplication,
  session: Session,
): Promise<void> {
  const server = app.getHttpServer();
  const start = await request(server)
    .get('/api/v1/google/connect')
    .set('Cookie', session.cookie)
    .expect(302);
  const state = new URL(start.headers.location as string).searchParams.get('state') ?? '';
  const done = await request(server)
    .get('/api/v1/google/callback')
    .query({ code: 'code', state })
    .set('Cookie', `${session.cookie}; lff_google_state=${state}`)
    .expect(302);
  if (!String(done.headers.location).includes('google=connected')) {
    throw new Error(`google connection failed: ${String(done.headers.location)}`);
  }
}
