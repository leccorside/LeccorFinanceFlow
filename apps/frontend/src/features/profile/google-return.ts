import type { MessageKey } from '../../i18n/catalog';

const KNOWN_ERRORS = new Set([
  'google_connection_unavailable',
  'unauthenticated',
  'access_denied',
  'invalid_state',
  'expired_state',
  'provider_error',
  'insufficient_scopes',
  'missing_refresh_token',
]);

/** Message for the `?google=connected` / `?googleError=<code>` return of the consent flow. */
export function returnMessageKey(
  connected: string | null,
  error: string | null,
): MessageKey | null {
  if (error) {
    return KNOWN_ERRORS.has(error)
      ? (`google.error.${error}` as MessageKey)
      : 'google.error.unknown';
  }
  return connected === 'connected' ? 'google.connectedNow' : null;
}
