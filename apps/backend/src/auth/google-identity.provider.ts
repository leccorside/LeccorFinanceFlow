import * as oidc from 'openid-client';
import { z } from 'zod';

export interface GoogleIdentity {
  /** Google `sub`: stable account identifier. */
  subject: string;
  email: string;
  emailVerified: boolean;
  givenName?: string;
  familyName?: string;
  picture?: string;
}

export interface GoogleOAuthOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface AuthorizationRequest {
  state: string;
  nonce: string;
  codeChallenge: string;
}

export interface CodeExchange {
  /** Callback URL as received (query carries `code`, `state`, optional `iss`). */
  callbackUrl: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** Seam between the auth flow and Google; replaced by a fake in tests. */
export interface GoogleIdentityProvider {
  buildAuthorizationUrl(request: AuthorizationRequest): URL;
  /** Exchanges the code and returns claims from a fully validated ID token. */
  exchangeCode(exchange: CodeExchange): Promise<GoogleIdentity>;
}

/** Null when Google OAuth is not configured. */
export const GOOGLE_IDENTITY_PROVIDER = Symbol('GOOGLE_IDENTITY_PROVIDER');

/** Static metadata: avoids a discovery request at startup. */
export const GOOGLE_SERVER_METADATA: oidc.ServerMetadata = {
  issuer: 'https://accounts.google.com',
  authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  token_endpoint: 'https://oauth2.googleapis.com/token',
  jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
  id_token_signing_alg_values_supported: ['RS256'],
  code_challenge_methods_supported: ['S256'],
};

/** Login only needs identity; Drive/Sheets consent is incremental (PASSO 07). */
export const GOOGLE_LOGIN_SCOPES = 'openid email profile';

const idTokenClaims = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean().optional(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  picture: z.string().url().optional(),
});

export class OpenIdGoogleIdentityProvider implements GoogleIdentityProvider {
  private readonly config: oidc.Configuration;

  constructor(
    private readonly options: GoogleOAuthOptions,
    /** Test seam: replaces network calls to Google (token endpoint and JWKS). */
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
    // By default, ID Tokens received over TLS from the token endpoint are not
    // signature-checked (allowed by OIDC Core 3.1.3.7). Verify against Google's
    // JWKS anyway as defense in depth.
    oidc.enableNonRepudiationChecks(this.config);
  }

  buildAuthorizationUrl({ state, nonce, codeChallenge }: AuthorizationRequest): URL {
    return oidc.buildAuthorizationUrl(this.config, {
      redirect_uri: this.options.redirectUri,
      response_type: 'code',
      scope: GOOGLE_LOGIN_SCOPES,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
  }

  async exchangeCode({
    callbackUrl,
    state,
    nonce,
    codeVerifier,
  }: CodeExchange): Promise<GoogleIdentity> {
    // Validates state, PKCE, iss, aud, exp, nonce and (non-repudiation) the JWS signature.
    const tokens = await oidc.authorizationCodeGrant(
      this.config,
      callbackUrl,
      {
        expectedState: state,
        expectedNonce: nonce,
        pkceCodeVerifier: codeVerifier,
        idTokenExpected: true,
      },
      // Explicit: behind proxies the received URL may differ from the registered one.
      { redirect_uri: this.options.redirectUri },
    );

    // Google access/refresh tokens from the login are discarded on purpose:
    // login only proves identity; API access uses a separate consent (PASSO 07).
    const claims = idTokenClaims.parse(tokens.claims());

    return {
      subject: claims.sub,
      email: claims.email,
      emailVerified: claims.email_verified === true,
      ...(claims.given_name ? { givenName: claims.given_name } : {}),
      ...(claims.family_name ? { familyName: claims.family_name } : {}),
      ...(claims.picture ? { picture: claims.picture } : {}),
    };
  }
}
