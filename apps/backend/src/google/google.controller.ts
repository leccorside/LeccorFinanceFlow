import { Controller, Delete, Get, Inject, Req, Res } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AuthService } from '../auth/auth.service.js';
import {
  COOKIE,
  cookieOptions,
  type HttpRequest,
  type HttpResponse,
  queryString,
  readCookie,
} from '../auth/http.js';
import { CurrentUser } from '../auth/session-auth.guard.js';
import { Public, RateLimit } from '../common/security/decorators.js';
import { APP_ENV, type AppEnv } from '../config/env.js';
import {
  CONNECT_ATTEMPT_TTL_MS,
  type ConnectionStatusResponse,
  type DisconnectResponse,
  GoogleConnectionError,
  GoogleConnectionService,
} from './google-connection.service.js';

/**
 * Drive/Sheets connection, separate from login. Tokens never leave the backend: the API only
 * exposes the connection status.
 */
@Controller('google')
export class GoogleController {
  constructor(
    @Inject(GoogleConnectionService)
    private readonly connections: GoogleConnectionService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  @Get('connection')
  status(@CurrentUser() user: AuthenticatedUser): Promise<ConnectionStatusResponse> {
    return this.connections.status(user);
  }

  /** Revokes at Google (best effort) and deletes local tokens. Spreadsheets are kept. */
  @Delete('connection')
  disconnect(@CurrentUser() user: AuthenticatedUser): Promise<DisconnectResponse> {
    return this.connections.disconnect(user);
  }

  /**
   * Browser navigation (link), so failures redirect back to the frontend instead of
   * answering JSON. Public only to be able to redirect anonymous visitors to /login;
   * the session is checked explicitly.
   */
  @Public()
  @RateLimit({ policy: 'auth' })
  @Get('connect')
  async connect(
    @Req() request: HttpRequest,
    @Res() response: HttpResponse,
  ): Promise<void> {
    const user = await this.auth.authenticate(readCookie(request, 'session'));
    if (!user) {
      response.redirect(302, this.frontendUrl('/login', { redirectTo: '/profile' }));
      return;
    }
    if (!this.connections.isAvailable) {
      response.redirect(
        302,
        this.frontendUrl('/profile', { googleError: 'google_connection_unavailable' }),
      );
      return;
    }

    const { consentUrl, state } = await this.connections.startConnect(
      user,
      queryString(request, 'redirectTo'),
    );
    response.cookie(
      COOKIE.googleState.name,
      state,
      cookieOptions('googleState', this.env.COOKIE_SECURE, CONNECT_ATTEMPT_TTL_MS),
    );
    response.redirect(302, consentUrl.toString());
  }

  /** Google redirects the browser here after the consent screen. */
  @Public()
  @RateLimit({ policy: 'auth' })
  @Get('callback')
  async callback(
    @Req() request: HttpRequest,
    @Res() response: HttpResponse,
  ): Promise<void> {
    const cookieState = readCookie(request, 'googleState');
    response.clearCookie(
      COOKIE.googleState.name,
      cookieOptions('googleState', this.env.COOKIE_SECURE),
    );

    try {
      if (!this.env.GOOGLE_OAUTH) {
        throw new GoogleConnectionError('google_connection_unavailable');
      }
      const callbackUrl = new URL(this.env.GOOGLE_OAUTH.connectionRedirectUri);
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
        if (value !== undefined) callbackUrl.searchParams.set(key, value);
      }

      const sessionUser = await this.auth.authenticate(readCookie(request, 'session'));
      const { redirectPath } = await this.connections.completeConnect({
        callbackUrl,
        cookieState,
        sessionUser,
      });
      response.redirect(302, this.frontendUrl(redirectPath, { google: 'connected' }));
    } catch (error) {
      const code = error instanceof GoogleConnectionError ? error.code : 'provider_error';
      const target = code === 'unauthenticated' ? '/login' : '/profile';
      response.redirect(302, this.frontendUrl(target, { googleError: code }));
    }
  }

  private frontendUrl(path: string, params: Record<string, string>): string {
    const url = new URL(path, this.env.FRONTEND_URL);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }
}
