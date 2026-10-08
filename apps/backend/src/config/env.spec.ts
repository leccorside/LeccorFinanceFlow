import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvValidationError, loadEnv, parseDurationMs } from './env.js';

const validDatabaseUrl =
  'postgresql://leccor:secret-value@postgres:5432/leccor_finance_flow';

const google = {
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'google-secret-value',
  GOOGLE_REDIRECT_URI: 'http://localhost:5173/api/v1/auth/google/callback',
};

describe('loadEnv', () => {
  it('applies defaults and coerces types', () => {
    const env = loadEnv({ DATABASE_URL: validDatabaseUrl });

    expect(env).toEqual({
      NODE_ENV: 'development',
      BACKEND_PORT: 3000,
      DATABASE_URL: validDatabaseUrl,
      FRONTEND_URL: 'http://localhost:5173',
      ACCESS_TOKEN_TTL: 15 * 60_000,
      REFRESH_TOKEN_TTL: 30 * 86_400_000,
      COOKIE_SECURE: false,
      GOOGLE_OAUTH: null,
    });
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('parses explicit values', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      BACKEND_PORT: '8080',
      DATABASE_URL: validDatabaseUrl,
      ACCESS_TOKEN_TTL: '5m',
      REFRESH_TOKEN_TTL: '7d',
      ...google,
    });

    expect(env.NODE_ENV).toBe('production');
    expect(env.BACKEND_PORT).toBe(8080);
    expect(env.ACCESS_TOKEN_TTL).toBe(5 * 60_000);
    expect(env.REFRESH_TOKEN_TTL).toBe(7 * 86_400_000);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.GOOGLE_OAUTH).toEqual({
      clientId: google.GOOGLE_CLIENT_ID,
      clientSecret: google.GOOGLE_CLIENT_SECRET,
      redirectUri: google.GOOGLE_REDIRECT_URI,
    });
  });

  it('lets COOKIE_SECURE override the production default', () => {
    expect(
      loadEnv({ DATABASE_URL: validDatabaseUrl, COOKIE_SECURE: 'true' }).COOKIE_SECURE,
    ).toBe(true);
    expect(
      loadEnv({
        DATABASE_URL: validDatabaseUrl,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'false',
      }).COOKIE_SECURE,
    ).toBe(false);
  });

  it('treats blank Google credentials as not configured, even with a redirect URI', () => {
    const env = loadEnv({
      DATABASE_URL: validDatabaseUrl,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: ' ',
      GOOGLE_REDIRECT_URI: 'http://localhost:5173/api/v1/auth/google/callback',
    });
    expect(env.GOOGLE_OAUTH).toBeNull();
  });

  it('defaults the redirect URI to the frontend origin', () => {
    const env = loadEnv({
      DATABASE_URL: validDatabaseUrl,
      GOOGLE_CLIENT_ID: google.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: google.GOOGLE_CLIENT_SECRET,
    });
    expect(env.GOOGLE_OAUTH?.redirectUri).toBe(
      'http://localhost:5173/api/v1/auth/google/callback',
    );
  });

  it('requires the Google client ID and secret together', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: validDatabaseUrl,
        GOOGLE_CLIENT_ID: google.GOOGLE_CLIENT_ID,
      }),
    ).toThrow(/must be set together/);
  });

  it('rejects an invalid redirect URI and durations', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: validDatabaseUrl,
        ...google,
        GOOGLE_REDIRECT_URI: 'not-a-url',
      }),
    ).toThrow(/GOOGLE_REDIRECT_URI/);
    expect(() =>
      loadEnv({ DATABASE_URL: validDatabaseUrl, ACCESS_TOKEN_TTL: '15' }),
    ).toThrow(/ACCESS_TOKEN_TTL/);
    expect(() =>
      loadEnv({
        DATABASE_URL: validDatabaseUrl,
        ACCESS_TOKEN_TTL: '2d',
        REFRESH_TOKEN_TTL: '1d',
      }),
    ).toThrow(/REFRESH_TOKEN_TTL/);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow(EnvValidationError);
  });

  it.each([
    ['non-postgres protocol', 'mysql://user:pass@db:3306/app'],
    ['not a URL', 'not-a-url'],
    ['empty string', ''],
  ])('rejects DATABASE_URL with %s', (_label, value) => {
    expect(() => loadEnv({ DATABASE_URL: value })).toThrow(/DATABASE_URL/);
  });

  it.each(['0', '70000', 'abc', '3000.5'])('rejects BACKEND_PORT=%s', (port) => {
    expect(() => loadEnv({ DATABASE_URL: validDatabaseUrl, BACKEND_PORT: port })).toThrow(
      /BACKEND_PORT/,
    );
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() =>
      loadEnv({ DATABASE_URL: validDatabaseUrl, NODE_ENV: 'staging' }),
    ).toThrow(/NODE_ENV/);
  });

  it('never echoes received values in the error message', () => {
    const secretUrl = 'mysql://user:super-secret-password@db:3306/app';

    try {
      loadEnv({ DATABASE_URL: secretUrl, GOOGLE_CLIENT_SECRET: 'top-secret-google' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as Error).message).not.toContain('super-secret-password');
      expect((error as Error).message).not.toContain('top-secret-google');
    }
  });
});

describe('.env.example', () => {
  it('is accepted as-is (copying it to .env must produce a bootable backend)', () => {
    const file = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env.example'),
      'utf8',
    );
    const values = Object.fromEntries(
      file
        .split(/\r?\n/)
        .filter((line) => /^[A-Z0-9_]+=/.test(line))
        .map((line) => [
          line.slice(0, line.indexOf('=')),
          line.slice(line.indexOf('=') + 1),
        ]),
    );

    const env = loadEnv(values);
    expect(env.GOOGLE_OAUTH).toBeNull();
    expect(env.ACCESS_TOKEN_TTL).toBe(15 * 60_000);
  });
});

describe('parseDurationMs', () => {
  it.each([
    ['90s', 90_000],
    ['15m', 900_000],
    ['12h', 43_200_000],
    ['30d', 2_592_000_000],
  ])('parses %s', (input, expected) => {
    expect(parseDurationMs(input)).toBe(expected);
  });

  it.each(['', '0m', '15', 'm', '1w', '-5m', '1.5h'])('rejects %j', (input) => {
    expect(parseDurationMs(input)).toBeNull();
  });
});
