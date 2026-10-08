import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { sanitizeRedirectPath } from '../auth/http.js';
import { generateToken, hashToken, pkceChallenge, safeEqual } from '../auth/tokens.js';
import {
  CREDENTIAL_VAULT,
  CredentialDecryptionError,
  type CredentialVault,
} from '../common/crypto/credential-vault.js';
import { ApiException } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  type GoogleConnection,
  Prisma,
  type PrismaClient,
} from '../generated/prisma/client.js';
import {
  GOOGLE_API_SCOPES,
  GOOGLE_OAUTH_CLIENT,
  GoogleGrantRevokedError,
  type GoogleOAuthClient,
} from './google-oauth.client.js';

export const CONNECT_ATTEMPT_TTL_MS = 10 * 60_000;
/** Refresh a little before Google's expiry to avoid using a token that dies in flight. */
const EXPIRY_MARGIN_MS = 60_000;

export type ConnectionStatus = 'NOT_CONNECTED' | 'ACTIVE' | 'NEEDS_REAUTH' | 'REVOKED';

/** What the frontend may see. Never contains tokens. */
export interface ConnectionStatusResponse {
  status: ConnectionStatus;
  googleEmail: string | null;
  grantedScopes: string[];
  requiredScopes: string[];
  missingScopes: string[];
  connectedAt: string | null;
  lastRefreshedAt: string | null;
}

export interface DisconnectResponse {
  status: ConnectionStatus;
  /** Whether Google confirmed the revocation (local tokens are deleted regardless). */
  remoteRevocation: 'revoked' | 'failed' | 'skipped';
}

export type ConnectionErrorCode =
  | 'google_connection_unavailable'
  | 'unauthenticated'
  | 'access_denied'
  | 'invalid_state'
  | 'expired_state'
  | 'provider_error'
  | 'insufficient_scopes'
  | 'missing_refresh_token';

export class GoogleConnectionError extends Error {
  constructor(readonly code: ConnectionErrorCode) {
    super(code);
    this.name = 'GoogleConnectionError';
  }
}

/** AAD for the vault: binds each ciphertext to its user and column. */
export function tokenContext(
  userId: string,
  field: 'access_token' | 'refresh_token',
): string {
  return `google_connections:${userId}:${field}`;
}

@Injectable()
export class GoogleConnectionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GOOGLE_OAUTH_CLIENT) private readonly google: GoogleOAuthClient | null,
    @Inject(CREDENTIAL_VAULT) private readonly vault: CredentialVault | null,
  ) {}

  get isAvailable(): boolean {
    return this.google !== null && this.vault !== null;
  }

  async status(user: Pick<AuthenticatedUser, 'id'>): Promise<ConnectionStatusResponse> {
    const connection = await this.prisma.googleConnection.findUnique({
      where: { userId: user.id },
    });
    const granted = connection?.status === 'ACTIVE' ? connection.grantedScopes : [];
    return {
      status: connection?.status ?? 'NOT_CONNECTED',
      googleEmail: connection?.googleEmail ?? null,
      grantedScopes: granted,
      requiredScopes: [...GOOGLE_API_SCOPES],
      missingScopes: GOOGLE_API_SCOPES.filter((scope) => !granted.includes(scope)),
      connectedAt: connection?.createdAt.toISOString() ?? null,
      lastRefreshedAt: connection?.lastRefreshedAt?.toISOString() ?? null,
    };
  }

  /** Starts the incremental Drive consent for the signed-in user. */
  async startConnect(
    user: Pick<AuthenticatedUser, 'id' | 'email'>,
    redirectTo: string | undefined,
  ): Promise<{ consentUrl: URL; state: string }> {
    const google = this.requireGoogle();
    this.requireVault();
    const state = generateToken();
    const nonce = generateToken();
    const codeVerifier = generateToken();

    await this.prisma.authLoginAttempt.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await this.prisma.authLoginAttempt.create({
      data: {
        purpose: 'GOOGLE_CONNECTION',
        userId: user.id,
        stateHash: hashToken(state),
        nonce,
        codeVerifier,
        redirectPath: sanitizeRedirectPath(redirectTo ?? '/profile'),
        expiresAt: new Date(Date.now() + CONNECT_ATTEMPT_TTL_MS),
      },
    });

    return {
      state,
      consentUrl: google.buildConsentUrl({
        state,
        nonce,
        codeChallenge: pkceChallenge(codeVerifier),
        loginHint: user.email,
      }),
    };
  }

  /**
   * Completes the consent. The callback must come from the same browser (state cookie) and
   * the same signed-in user that started it; tokens are stored only as vault ciphertext.
   */
  async completeConnect(input: {
    callbackUrl: URL;
    cookieState: string | undefined;
    sessionUser: Pick<AuthenticatedUser, 'id'> | null;
  }): Promise<{ redirectPath: string }> {
    const google = this.requireGoogle();
    const vault = this.requireVault();
    const params = input.callbackUrl.searchParams;

    if (params.get('error')) {
      throw new GoogleConnectionError(
        params.get('error') === 'access_denied' ? 'access_denied' : 'provider_error',
      );
    }
    if (!input.sessionUser) {
      throw new GoogleConnectionError('unauthenticated');
    }

    const state = params.get('state');
    if (!state || !input.cookieState || !safeEqual(state, input.cookieState)) {
      throw new GoogleConnectionError('invalid_state');
    }

    const attempt = await this.consumeAttempt(hashToken(state), input.sessionUser.id);
    if (attempt.expiresAt.getTime() <= Date.now()) {
      throw new GoogleConnectionError('expired_state');
    }

    let grant;
    try {
      grant = await google.exchangeCode({
        callbackUrl: input.callbackUrl,
        state,
        nonce: attempt.nonce,
        codeVerifier: attempt.codeVerifier,
      });
    } catch {
      throw new GoogleConnectionError('provider_error');
    }

    // Granular consent: the user may untick a scope on Google's screen.
    if (!GOOGLE_API_SCOPES.every((scope) => grant.scopes.includes(scope))) {
      throw new GoogleConnectionError('insufficient_scopes');
    }

    const userId = input.sessionUser.id;
    const existing = await this.prisma.googleConnection.findUnique({ where: { userId } });
    let refreshToken = grant.refreshToken;
    if (
      !refreshToken &&
      existing?.status === 'ACTIVE' &&
      existing.refreshTokenEncrypted &&
      existing.googleSubject === grant.subject
    ) {
      // Google omits the refresh token when the grant already exists: keep the one we have.
      refreshToken = vault.decrypt(
        existing.refreshTokenEncrypted,
        tokenContext(userId, 'refresh_token'),
      );
    }
    if (!refreshToken) {
      throw new GoogleConnectionError('missing_refresh_token');
    }

    const access = vault.encrypt(grant.accessToken, tokenContext(userId, 'access_token'));
    const refresh = vault.encrypt(refreshToken, tokenContext(userId, 'refresh_token'));
    const data = {
      googleSubject: grant.subject,
      googleEmail: grant.email.toLowerCase(),
      grantedScopes: grant.scopes,
      accessTokenEncrypted: access.ciphertext,
      refreshTokenEncrypted: refresh.ciphertext,
      encryptionKeyVersion: vault.activeVersion,
      accessTokenExpiresAt: grant.expiresAt,
      status: 'ACTIVE' as const,
      lastRefreshedAt: new Date(),
      revokedAt: null,
    };
    await this.prisma.googleConnection.upsert({
      where: { userId },
      create: { ...data, userId },
      update: data,
    });

    return { redirectPath: attempt.redirectPath };
  }

  /**
   * Internal only (Sheets adapter, PASSO 08+): a valid Google access token for the user,
   * refreshed when close to expiry. Never exposed through the HTTP API.
   */
  async getAccessToken(userId: string): Promise<string> {
    try {
      return await this.resolveAccessToken(userId);
    } catch (error) {
      if (error instanceof CredentialDecryptionError) {
        // Unreadable credential (missing key version or corrupted value): ask the user to
        // reconnect; the stored value is kept so an operator can still recover it.
        throw new ApiException(
          HttpStatus.CONFLICT,
          'google_reauth_required',
          'Reconecte sua conta Google para continuar.',
        );
      }
      throw error;
    }
  }

  private async resolveAccessToken(userId: string): Promise<string> {
    const vault = this.requireVault();
    const connection = await this.prisma.googleConnection.findUnique({
      where: { userId },
    });

    if (
      !connection ||
      connection.status !== 'ACTIVE' ||
      !connection.refreshTokenEncrypted
    ) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        connection ? 'google_reauth_required' : 'google_not_connected',
        connection
          ? 'Reconecte sua conta Google para continuar.'
          : 'Conecte sua conta Google para continuar.',
      );
    }

    const fresh =
      connection.accessTokenEncrypted &&
      connection.accessTokenExpiresAt &&
      connection.accessTokenExpiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now();
    if (fresh && connection.accessTokenEncrypted) {
      const token = vault.decrypt(
        connection.accessTokenEncrypted,
        tokenContext(userId, 'access_token'),
      );
      if (!vault.isCurrent(connection.accessTokenEncrypted)) {
        await this.reencrypt(connection); // lazy key rotation
      }
      return token;
    }

    return this.refreshAccessToken(connection);
  }

  /**
   * Deletes local tokens and asks Google to revoke the grant. Spreadsheets are NOT touched:
   * they stay in the user's Drive and in the database (deleting them is a separate,
   * explicitly confirmed operation).
   */
  async disconnect(user: Pick<AuthenticatedUser, 'id'>): Promise<DisconnectResponse> {
    const connection = await this.prisma.googleConnection.findUnique({
      where: { userId: user.id },
    });
    if (!connection) {
      return { status: 'NOT_CONNECTED', remoteRevocation: 'skipped' };
    }

    let remoteRevocation: DisconnectResponse['remoteRevocation'] = 'skipped';
    const encrypted = connection.refreshTokenEncrypted ?? connection.accessTokenEncrypted;
    if (encrypted && this.google && this.vault) {
      try {
        const field = connection.refreshTokenEncrypted ? 'refresh_token' : 'access_token';
        const token = this.vault.decrypt(encrypted, tokenContext(user.id, field));
        remoteRevocation = (await this.google.revoke(token)) ? 'revoked' : 'failed';
      } catch {
        remoteRevocation = 'failed';
      }
    }

    await this.prisma.googleConnection.update({
      where: { userId: user.id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        encryptionKeyVersion: null,
        accessTokenExpiresAt: null,
        grantedScopes: [],
      },
    });

    return { status: 'REVOKED', remoteRevocation };
  }

  private async refreshAccessToken(connection: GoogleConnection): Promise<string> {
    const vault = this.requireVault();
    const google = this.requireGoogle();
    const userId = connection.userId;
    const refreshToken = vault.decrypt(
      connection.refreshTokenEncrypted as string,
      tokenContext(userId, 'refresh_token'),
    );

    let tokens;
    try {
      tokens = await google.refresh(refreshToken);
    } catch (error) {
      if (error instanceof GoogleGrantRevokedError) {
        // Consent revoked/expired at Google: tokens are useless, ask the user to reconnect.
        await this.prisma.googleConnection.update({
          where: { userId },
          data: {
            status: 'NEEDS_REAUTH',
            accessTokenEncrypted: null,
            refreshTokenEncrypted: null,
            encryptionKeyVersion: null,
            accessTokenExpiresAt: null,
          },
        });
        throw new ApiException(
          HttpStatus.CONFLICT,
          'google_reauth_required',
          'Reconecte sua conta Google para continuar.',
        );
      }
      // Network/5xx at Google: keep the connection as is and report a transient failure.
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'google_unavailable',
        'O Google não respondeu. Tente novamente em instantes.',
      );
    }

    const access = vault.encrypt(
      tokens.accessToken,
      tokenContext(userId, 'access_token'),
    );
    const refresh = tokens.refreshToken
      ? vault.encrypt(tokens.refreshToken, tokenContext(userId, 'refresh_token'))
      : vault.reencrypt(
          connection.refreshTokenEncrypted as string,
          tokenContext(userId, 'refresh_token'),
        );
    await this.prisma.googleConnection.update({
      where: { userId },
      data: {
        accessTokenEncrypted: access.ciphertext,
        refreshTokenEncrypted: refresh.ciphertext,
        encryptionKeyVersion: vault.activeVersion,
        accessTokenExpiresAt: tokens.expiresAt,
        lastRefreshedAt: new Date(),
        ...(tokens.scopes.length > 0 ? { grantedScopes: tokens.scopes } : {}),
      },
    });
    return tokens.accessToken;
  }

  private async reencrypt(connection: GoogleConnection): Promise<void> {
    await rotateConnection(this.prisma, this.requireVault(), connection);
  }

  private async consumeAttempt(stateHash: string, userId: string) {
    try {
      // Bound to purpose AND user: another user's (or a login) state never matches.
      return await this.prisma.authLoginAttempt.delete({
        where: { stateHash, purpose: 'GOOGLE_CONNECTION', userId },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new GoogleConnectionError('invalid_state');
      }
      throw error;
    }
  }

  private requireGoogle(): GoogleOAuthClient {
    if (!this.google) throw new GoogleConnectionError('google_connection_unavailable');
    return this.google;
  }

  private requireVault(): CredentialVault {
    if (!this.vault) throw new GoogleConnectionError('google_connection_unavailable');
    return this.vault;
  }
}

/** Re-encrypts one connection's tokens with the active key (no-op when already current). */
async function rotateConnection(
  prisma: Pick<PrismaClient, 'googleConnection'>,
  vault: CredentialVault,
  connection: GoogleConnection,
): Promise<boolean> {
  const fields = {
    accessTokenEncrypted: connection.accessTokenEncrypted,
    refreshTokenEncrypted: connection.refreshTokenEncrypted,
  };
  const stale = Object.values(fields).some(
    (value) => value !== null && !vault.isCurrent(value),
  );
  if (!stale) {
    return false;
  }

  const userId = connection.userId;
  await prisma.googleConnection.update({
    where: { userId },
    data: {
      accessTokenEncrypted: fields.accessTokenEncrypted
        ? vault.reencrypt(
            fields.accessTokenEncrypted,
            tokenContext(userId, 'access_token'),
          ).ciphertext
        : null,
      refreshTokenEncrypted: fields.refreshTokenEncrypted
        ? vault.reencrypt(
            fields.refreshTokenEncrypted,
            tokenContext(userId, 'refresh_token'),
          ).ciphertext
        : null,
      encryptionKeyVersion: vault.activeVersion,
    },
  });
  return true;
}

/**
 * Re-encrypts every stored Google credential with the active key version.
 * Run after changing DATA_ENCRYPTION_KEY_ACTIVE_VERSION, then the old key can be removed.
 */
export async function rotateGoogleCredentials(
  prisma: Pick<PrismaClient, 'googleConnection'>,
  vault: CredentialVault,
): Promise<{ checked: number; rotated: number; failed: number }> {
  const connections = await prisma.googleConnection.findMany({
    where: {
      OR: [
        { accessTokenEncrypted: { not: null } },
        { refreshTokenEncrypted: { not: null } },
      ],
    },
  });
  let rotated = 0;
  let failed = 0;
  for (const connection of connections) {
    try {
      if (await rotateConnection(prisma, vault, connection)) {
        rotated += 1;
      }
    } catch (error) {
      // Left untouched on purpose: the usual cause is an old key removed too early, and
      // deleting the value would destroy a credential that is recoverable with that key.
      if (error instanceof CredentialDecryptionError) {
        failed += 1;
        continue;
      }
      throw error;
    }
  }
  return { checked: connections.length, rotated, failed };
}
