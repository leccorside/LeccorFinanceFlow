import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import type { CustomFetch } from 'openid-client';
import {
  GOOGLE_SERVER_METADATA,
  type GoogleOAuthOptions,
  OpenIdGoogleIdentityProvider,
} from './google-identity.provider.js';

const options: GoogleOAuthOptions = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'secret-xyz',
  redirectUri: 'http://localhost:5173/api/v1/auth/google/callback',
};

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let googleKey: KeyPair;
let attackerKey: KeyPair;
let publicJwk: JWK;

beforeAll(async () => {
  googleKey = await generateKeyPair('RS256');
  attackerKey = await generateKeyPair('RS256');
  publicJwk = {
    ...(await exportJWK(googleKey.publicKey)),
    kid: 'google-key',
    alg: 'RS256',
    use: 'sig',
  };
});

interface IdTokenOverrides {
  claims?: Record<string, unknown>;
  audience?: string;
  issuer?: string;
  /** Absolute `exp` (seconds since epoch). */
  expiresAt?: number;
  signWith?: KeyPair;
}

async function idToken(nonce: string, overrides: IdTokenOverrides = {}): Promise<string> {
  return new SignJWT({
    email: 'Ana@Example.com',
    email_verified: true,
    given_name: 'Ana',
    family_name: 'Silva',
    picture: 'https://lh3.googleusercontent.com/a/photo',
    nonce,
    ...overrides.claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'google-key' })
    .setIssuer(overrides.issuer ?? GOOGLE_SERVER_METADATA.issuer)
    .setAudience(overrides.audience ?? options.clientId)
    .setSubject('google-sub-1')
    .setIssuedAt(
      overrides.expiresAt === undefined ? undefined : overrides.expiresAt - 3600,
    )
    .setExpirationTime(overrides.expiresAt ?? '5m')
    .sign((overrides.signWith ?? googleKey).privateKey);
}

/** Fake Google: token endpoint + JWKS. Records token requests for assertions. */
function fakeGoogle(token: () => Promise<string>) {
  const tokenRequests: URLSearchParams[] = [];
  const fetchImpl: CustomFetch = async (url, init) => {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    if (url === GOOGLE_SERVER_METADATA.jwks_uri) {
      return json({ keys: [publicJwk] });
    }
    if (url === GOOGLE_SERVER_METADATA.token_endpoint) {
      tokenRequests.push(new URLSearchParams(String(init.body)));
      return json({
        access_token: 'google-access-token',
        token_type: 'Bearer',
        expires_in: 3599,
        scope: 'openid email profile',
        id_token: await token(),
      });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, tokenRequests };
}

function callback(state: string): URL {
  const url = new URL(options.redirectUri);
  url.searchParams.set('code', 'auth-code-1');
  url.searchParams.set('state', state);
  return url;
}

const exchange = { state: 'state-1', nonce: 'nonce-1', codeVerifier: 'v'.repeat(43) };

describe('OpenIdGoogleIdentityProvider', () => {
  it('builds an authorization URL with PKCE S256, state, nonce and minimal scopes', () => {
    const provider = new OpenIdGoogleIdentityProvider(options);
    const url = provider.buildAuthorizationUrl({
      state: 's',
      nonce: 'n',
      codeChallenge: 'c',
    });

    expect(`${url.origin}${url.pathname}`).toBe(
      GOOGLE_SERVER_METADATA.authorization_endpoint,
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: options.clientId,
      redirect_uri: options.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: 's',
      nonce: 'n',
      code_challenge: 'c',
      code_challenge_method: 'S256',
    });
  });

  it('returns the identity from a valid ID token and sends the PKCE verifier', async () => {
    const google = fakeGoogle(() => idToken('nonce-1'));
    const provider = new OpenIdGoogleIdentityProvider(options, google.fetchImpl);

    await expect(
      provider.exchangeCode({ ...exchange, callbackUrl: callback('state-1') }),
    ).resolves.toEqual({
      subject: 'google-sub-1',
      email: 'Ana@Example.com',
      emailVerified: true,
      givenName: 'Ana',
      familyName: 'Silva',
      picture: 'https://lh3.googleusercontent.com/a/photo',
    });

    const request = google.tokenRequests[0];
    expect(request?.get('grant_type')).toBe('authorization_code');
    expect(request?.get('code')).toBe('auth-code-1');
    expect(request?.get('code_verifier')).toBe(exchange.codeVerifier);
    expect(request?.get('redirect_uri')).toBe(options.redirectUri);
  });

  it.each<[string, () => Promise<string>, string?]>([
    ['nonce mismatch', () => idToken('other-nonce')],
    ['wrong audience', () => idToken('nonce-1', { audience: 'someone-else' })],
    ['signature by an unknown key', () => idToken('nonce-1', { signWith: attackerKey })],
    ['wrong issuer', () => idToken('nonce-1', { issuer: 'https://evil.example' })],
    [
      'expired token',
      () => idToken('nonce-1', { expiresAt: Math.floor(Date.now() / 1000) - 600 }),
    ],
    ['state mismatch in the callback', () => idToken('nonce-1'), 'tampered-state'],
  ])('rejects %s', async (_label, token, callbackState) => {
    const provider = new OpenIdGoogleIdentityProvider(
      options,
      fakeGoogle(token).fetchImpl,
    );

    await expect(
      provider.exchangeCode({
        ...exchange,
        callbackUrl: callback(callbackState ?? 'state-1'),
      }),
    ).rejects.toThrow();
  });
});
