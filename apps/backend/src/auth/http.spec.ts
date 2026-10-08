import { cookieOptions, parseCookies, sanitizeRedirectPath } from './http.js';
import { generateToken, hashToken, pkceChallenge, safeEqual } from './tokens.js';

describe('sanitizeRedirectPath', () => {
  it.each(['/', '/dashboard', '/reports?month=2026-09', '/a/b#c'])('keeps %s', (path) => {
    expect(sanitizeRedirectPath(path)).toBe(path);
  });

  it.each([
    undefined,
    '',
    'dashboard',
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/ok\r\nSet-Cookie: x=1',
    `/${'a'.repeat(600)}`,
  ])('rejects %j', (path) => {
    expect(sanitizeRedirectPath(path)).toBe('/');
  });
});

describe('parseCookies', () => {
  it('parses, trims, decodes and keeps the first duplicate', () => {
    expect(parseCookies('a=1; b = two%20words ; a=2; c="q"; broken; =x')).toEqual({
      a: '1',
      b: 'two words',
      c: 'q',
    });
  });

  it('ignores undecodable values and missing headers', () => {
    expect(parseCookies('bad=%E0%A4%A')).toEqual({});
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe('cookieOptions', () => {
  it('restricts the refresh cookie to auth routes and strict same-site', () => {
    expect(cookieOptions('refresh', true, 1000)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: 1000,
    });
    expect(cookieOptions('session', false)).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api',
    });
  });
});

describe('tokens', () => {
  it('generates distinct 256-bit base64url tokens and hex SHA-256 hashes', () => {
    const a = generateToken();
    const b = generateToken();

    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).toBe(hashToken(a));
  });

  it('computes the RFC 7636 S256 challenge', () => {
    // Test vector from RFC 7636, appendix B.
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('compares in constant time and handles different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
