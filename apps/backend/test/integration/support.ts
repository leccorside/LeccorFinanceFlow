import { type Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
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
    ADMIN_EMAILS: '',
    ...overrides,
  });
}

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

/** Builds the real AppModule (+ extra modules) with the same HTTP hardening as main.ts. */
export async function createTestApp(
  provider: GoogleIdentityProvider | null,
  extraModules: Type[] = [],
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...extraModules],
  })
    .overrideProvider(GOOGLE_IDENTITY_PROVIDER)
    .useValue(provider)
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
