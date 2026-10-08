import { api } from './api';

export type GoogleConnectionStatus =
  'NOT_CONNECTED' | 'ACTIVE' | 'NEEDS_REAUTH' | 'REVOKED';

/** Status only: Google tokens never reach the browser. */
export interface GoogleConnection {
  status: GoogleConnectionStatus;
  googleEmail: string | null;
  grantedScopes: string[];
  requiredScopes: string[];
  missingScopes: string[];
  connectedAt: string | null;
  lastRefreshedAt: string | null;
}

export interface DisconnectResult {
  status: GoogleConnectionStatus;
  remoteRevocation: 'revoked' | 'failed' | 'skipped';
}

export async function getGoogleConnection(): Promise<GoogleConnection> {
  return (await api.get<GoogleConnection>('/google/connection')).data;
}

export async function disconnectGoogle(): Promise<DisconnectResult> {
  return (await api.delete<DisconnectResult>('/google/connection')).data;
}

/** Full-page navigation to the backend, which redirects to Google's consent screen. */
export function googleConnectUrl(redirectTo = '/profile'): string {
  return `/api/v1/google/connect?redirectTo=${encodeURIComponent(redirectTo)}`;
}
