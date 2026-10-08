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
  UseGuards,
} from '@nestjs/common';
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
import { CurrentUser, SessionAuthGuard } from './session-auth.guard.js';

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

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  /** Starts the Google login: 302 to Google with state, nonce and PKCE (S256). */
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

  /** Rotates the session tokens using the refresh cookie. */
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

  /** Current user. Never includes tokens or Google credentials. */
  @Get('me')
  @UseGuards(SessionAuthGuard)
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
