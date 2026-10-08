import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import type { CustomFetch } from 'openid-client';
import { GOOGLE_SERVER_METADATA } from '../auth/google-identity.provider.js';
import {
  GOOGLE_REVOCATION_ENDPOINT,
  GoogleGrantRevokedError,
  OpenIdGoogleOAuthClient,
} from './google-oauth.client.js';

const options = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'secret-xyz',
  redirectUri: 'http://localhost:5173/api/v1/google/callback',
};

let key: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: JWK;

beforeAll(async () => {
  key = await generateKeyPair('RS256');
  jwk = { ...(await exportJWK(key.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
});

const idToken = (nonce: string) =>
  new SignJWT({ email: 'Ana@Example.com', email_verified: true, nonce })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(GOOGLE_SERVER_METADATA.issuer)
    .setAudience(options.clientId)
    .setSubject('google-sub-ana')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key.privateKey);

interface Recorded {
  url: string;
  body: URLSearchParams;
}

function fakeGoogle(tokenResponse: () => Promise<[number, unknown]>) {
  const requests: Recorded[] = [];
  const fetchImpl: CustomFetch = async (url, init) => {
    requests.push({ url, body: new URLSearchParams(String(init.body ?? '')) });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url === GOOGLE_SERVER_METADATA.jwks_uri) return json(200, { keys: [jwk] });
    if (url === GOOGLE_SERVER_METADATA.token_endpoint) {
      const [status, body] = await tokenResponse();
      return json(status, body);
    }
    if (url === GOOGLE_REVOCATION_ENDPOINT) return new Response('', { status: 200 });
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, requests };
}

describe('OpenIdGoogleOAuthClient', () => {
  it('asks for offline, incremental consent with the minimal scopes only', () => {
    const url = new OpenIdGoogleOAuthClient(options).buildConsentUrl({
      state: 's',
      nonce: 'n',
      codeChallenge: 'c',
      loginHint: 'ana@example.com',
    });
    const params = Object.fromEntries(url.searchParams);

    expect(params).toMatchObject({
      client_id: options.clientId,
      redirect_uri: options.redirectUri,
      response_type: 'code',
      scope: 'openid email https://www.googleapis.com/auth/drive.file',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      code_challenge_method: 'S256',
      login_hint: 'ana@example.com',
    });
    expect(params.scope).not.toMatch(/auth\/spreadsheets|auth\/drive(\s|$)/);
  });

  it('exchanges the code (PKCE + nonce + signed ID token) into a token set', async () => {
    const google = fakeGoogle(async () => [
      200,
      {
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        token_type: 'Bearer',
        expires_in: 3599,
        scope:
          'openid https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
        id_token: await idToken('nonce-1'),
      },
    ]);
    const client = new OpenIdGoogleOAuthClient(options, google.fetchImpl);
    const callbackUrl = new URL(`${options.redirectUri}?code=code-1&state=state-1`);

    const grant = await client.exchangeCode({
      callbackUrl,
      state: 'state-1',
      nonce: 'nonce-1',
      codeVerifier: 'v'.repeat(43),
    });

    expect(grant).toMatchObject({
      subject: 'google-sub-ana',
      email: 'Ana@Example.com',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
    expect(grant.scopes).toContain('https://www.googleapis.com/auth/drive.file');
    expect(grant.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3_000_000);
    const tokenRequest = google.requests.find(
      (request) => request.url === GOOGLE_SERVER_METADATA.token_endpoint,
    );
    expect(tokenRequest?.body.get('code_verifier')).toBe('v'.repeat(43));
    expect(tokenRequest?.body.get('redirect_uri')).toBe(options.redirectUri);
  });

  it('rejects an ID token with the wrong nonce', async () => {
    const google = fakeGoogle(async () => [
      200,
      {
        access_token: 'a',
        token_type: 'Bearer',
        expires_in: 10,
        id_token: await idToken('other'),
      },
    ]);
    const client = new OpenIdGoogleOAuthClient(options, google.fetchImpl);

    await expect(
      client.exchangeCode({
        callbackUrl: new URL(`${options.redirectUri}?code=c&state=s`),
        state: 's',
        nonce: 'nonce-1',
        codeVerifier: 'v'.repeat(43),
      }),
    ).rejects.toThrow();
  });

  it('refreshes the access token', async () => {
    const google = fakeGoogle(async () => [
      200,
      {
        access_token: 'access-2',
        token_type: 'Bearer',
        expires_in: 3599,
        scope: 'https://www.googleapis.com/auth/drive.file',
      },
    ]);
    const tokens = await new OpenIdGoogleOAuthClient(options, google.fetchImpl).refresh(
      'refresh-1',
    );

    expect(tokens).toMatchObject({ accessToken: 'access-2' });
    expect(tokens.refreshToken).toBeUndefined();
    expect(google.requests[0]?.body.get('grant_type')).toBe('refresh_token');
    expect(google.requests[0]?.body.get('refresh_token')).toBe('refresh-1');
  });

  it('turns invalid_grant into GoogleGrantRevokedError, but not other failures', async () => {
    const revoked = fakeGoogle(async () => [
      400,
      { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
    ]);
    await expect(
      new OpenIdGoogleOAuthClient(options, revoked.fetchImpl).refresh('r'),
    ).rejects.toBeInstanceOf(GoogleGrantRevokedError);

    const outage = fakeGoogle(async () => [503, { error: 'temporarily_unavailable' }]);
    const failure = new OpenIdGoogleOAuthClient(options, outage.fetchImpl).refresh('r');
    await expect(failure).rejects.toThrow();
    await expect(failure).rejects.not.toBeInstanceOf(GoogleGrantRevokedError);
  });

  it('revokes at Google and reports network failures as false', async () => {
    const google = fakeGoogle(async () => [200, {}]);
    expect(
      await new OpenIdGoogleOAuthClient(options, google.fetchImpl).revoke('refresh-1'),
    ).toBe(true);
    expect(google.requests[0]).toMatchObject({ url: GOOGLE_REVOCATION_ENDPOINT });
    expect(google.requests[0]?.body.get('token')).toBe('refresh-1');

    const broken: CustomFetch = async () => {
      throw new Error('network down');
    };
    expect(await new OpenIdGoogleOAuthClient(options, broken).revoke('x')).toBe(false);
  });
});
