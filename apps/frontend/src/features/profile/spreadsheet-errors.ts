import type { MessageKey } from '../../i18n/catalog';

const KNOWN = new Set([
  'google_not_connected',
  'google_connection_unavailable',
  'google_reauth_required',
  'google_unavailable',
  'google_permission_denied',
  'spreadsheet_setup_in_progress',
  'spreadsheet_setup_failed',
  'spreadsheet_not_found',
]);

/** Message for an API error code (or a stored `lastErrorCode`) of the spreadsheet setup. */
export function spreadsheetErrorKey(code: string | null | undefined): MessageKey {
  return code && KNOWN.has(code)
    ? (`sheets.error.${code}` as MessageKey)
    : 'sheets.error.unknown';
}
