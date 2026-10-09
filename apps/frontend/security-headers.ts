/**
 * Security headers for the HTML/JS of the web app. The API sends its own (stricter) set.
 *
 * Production policy: nothing outside our origin runs or loads. Inline styles are allowed
 * because charts and animations set `style` attributes; inline scripts are not. Images may
 * be data/blob (generated charts) and audio blob (spoken answers). Any server that hosts the
 * built files (vite preview today, the deploy server later) must send these headers.
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Development only: Vite injects an inline React Refresh preamble and talks to the browser
 * over a WebSocket for hot reload. Nothing else is relaxed.
 */
const DEVELOPMENT_CSP = PRODUCTION_CSP.replace(
  "script-src 'self'",
  "script-src 'self' 'unsafe-inline'",
).replace("connect-src 'self'", "connect-src 'self' ws: wss:");

const COMMON = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), geolocation=(), payment=(), usb=(), microphone=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export const productionHeaders: Record<string, string> = {
  ...COMMON,
  'Content-Security-Policy': PRODUCTION_CSP,
};

export const developmentHeaders: Record<string, string> = {
  ...COMMON,
  'Content-Security-Policy': DEVELOPMENT_CSP,
};
