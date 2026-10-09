import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '../../auth/auth.service.js';
import { headerValue, type HttpRequest, type HttpResponse } from '../../auth/http.js';
import { safeEqual } from '../../auth/tokens.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import type { RoleName } from '../../generated/prisma/enums.js';
import { ApiException } from '../errors/api-error.js';
import {
  IS_PUBLIC,
  RATE_LIMIT,
  type RateLimitPolicy,
  REQUIRED_ROLES,
} from './decorators.js';
import { RateLimiter } from './rate-limiter.js';

export type SecuredRequest = HttpRequest & { auth?: AuthenticatedUser };

export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isPublic(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}

/**
 * Global per-IP budget for every route, plus an optional route bucket from @RateLimit.
 * Runs first so floods are cut before any database work.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SecuredRequest>();
    const response = context.switchToHttp().getResponse<HttpResponse>();
    const client = request.ip ?? 'unknown';
    const windowMs = this.env.RATE_LIMIT_TTL_SECONDS * 1000;

    const buckets: { key: string; limit: number; windowMs: number }[] = [
      { key: `global:${client}`, limit: this.env.RATE_LIMIT_MAX_REQUESTS, windowMs },
    ];

    const policy = this.reflector.getAllAndOverride<RateLimitPolicy | undefined>(
      RATE_LIMIT,
      [context.getHandler(), context.getClass()],
    );
    if (policy && 'policy' in policy) {
      const limits = {
        auth: this.env.AUTH_RATE_LIMIT_MAX_REQUESTS,
        spreadsheets: this.env.SPREADSHEET_RATE_LIMIT_MAX_REQUESTS,
        assistant: this.env.ASSISTANT_RATE_LIMIT_MAX_REQUESTS,
        voice: this.env.VOICE_RATE_LIMIT_MAX_REQUESTS,
      } as const;
      buckets.push({
        key: `${policy.policy}:${client}`,
        limit: limits[policy.policy],
        windowMs,
      });
    } else if (policy) {
      buckets.push({
        key: `${policy.name}:${client}`,
        limit: policy.limit,
        windowMs: policy.windowMs,
      });
    }

    for (const bucket of buckets) {
      const result = this.limiter.hit(bucket.key, bucket.limit, bucket.windowMs);
      if (!result.allowed) {
        response.setHeader('Retry-After', result.retryAfterSeconds);
        throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', undefined, {
          retryAfterSeconds: result.retryAfterSeconds,
        });
      }
    }
    return true;
  }
}

/** Origin of the request from `Origin`, falling back to `Referer`. Undefined when absent. */
export function requestOrigin(request: HttpRequest): string | undefined {
  const origin = headerValue(request, 'origin');
  if (origin && origin !== 'null') {
    return origin;
  }
  if (origin === 'null') {
    return 'null'; // opaque origin (sandboxed iframe, file://): never allowed
  }
  const referer = headerValue(request, 'referer');
  if (!referer) {
    return undefined;
  }
  try {
    return new URL(referer).origin;
  } catch {
    return 'null';
  }
}

/**
 * CSRF for cookie-authenticated APIs:
 * 1. Any state-changing request coming from a browser origin must come from an allowed origin
 *    (applies to public routes too, e.g. logout).
 * 2. Authenticated state-changing requests must carry `X-CSRF-Token` equal to the session's
 *    token (synchronizer token, obtained from GET /auth/csrf).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SecuredRequest>();
    if (SAFE_METHODS.has((request.method ?? 'GET').toUpperCase())) {
      return true;
    }

    const origin = requestOrigin(request);
    if (origin !== undefined && !this.env.ALLOWED_ORIGINS.includes(origin)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'csrf_failed',
        'Origem da requisição não permitida.',
      );
    }

    if (isPublic(this.reflector, context)) {
      return true;
    }

    const presented = headerValue(request, CSRF_HEADER);
    const expected = request.auth?.csrfToken;
    if (!presented || !expected || !safeEqual(presented, expected)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'csrf_failed',
        'Token CSRF ausente ou inválido.',
      );
    }
    return true;
  }
}

/** Enforces @Roles. Routes without @Roles only need a session (or are @Public). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleName[] | undefined>(
      REQUIRED_ROLES,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const user = context.switchToHttp().getRequest<SecuredRequest>().auth;
    if (!user) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'unauthenticated');
    }
    if (!required.some((role) => user.roles.includes(role))) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'forbidden');
    }
    return true;
  }
}

export { isPublic };
