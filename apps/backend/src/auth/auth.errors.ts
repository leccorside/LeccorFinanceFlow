/**
 * Public, non-sensitive failure codes. They are sent to the frontend as
 * `/login?error=<code>`, so they never carry details about other accounts.
 */
export type AuthErrorCode =
  | 'oauth_not_configured'
  | 'access_denied'
  | 'invalid_state'
  | 'expired_state'
  | 'provider_error'
  | 'email_not_verified'
  | 'account_blocked'
  | 'account_conflict'
  | 'signups_closed'
  | 'invalid_session';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
  }
}
