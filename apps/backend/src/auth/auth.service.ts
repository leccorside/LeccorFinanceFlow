import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type RoleName, type UserStatus } from '../generated/prisma/client.js';
import { UsersService } from '../users/users.service.js';
import { AuthError } from './auth.errors.js';
import {
  GOOGLE_IDENTITY_PROVIDER,
  type GoogleIdentityProvider,
} from './google-identity.provider.js';
import { sanitizeRedirectPath } from './http.js';
import { generateToken, hashToken, pkceChallenge, safeEqual } from './tokens.js';

export const LOGIN_ATTEMPT_TTL_MS = 10 * 60_000;
/** Avoids a write on every request just to bump `last_used_at`. */
const LAST_USED_RESOLUTION_MS = 60_000;

export interface LoginStart {
  authorizationUrl: URL;
  /** Raw state, bound to the browser via the oauth-state cookie. */
  state: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export interface LoginResult {
  tokens: SessionTokens;
  redirectPath: string;
}

export interface CallbackInput {
  /** Callback URL exactly as received, including its query string. */
  callbackUrl: URL;
  /** State value from the oauth-state cookie. */
  cookieState: string | undefined;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  status: UserStatus;
  roles: RoleName[];
  sessionId: string;
  /** Internal: compared by CsrfGuard, returned only by GET /auth/csrf. Never serialize. */
  csrfToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(GOOGLE_IDENTITY_PROVIDER)
    private readonly google: GoogleIdentityProvider | null,
  ) {}

  get isGoogleConfigured(): boolean {
    return this.google !== null;
  }

  async startLogin(redirectTo: string | undefined): Promise<LoginStart> {
    const google = this.requireGoogle();
    const state = generateToken();
    const nonce = generateToken();
    const codeVerifier = generateToken();

    // Housekeeping without jobs: drop abandoned attempts whenever a new one starts.
    await this.prisma.authLoginAttempt.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await this.prisma.authLoginAttempt.create({
      data: {
        purpose: 'LOGIN',
        stateHash: hashToken(state),
        nonce,
        codeVerifier,
        redirectPath: sanitizeRedirectPath(redirectTo),
        expiresAt: new Date(Date.now() + LOGIN_ATTEMPT_TTL_MS),
      },
    });

    return {
      state,
      authorizationUrl: google.buildAuthorizationUrl({
        state,
        nonce,
        codeChallenge: pkceChallenge(codeVerifier),
      }),
    };
  }

  async completeLogin({ callbackUrl, cookieState }: CallbackInput): Promise<LoginResult> {
    const google = this.requireGoogle();
    const params = callbackUrl.searchParams;

    if (params.get('error')) {
      throw new AuthError(
        params.get('error') === 'access_denied' ? 'access_denied' : 'provider_error',
      );
    }

    const state = params.get('state');
    if (!state || !cookieState || !safeEqual(state, cookieState)) {
      throw new AuthError('invalid_state');
    }

    // Single use: deleting is the atomic "consume"; a replay finds nothing.
    const attempt = await this.consumeAttempt(hashToken(state));
    if (attempt.expiresAt.getTime() <= Date.now()) {
      throw new AuthError('expired_state');
    }

    let identity;
    try {
      identity = await google.exchangeCode({
        callbackUrl,
        state,
        nonce: attempt.nonce,
        codeVerifier: attempt.codeVerifier,
      });
    } catch {
      throw new AuthError('provider_error');
    }

    if (!identity.emailVerified) {
      throw new AuthError('email_not_verified');
    }

    const user = await this.users.resolveGoogleUser(identity);
    if (user.status !== 'ACTIVE') {
      throw new AuthError('account_blocked');
    }

    const tokens = await this.createSession(user.id);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return { tokens, redirectPath: attempt.redirectPath };
  }

  /** Resolves the access token to an active session of an ACTIVE user, or null. */
  async authenticate(accessToken: string | undefined): Promise<AuthenticatedUser | null> {
    if (!accessToken) {
      return null;
    }

    const session = await this.prisma.userSession.findUnique({
      where: { accessTokenHash: hashToken(accessToken) },
      include: { user: { include: { roles: { include: { role: true } } } } },
    });
    const now = Date.now();

    if (
      !session ||
      session.revokedAt !== null ||
      session.accessExpiresAt.getTime() <= now
    ) {
      return null;
    }

    if (session.user.status !== 'ACTIVE') {
      await this.revoke(session.id, 'user_blocked');
      return null;
    }

    if (now - session.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date(now) },
      });
    }

    return {
      id: session.user.id,
      email: session.user.email,
      status: session.user.status,
      roles: session.user.roles.map(({ role }) => role.name),
      sessionId: session.id,
      csrfToken: session.csrfToken,
    };
  }

  /**
   * Rotates both tokens. Presenting an already rotated refresh token is treated as
   * theft: the whole session is revoked.
   */
  async refresh(refreshToken: string | undefined): Promise<SessionTokens> {
    if (!refreshToken) {
      throw new AuthError('invalid_session');
    }
    const presentedHash = hashToken(refreshToken);

    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: presentedHash },
      include: { user: { select: { status: true } } },
    });

    if (!session) {
      const replayed = await this.prisma.userSession.findUnique({
        where: { previousRefreshTokenHash: presentedHash },
      });
      if (replayed && replayed.revokedAt === null) {
        await this.revoke(replayed.id, 'refresh_reuse');
      }
      throw new AuthError('invalid_session');
    }

    if (session.revokedAt !== null || session.refreshExpiresAt.getTime() <= Date.now()) {
      throw new AuthError('invalid_session');
    }
    if (session.user.status !== 'ACTIVE') {
      await this.revoke(session.id, 'user_blocked');
      throw new AuthError('account_blocked');
    }

    const tokens = this.newTokens();
    // Conditional update: two concurrent refreshes with the same token cannot both win.
    const rotated = await this.prisma.userSession.updateMany({
      where: { id: session.id, refreshTokenHash: presentedHash, revokedAt: null },
      data: {
        accessTokenHash: hashToken(tokens.accessToken),
        accessExpiresAt: tokens.accessExpiresAt,
        refreshTokenHash: hashToken(tokens.refreshToken),
        refreshExpiresAt: tokens.refreshExpiresAt,
        previousRefreshTokenHash: presentedHash,
        lastUsedAt: new Date(),
      },
    });
    if (rotated.count !== 1) {
      await this.revoke(session.id, 'refresh_reuse');
      throw new AuthError('invalid_session');
    }

    return tokens;
  }

  /** Idempotent: revokes the session identified by either cookie, if any. */
  async logout(
    accessToken: string | undefined,
    refreshToken: string | undefined,
  ): Promise<void> {
    const candidates: Prisma.UserSessionWhereInput[] = [];
    if (accessToken) {
      candidates.push({ accessTokenHash: hashToken(accessToken) });
    }
    if (refreshToken) {
      candidates.push({ refreshTokenHash: hashToken(refreshToken) });
    }
    if (candidates.length === 0) {
      return;
    }

    await this.prisma.userSession.updateMany({
      where: { OR: candidates, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
  }

  /** Revokes every session of a user (e.g. when blocking the account). */
  async revokeAllSessions(userId: string, reason: string): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason.slice(0, 50) },
    });
    return result.count;
  }

  private async createSession(userId: string): Promise<SessionTokens> {
    const tokens = this.newTokens();
    await this.prisma.userSession.create({
      data: {
        userId,
        accessTokenHash: hashToken(tokens.accessToken),
        accessExpiresAt: tokens.accessExpiresAt,
        refreshTokenHash: hashToken(tokens.refreshToken),
        refreshExpiresAt: tokens.refreshExpiresAt,
        // Stable for the session's lifetime (survives refresh) so every tab shares it.
        csrfToken: generateToken(),
      },
    });
    return tokens;
  }

  private newTokens(): SessionTokens {
    const now = Date.now();
    return {
      accessToken: generateToken(),
      refreshToken: generateToken(),
      accessExpiresAt: new Date(now + this.env.ACCESS_TOKEN_TTL),
      refreshExpiresAt: new Date(now + this.env.REFRESH_TOKEN_TTL),
    };
  }

  private async consumeAttempt(stateHash: string) {
    try {
      // A GOOGLE_CONNECTION state can never complete a login (and vice versa).
      return await this.prisma.authLoginAttempt.delete({
        where: { stateHash, purpose: 'LOGIN' },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new AuthError('invalid_state');
      }
      throw error;
    }
  }

  private async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  private requireGoogle(): GoogleIdentityProvider {
    if (!this.google) {
      throw new AuthError('oauth_not_configured');
    }
    return this.google;
  }
}
