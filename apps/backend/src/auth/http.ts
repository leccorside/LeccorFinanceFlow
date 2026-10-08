/**
 * Minimal structural types for the Express request/response features used by auth,
 * plus cookie helpers. Avoids depending on @types/express directly.
 */

export interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict';
  path: string;
  maxAge?: number;
}

export interface HttpResponse {
  cookie(name: string, value: string, options: CookieOptions): unknown;
  clearCookie(name: string, options: Omit<CookieOptions, 'maxAge'>): unknown;
  redirect(status: number, url: string): unknown;
}

export const COOKIE = {
  /** Access token: sent to every API route. */
  session: { name: 'lff_session', path: '/api', sameSite: 'lax' },
  /** Refresh token: only sent to the auth routes, never cross-site. */
  refresh: { name: 'lff_refresh', path: '/api/v1/auth', sameSite: 'strict' },
  /** OAuth state binding: Lax so it survives the top-level redirect back from Google. */
  oauthState: { name: 'lff_oauth_state', path: '/api/v1/auth/google', sameSite: 'lax' },
} as const;

export type CookieKind = keyof typeof COOKIE;

export function cookieOptions(
  kind: CookieKind,
  secure: boolean,
  maxAgeMs?: number,
): CookieOptions {
  const { path, sameSite } = COOKIE[kind];
  return {
    httpOnly: true,
    secure,
    sameSite,
    path,
    ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
  };
}

/** Strict, dependency-free Cookie header parser. Malformed pairs are ignored. */
export function parseCookies(
  header: string | string[] | undefined,
): Record<string, string> {
  const raw = Array.isArray(header) ? header.join('; ') : (header ?? '');
  const cookies: Record<string, string> = {};

  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    let value = part.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (!name || name in cookies) {
      continue; // first occurrence wins, as in browsers' ordering by path specificity
    }
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // ignore undecodable values
    }
  }

  return cookies;
}

export function readCookie(request: HttpRequest, kind: CookieKind): string | undefined {
  return parseCookies(request.headers.cookie)[COOKIE[kind].name];
}

export function queryString(request: HttpRequest, key: string): string | undefined {
  const value = request.query[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Accepts only same-origin relative paths ("/dashboard?x=1"). Anything that could
 * leave the frontend origin ("//evil", "/\\evil", "https://…", control chars) falls back to "/".
 */
export function sanitizeRedirectPath(value: string | undefined): string {
  if (
    !value ||
    value.length > 512 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    hasControlCharacter(value)
  ) {
    return '/';
  }
  return value;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}
