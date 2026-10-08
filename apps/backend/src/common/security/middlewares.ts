import { randomUUID } from 'node:crypto';
import type { HttpRequest } from '../../auth/http.js';

interface HeaderResponse {
  setHeader(name: string, value: string): unknown;
  removeHeader(name: string): unknown;
}

type Next = () => void;

/**
 * Ephemeral correlation id for one request (error bodies + X-Request-Id header).
 * Incoming ids are ignored on purpose (no header injection, no cross-request tracking).
 */
export function requestIdMiddleware(
  request: HttpRequest,
  response: HeaderResponse,
  next: Next,
): void {
  const id = randomUUID();
  request.requestId = id;
  response.setHeader('X-Request-Id', id);
  next();
}

/**
 * Security headers for a JSON API. The frontend's own CSP is defined with the UI
 * hardening (PASSO 21); these apply to every API response.
 */
export function securityHeadersMiddleware(options: { hsts: boolean }) {
  return (_request: HttpRequest, response: HeaderResponse, next: Next): void => {
    response.removeHeader('X-Powered-By');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
    response.setHeader('Cache-Control', 'no-store');
    if (options.hsts) {
      response.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }
    next();
  };
}
