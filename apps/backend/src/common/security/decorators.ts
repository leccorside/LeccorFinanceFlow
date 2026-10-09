import { SetMetadata } from '@nestjs/common';
import type { RoleName } from '../../generated/prisma/enums.js';

export const IS_PUBLIC = 'security:isPublic';
export const REQUIRED_ROLES = 'security:roles';
export const RATE_LIMIT = 'security:rateLimit';

/**
 * Opt-out of the global default-deny authentication. Use only for routes that must work
 * without a session (health, login/callback, refresh, logout).
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Requires at least one of the roles. Admin features live under explicit /admin routes. */
export const Roles = (...roles: [RoleName, ...RoleName[]]) =>
  SetMetadata(REQUIRED_ROLES, roles);

/** Named policy (limit from env) or an explicit limit. Applied per client IP. */
export type RateLimitPolicy =
  | { policy: 'auth' | 'spreadsheets' | 'assistant' }
  | { name: string; limit: number; windowMs: number };

/** Adds a route-specific bucket on top of the global per-IP limit. */
export const RateLimit = (policy: RateLimitPolicy) => SetMetadata(RATE_LIMIT, policy);
