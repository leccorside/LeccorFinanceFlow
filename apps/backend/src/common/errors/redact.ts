/**
 * Masks secrets and personal data in text that may reach a log (error messages, paths).
 * Order matters: specific shapes first, the generic "long token" rule last.
 */
const RULES: [RegExp, string][] = [
  // Credentials inside connection strings: postgresql://user:password@host
  [/([a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)[^@\s]+@/gi, '$1[redacted]@'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
  // key=value / key: value pairs whose name says secret (driver and provider messages).
  [
    /\b(password|passwd|pwd|secret|client_secret|token|access_token|refresh_token|api[_-]?key)(["']?\s*[=:]\s*["']?)[^\s"',;&]+/gi,
    '$1$2[redacted]',
  ],
  // Session cookies of this app.
  [/\blff_[a-z_]+=[^;\s]+/gi, 'lff_[cookie]=[redacted]'],
  // JSON Web Tokens (ID tokens, Google responses).
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]'],
  // Provider API keys: OpenAI/Anthropic (sk-…), Google (AIza…), Google OAuth tokens (ya29.…).
  [/\bsk-[A-Za-z0-9_-]{8,}/g, '[api-key]'],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, '[api-key]'],
  [/\bya29\.[0-9A-Za-z._-]+/g, '[oauth-token]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
];

const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  // Any other long opaque token (hex/base64url, 32+ chars). Record ids (UUIDs) are kept:
  // they are not secrets and they are what operations needs to investigate.
  out = out.replace(LONG_TOKEN, (match) => (UUID.test(match) ? match : '[token]'));
  return out.slice(0, 500);
}

/** Path without query string (queries may carry personal data), redacted. */
export function redactPath(url: string | undefined): string {
  return redact((url ?? '').split('?')[0] ?? '');
}
