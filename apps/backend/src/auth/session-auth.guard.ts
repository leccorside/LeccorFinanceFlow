import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../common/errors/api-error.js';
import { isPublic, type SecuredRequest } from '../common/security/guards.js';
import { AuthService, type AuthenticatedUser } from './auth.service.js';
import { readCookie } from './http.js';

/**
 * Global default-deny: every route requires a valid application session of an ACTIVE
 * user, unless marked @Public(). Registered as APP_GUARD by SecurityModule.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublic(this.reflector, context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<SecuredRequest>();
    const user = await this.auth.authenticate(readCookie(request, 'session'));
    if (!user) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'unauthenticated');
    }

    request.auth = user;
    return true;
  }
}

/** The user resolved by SessionAuthGuard. Only valid on non-public routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<SecuredRequest>();
    if (!request.auth) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'unauthenticated');
    }
    return request.auth;
  },
);
