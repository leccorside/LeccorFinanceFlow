import * as oidc from 'openid-client';
import { z } from 'zod';
import { GOOGLE_SERVER_METADATA } from '../auth/google-identity.provider.js';

/**
 * Minimal API scope: `drive.file` lets the app create spreadsheets and edit only the files it
 * created or the user opened with it (enough for the Sheets API). The broader
 * `.../auth/spreadsheets` scope (every spreadsheet of the user) is deliberately NOT requested.
 */
export const GOOGLE_API_SCOPES = ['https://www.googleapis.com/auth/drive.file'] as const;

/** `openid email` identify which Google account granted access (it may differ from the login). */
export const GOOGLE_CONNECTION_SCOPE = ['openid', 'email', ...GOOGLE_API_SCOPES].join(
  ' ',
);

export const GOOGLE_REVOCATION_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

export interface GoogleTokenSet {
  accessToken: string;
  /** Google only returns it on consent; absent on most refreshes. */
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}

export interface GoogleConnectionGrant extends GoogleTokenSet {
  subject: string;
  email: string;
}

export interface ConsentRequest {
  state: string;
  nonce: string;
  codeChallenge: string;
  loginHint?: string;
}

export interface ConsentExchange {
  callbackUrl: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** The refresh token was revoked, expired or the consent was removed: reconnection needed. */
export class GoogleGrantRevokedError extends Error {
  constructor() {
    super('google grant revoked or expired');
    this.name = 'GoogleGrantRevokedError';
  }
}

/** Seam to Google OAuth for the Drive/Sheets connection; faked in tests. */
export interface GoogleOAuthClient {
  buildConsentUrl(request: ConsentRequest): URL;
  exchangeCode(exchange: ConsentExchange): Promise<GoogleConnectionGrant>;
  /** Throws GoogleGrantRevokedError for invalid_grant; other errors are transient. */
  refresh(refreshToken: string): Promise<GoogleTokenSet>;
  /** Best effort: true when Google confirmed the revocation. */
  revoke(token: string): Promise<boolean>;
}

/** Null when Google OAuth is not configured. */
export const GOOGLE_OAUTH_CLIENT = Symbol('GOOGLE_OAUTH_CLIENT');

const connectionClaims = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
});

export function parseScopes(scope: string | undefined): string[] {
  return (scope ?? '').split(/\s+/).filter((item) => item !== '');
}

export class OpenIdGoogleOAuthClient implements GoogleOAuthClient {
  private readonly config: oidc.Configuration;
  private readonly fetchImpl: oidc.CustomFetch;

  constructor(
    private readonly options: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    },
    fetchImplementation?: oidc.CustomFetch,
  ) {
    this.config = new oidc.Configuration(
      GOOGLE_SERVER_METADATA,
      options.clientId,
      options.clientSecret,
    );
    if (fetchImplementation) {
      this.config[oidc.customFetch] = fetchImplementation;
    }
    oidc.enableNonRepudiationChecks(this.config);
    this.fetchImpl =
      fetchImplementation ?? ((url, options) => fetch(url, options as RequestInit));
  }

  buildConsentUrl({ state, nonce, codeChallenge, loginHint }: ConsentRequest): URL {
    return oidc.buildAuthorizationUrl(this.config, {
      redirect_uri: this.options.redirectUri,
      response_type: 'code',
      scope: GOOGLE_CONNECTION_SCOPE,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      // Offline access + forced consent so Google issues a refresh token.
      access_type: 'offline',
      prompt: 'consent',
      // Incremental authorization: keep scopes granted before.
      include_granted_scopes: 'true',
      ...(loginHint ? { login_hint: loginHint } : {}),
    });
  }

  async exchangeCode({
    callbackUrl,
    state,
    nonce,
    codeVerifier,
  }: ConsentExchange): Promise<GoogleConnectionGrant> {
    const tokens = await oidc.authorizationCodeGrant(
      this.config,
      callbackUrl,
      {
        expectedState: state,
        expectedNonce: nonce,
        pkceCodeVerifier: codeVerifier,
        idTokenExpected: true,
      },
      { redirect_uri: this.options.redirectUri },
    );
    const claims = connectionClaims.parse(tokens.claims());

    return {
      subject: claims.sub,
      email: claims.email,
      accessToken: tokens.access_token,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      expiresAt: expiry(tokens.expires_in),
      scopes: parseScopes(tokens.scope),
    };
  }

  async refresh(refreshToken: string): Promise<GoogleTokenSet> {
    try {
      const tokens = await oidc.refreshTokenGrant(this.config, refreshToken);
      return {
        accessToken: tokens.access_token,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        expiresAt: expiry(tokens.expires_in),
        scopes: parseScopes(tokens.scope),
      };
    } catch (error) {
      if (error instanceof oidc.ResponseBodyError && error.error === 'invalid_grant') {
        throw new GoogleGrantRevokedError();
      }
      throw error;
    }
  }

  async revoke(token: string): Promise<boolean> {
    try {
      const response = await this.fetchImpl(GOOGLE_REVOCATION_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
        redirect: 'manual',
      });
      // 400 invalid_token: already revoked/expired at Google — the goal is reached too.
      return response.ok || response.status === 400;
    } catch {
      return false;
    }
  }
}

function expiry(expiresIn: number | undefined): Date {
  // Google access tokens last ~1h; assume a short life when the field is missing.
  return new Date(Date.now() + (expiresIn ?? 300) * 1000);
}
