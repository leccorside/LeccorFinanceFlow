import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppEnv } from '../../config/env.js';
import { CSRF_HEADER } from './guards.js';
import { requestIdMiddleware, securityHeadersMiddleware } from './middlewares.js';

export const API_PREFIX = 'api/v1';

/**
 * HTTP-level hardening shared by main.ts and the tests, so tests exercise the same
 * stack: prefix, proxy trust, body limits, CORS and security headers.
 * Guards and the exception filter are registered through SecurityModule (DI).
 */
export function configureApp(app: NestExpressApplication, env: AppEnv): void {
  app.setGlobalPrefix(API_PREFIX);
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  // JSON only; anything above the limit is answered with 413 by the exception filter.
  app.useBodyParser('json', { limit: env.MAX_JSON_BODY_SIZE });
  app.useBodyParser('urlencoded', { limit: env.MAX_JSON_BODY_SIZE, extended: false });
  // Recorded audio (POST /voice/transcriptions) arrives as the raw body, kept in memory only.
  app.useBodyParser('raw', {
    type: (request: { headers: Record<string, unknown> }) =>
      String(request.headers['content-type'] ?? '')
        .toLowerCase()
        .startsWith('audio/'),
    limit: env.VOICE.maxAudioBytes,
  });

  app.use(requestIdMiddleware);
  app.use(securityHeadersMiddleware({ hsts: env.COOKIE_SECURE }));

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      // No Origin = same-origin or non-browser client; cookies + CSRF guard still apply.
      callback(null, origin === undefined || env.ALLOWED_ORIGINS.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', CSRF_HEADER],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });

  app.enableShutdownHooks();
}
