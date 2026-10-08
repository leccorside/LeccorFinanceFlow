import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { type AuthenticatedUser, AuthService } from './auth.service.js';
import { type HttpRequest, readCookie } from './http.js';

type AuthenticatedRequest = HttpRequest & { auth?: AuthenticatedUser };

/**
 * Requires a valid application session (access-token cookie) of an ACTIVE user.
 * Role/ownership policies are layered on top in PASSO 05.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.auth.authenticate(readCookie(request, 'session'));

    if (!user) {
      throw new UnauthorizedException({
        code: 'unauthenticated',
        message: 'Sessão inválida ou expirada.',
      });
    }

    request.auth = user;
    return true;
  }
}

/** The user resolved by SessionAuthGuard. Only valid on guarded routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new UnauthorizedException({
        code: 'unauthenticated',
        message: 'Sessão inválida ou expirada.',
      });
    }
    return request.auth;
  },
);
