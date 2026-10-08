import { AxiosError } from 'axios';
import type { Locale } from '../i18n/catalog';
import { api } from './api';

export interface CurrentUser {
  id: string;
  email: string;
  status: 'ACTIVE' | 'BLOCKED';
  roles: ('ADMIN' | 'USER')[];
  profile: {
    firstName: string | null;
    lastName: string | null;
    photoUrl: string | null;
    locale: Locale;
    currency: string;
    timeZone: string;
  } | null;
}

/** Current user, or null when there is no valid session. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const response = await api.get<CurrentUser>('/auth/me');
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError && error.response?.status === 401) {
      return null;
    }
    throw error;
  }
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
  api.resetSession();
}

/** Full-page navigation: the OAuth flow is a series of redirects handled by the backend. */
export function googleLoginUrl(redirectTo = '/profile'): string {
  return `/api/v1/auth/google/login?redirectTo=${encodeURIComponent(redirectTo)}`;
}
