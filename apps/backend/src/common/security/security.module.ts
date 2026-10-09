import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../../auth/auth.module.js';
import { SessionAuthGuard } from '../../auth/session-auth.guard.js';
import { ApiExceptionFilter } from '../errors/api-exception.filter.js';
import { CsrfGuard, RateLimitGuard, RolesGuard, RouteRateLimitGuard } from './guards.js';
import { RateLimiter } from './rate-limiter.js';

/**
 * Global request pipeline, in this order (APP_GUARD order = registration order):
 * global rate limit (IP) → authentication (default-deny) → route rate limit (user or IP)
 * → CSRF → roles. Then the handler, whose
 * DTO/param pipes validate input and whose queries are scoped to the current user.
 */
@Module({
  imports: [AuthModule],
  providers: [
    { provide: RateLimiter, useFactory: () => new RateLimiter() },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useExisting: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RouteRateLimitGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class SecurityModule {}
