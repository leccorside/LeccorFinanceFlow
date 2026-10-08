import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Public, RateLimit } from '../common/security/decorators.js';
import { APP_ENV, type AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuthError } from './auth.errors.js';
import {
  type AuthenticatedUser,
  AuthService,
  LOGIN_ATTEMPT_TTL_MS,
  type SessionTokens,
} from './auth.service.js';
import {
  cookieOptions,
  COOKIE,
  type CookieKind,
  type HttpRequest,
  type HttpResponse,
  queryString,
  readCookie,
} from './http.js';
import { CurrentUser } from './session-auth.guard.js';

export interface MeResponse {
  id: string;
  email: string;
  status: string;
  roles: string[];
  profile: {
    firstName: string | null;
    lastName: string | null;
    photoUrl: string | null;
    locale: string;
    currency: string;
    timeZone: string;
  } | null;
}

export interface CsrfResponse {
  csrfToken: string;
  /** Header the token must be sent in, on every POST/PUT/PATCH/DELETE. */
  headerName: string;
}

/** Brute-force/abuse budget for every auth route (AUTH_RATE_LIMIT_MAX_REQUESTS per IP). */
@RateLimit({ policy: 'auth' })
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  /** Starts the Google login: 302 to Google with state, nonce and PKCE (S256). */
  @Public()
  @Get('google/login')
  async googleLogin(
    @Req() request: HttpRequest,
    @Res() response: HttpResponse,
  ): Promise<void> {
    if (!this.auth.isGoogleConfigured) {
      throw new ServiceUnavailableException({
        code: 'oauth_not_configured',
        message: 'Login com Google não está configurado neste ambiente.',
      });
    }

    const { authorizationUrl, state } = await this.auth.startLogin(
      queryString(request, 'redirectTo'),
    );
    response.cookie(
      COOKIE.oauthState.name,
      state,
      this.options('oauthState', LOGIN_ATTEMPT_TTL_MS),
    );
    response.redirect(302, authorizationUrl.toString());
  }

  /**
   * Google redirects the browser here. Always answers with a redirect to the
   * frontend: on success with session cookies, on failure with `/login?error=<code>`.
   */
  @Public()
  @Get('google/callback')
  async googleCallback(
    @Req() request: HttpRequest,
    @Res() response: HttpResponse,
  ): Promise<void> {
    const cookieState = readCookie(request, 'oauthState');
    this.clear(response, 'oauthState');

    try {
      const callbackUrl = new URL(this.env.GOOGLE_OAUTH?.redirectUri ?? 'http://invalid');
      for (const key of [
        'code',
        'state',
        'error',
        'iss',
        'scope',
        'authuser',
        'prompt',
        'hd',
      ]) {
        const value = queryString(request, key);
        if (value !== undefined) {
          callbackUrl.searchParams.set(key, value);
        }
      }

      const { tokens, redirectPath } = await this.auth.completeLogin({
        callbackUrl,
        cookieState,
      });
      this.setSession(response, tokens);
      response.redirect(302, this.frontendUrl(redirectPath));
    } catch (error) {
      const code = error instanceof AuthError ? error.code : 'provider_error';
      response.redirect(
        302,
        this.frontendUrl(`/login?error=${encodeURIComponent(code)}`),
      );
    }
  }

  /**
   * Rotates the session tokens using the refresh cookie. Public (the access token may be
   * expired); protected by the SameSite=Strict refresh cookie and the origin check.
   */
  @Public()
  @Post('refresh')
  @HttpCode(204)
  async refresh(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<void> {
    try {
      this.setSession(response, await this.auth.refresh(readCookie(request, 'refresh')));
    } catch (error) {
      this.clear(response, 'session');
      this.clear(response, 'refresh');
      const code = error instanceof AuthError ? error.code : 'invalid_session';
      throw new UnauthorizedException({ code, message: 'Sessão inválida ou expirada.' });
    }
  }

  /** Revokes the current session (if any) and clears cookies. Idempotent. */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<void> {
    await this.auth.logout(
      readCookie(request, 'session'),
      readCookie(request, 'refresh'),
    );
    this.clear(response, 'session');
    this.clear(response, 'refresh');
  }

  /**
   * CSRF token of the current session. The SPA keeps it in memory and sends it in
   * `X-CSRF-Token` on state-changing requests. Stable for the session (all tabs).
   */
  @Get('csrf')
  csrf(@CurrentUser() user: AuthenticatedUser): CsrfResponse {
    return { csrfToken: user.csrfToken, headerName: 'X-CSRF-Token' };
  }

  /** Current user. Never includes tokens or Google credentials. */
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId: user.id },
    });
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      roles: user.roles,
      profile: profile && {
        firstName: profile.firstName,
        lastName: profile.lastName,
        photoUrl: profile.photoUrl,
        locale: profile.locale,
        currency: profile.currency,
        timeZone: profile.timeZone,
      },
    };
  }

  private setSession(response: HttpResponse, tokens: SessionTokens): void {
    response.cookie(
      COOKIE.session.name,
      tokens.accessToken,
      this.options('session', this.env.ACCESS_TOKEN_TTL),
    );
    response.cookie(
      COOKIE.refresh.name,
      tokens.refreshToken,
      this.options('refresh', this.env.REFRESH_TOKEN_TTL),
    );
  }

  private clear(response: HttpResponse, kind: CookieKind): void {
    // Same path/flags as when set (no maxAge), otherwise the browser keeps the cookie.
    response.clearCookie(COOKIE[kind].name, this.options(kind));
  }

  private options(kind: CookieKind, maxAgeMs?: number) {
    return cookieOptions(kind, this.env.COOKIE_SECURE, maxAgeMs);
  }

  private frontendUrl(path: string): string {
    return new URL(path, this.env.FRONTEND_URL).toString();
  }
}
