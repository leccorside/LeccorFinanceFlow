import {
  type ArgumentsHost,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { ApiException } from '../errors/api-error.js';
import { ApiExceptionFilter } from '../errors/api-exception.filter.js';
import { dto, validate } from '../validation/zod-validation.pipe.js';
import { requestOrigin } from './guards.js';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  it('allows up to the limit per key and window, then reports Retry-After', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter(() => now);

    expect(limiter.hit('a', 2, 60_000)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.hit('a', 2, 60_000)).toMatchObject({ allowed: true, remaining: 0 });
    now += 15_000;
    expect(limiter.hit('a', 2, 60_000)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 45,
    });
    expect(limiter.hit('b', 2, 60_000).allowed).toBe(true);

    now += 45_000;
    expect(limiter.hit('a', 2, 60_000)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('sweeps expired windows to keep memory bounded', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now, 1_000);
    for (let index = 0; index < 50; index += 1) {
      limiter.hit(`client-${index}`, 10, 500);
    }
    expect(limiter.size).toBe(50);

    now = 2_000;
    limiter.hit('fresh', 10, 500);
    expect(limiter.size).toBe(1);
  });
});

describe('requestOrigin', () => {
  const request = (headers: Record<string, string>) => ({ headers, query: {} });

  it('prefers Origin, falls back to Referer, and treats opaque/invalid as "null"', () => {
    expect(requestOrigin(request({ origin: 'https://a.example' }))).toBe(
      'https://a.example',
    );
    expect(requestOrigin(request({ referer: 'https://b.example/x?y=1' }))).toBe(
      'https://b.example',
    );
    expect(requestOrigin(request({ origin: 'null' }))).toBe('null');
    expect(requestOrigin(request({ referer: 'not a url' }))).toBe('null');
    expect(requestOrigin(request({}))).toBeUndefined();
  });
});

describe('ApiExceptionFilter', () => {
  function run(exception: unknown) {
    const sent: {
      status?: number;
      body?: Record<string, unknown>;
      headers: Record<string, string>;
    } = {
      headers: {},
    };
    const response = {
      status(code: number) {
        sent.status = code;
        return response;
      },
      setHeader(name: string, value: string) {
        sent.headers[name] = value;
      },
      json(body: Record<string, unknown>) {
        sent.body = body;
      },
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, query: {}, requestId: 'req-1' }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    new ApiExceptionFilter().catch(exception, host);
    return sent;
  }

  it('keeps contract exceptions as they are', () => {
    const sent = run(
      new ApiException(409, 'conflict_custom', 'Mensagem', { field: 'x' }),
    );
    expect(sent).toMatchObject({
      status: 409,
      body: {
        code: 'conflict_custom',
        message: 'Mensagem',
        details: { field: 'x' },
        requestId: 'req-1',
      },
      headers: { 'X-Request-Id': 'req-1' },
    });
  });

  it('maps Nest default exceptions to a code by status', () => {
    expect(run(new NotFoundException('Cannot GET /x')).body).toMatchObject({
      code: 'not_found',
    });
    expect(run(new BadRequestException()).body).toMatchObject({ code: 'bad_request' });
  });

  it('maps expected Prisma errors and hides everything else', () => {
    const known = (code: string) =>
      new Prisma.PrismaClientKnownRequestError('internal driver text', {
        code,
        clientVersion: '7',
      });

    expect(run(known('P2025'))).toMatchObject({
      status: 404,
      body: { code: 'not_found' },
    });
    expect(run(known('P2002'))).toMatchObject({
      status: 409,
      body: { code: 'conflict' },
    });
    const unknownPrisma = run(known('P1001'));
    expect(unknownPrisma).toMatchObject({
      status: 500,
      body: { code: 'internal_error' },
    });
    expect(JSON.stringify(unknownPrisma.body)).not.toContain('internal driver text');
  });

  it('never exposes raw errors or plain 5xx messages', () => {
    const raw = run(new Error('password=hunter2'));
    expect(raw).toMatchObject({
      status: 500,
      body: { code: 'internal_error', details: null },
    });
    expect(JSON.stringify(raw.body)).not.toContain('hunter2');

    const plain503 = run(
      new ApiException(503, 'oauth_not_configured', 'Login indisponível.'),
    );
    expect(plain503.body).toMatchObject({
      code: 'oauth_not_configured',
      message: 'Login indisponível.',
    });
  });

  it('maps body-parser errors (status + type) to their 4xx', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      type: 'entity.too.large',
    });
    expect(run(tooLarge)).toMatchObject({
      status: 413,
      body: { code: 'payload_too_large' },
    });
  });
});

describe('validation pipe', () => {
  const schema = dto({ name: z.string().min(1) });

  it('parses valid input', () => {
    expect(validate(schema).transform({ name: 'ok' })).toEqual({ name: 'ok' });
  });

  it('rejects unknown keys and reports path/code/message only', () => {
    try {
      validate(schema).transform({ name: 'ok', ownerId: 'secret-owner' });
      expect.unreachable();
    } catch (error) {
      const response = (error as ApiException).getResponse() as {
        code: string;
        details: { issues: { path: string; code: string; message: string }[] };
      };
      expect(response.code).toBe('validation_failed');
      expect(response.details.issues[0]).toMatchObject({ code: 'unrecognized_keys' });
      expect(JSON.stringify(response)).not.toContain('secret-owner');
    }
  });
});
