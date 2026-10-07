import { EnvValidationError, loadEnv } from './env.js';

const validDatabaseUrl =
  'postgresql://leccor:secret-value@postgres:5432/leccor_finance_flow';

describe('loadEnv', () => {
  it('applies defaults and coerces types', () => {
    const env = loadEnv({ DATABASE_URL: validDatabaseUrl });

    expect(env).toEqual({
      NODE_ENV: 'development',
      BACKEND_PORT: 3000,
      DATABASE_URL: validDatabaseUrl,
    });
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('parses explicit values', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      BACKEND_PORT: '8080',
      DATABASE_URL: validDatabaseUrl,
    });

    expect(env.NODE_ENV).toBe('production');
    expect(env.BACKEND_PORT).toBe(8080);
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
      loadEnv({ DATABASE_URL: secretUrl });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as Error).message).not.toContain('super-secret-password');
    }
  });
});
