import { Logger } from '@nestjs/common';
import { afterEach, vi } from 'vitest';
import { ApiException } from './api-error.js';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { redact, redactPath } from './redact.js';

describe('redact', () => {
  it('masks credentials, tokens, keys, cookies and e-mails', () => {
    const text = [
      'connect postgresql://leccor:super-secret@db:5432/app failed',
      'Authorization: Bearer abc.def-ghi',
      'cookie lff_session=Zx9_secretvalue; lff_refresh=other',
      'id token eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
      'keys sk-proj-AbCdEf123456 AIzaSyA1234567890abcdefghijk ya29.a0AfB_token',
      'user ana.souza@example.com',
      'hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      'auth failed password=hunter2; retry',
      'body {"refresh_token": "1//0gAbc", "client_secret":"GOCSPX-x1"} api_key: k-42',
    ].join('\n');
    const out = redact(text);
    expect(out).toContain('password=[redacted]');
    for (const secret of [
      'hunter2',
      '1//0gAbc',
      'GOCSPX-x1',
      'k-42',
      'super-secret',
      'abc.def-ghi',
      'Zx9_secretvalue',
      'eyJhbGciOiJSUzI1NiJ9',
      'sk-proj-AbCdEf123456',
      'AIzaSyA1234567890abcdefghijk',
      'ya29.a0AfB_token',
      'ana.souza@example.com',
      '9f86d081884c7d659a2feaa0c55ad015',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('postgresql://leccor:[redacted]@db:5432/app');
    expect(out).toContain('[email]');
  });

  it('keeps ordinary text and drops query strings from paths', () => {
    expect(redact('Prisma P2034: transaction conflict on table users')).toBe(
      'Prisma P2034: transaction conflict on table users',
    );
    expect(redactPath('/api/v1/transactions?q=ana@example.com&limit=5')).toBe(
      '/api/v1/transactions',
    );
    expect(redact('erro '.repeat(400))).toHaveLength(500);
    expect(
      redactPath('/api/v1/spreadsheets/3f2b8c1e-9a4d-4e2f-8b1c-7d6e5f4a3b2c/sync'),
    ).toBe('/api/v1/spreadsheets/3f2b8c1e-9a4d-4e2f-8b1c-7d6e5f4a3b2c/sync');
  });
});

describe('ApiExceptionFilter logging', () => {
  afterEach(() => vi.restoreAllMocks());

  function run(exception: unknown) {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const sent: { status?: number; body?: unknown } = {};
    const response = {
      status(code: number) {
        sent.status = code;
        return this;
      },
      setHeader: () => undefined,
      json(body: unknown) {
        sent.body = body;
      },
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/api/v1/assistant/messages?email=ana@example.com',
          requestId: 'req-1',
        }),
        getResponse: () => response,
      }),
    };
    new ApiExceptionFilter().catch(exception, host as never);
    return { sent, error, warn };
  }

  it('logs deliberate 503s as a warning with the code only', () => {
    const { sent, error, warn } = run(
      new ApiException(503, 'provider_unavailable', 'Google fora (token ya29.abc)'),
    );
    expect(sent.status).toBe(503);
    expect(error).not.toHaveBeenCalled();
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toBe(
      '[req-1] POST /api/v1/assistant/messages -> 503 provider_unavailable',
    );
  });

  it('answers 500 generically and logs a redacted line for operations', () => {
    const { sent, error } = run(
      new Error('provider said: invalid key sk-live-ABCDEFGHIJKL for ana@example.com'),
    );
    expect(sent.status).toBe(500);
    expect(JSON.stringify(sent.body)).not.toContain('sk-live');
    expect(sent.body).toMatchObject({ code: 'internal_error', requestId: 'req-1' });
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toContain('[req-1] POST /api/v1/assistant/messages -> 500 Error:');
    expect(line).not.toContain('sk-live-ABCDEFGHIJKL');
    expect(line).not.toContain('ana@example.com');
  });

  it('does not log expected client errors', () => {
    const { sent, error } = run(
      Object.assign(new Error('too big'), { status: 413, type: 'entity.too.large' }),
    );
    expect(sent.status).toBe(413);
    expect(error).not.toHaveBeenCalled();
  });
});
