import type { Locale } from '../i18n/catalog';
import { api } from './api';

export type Theme = 'system' | 'light' | 'dark';
export type WeekStart = 'monday' | 'sunday';
export type VoiceGender = 'FEMALE' | 'MALE';

export interface Profile {
  /** Read-only: synchronized from the verified Google account. */
  email: string;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  phone: string | null;
  locale: Locale;
  currency: string;
  timeZone: string;
  preferences: { theme: Theme; weekStartsOn: WeekStart };
  voice: { gender: VoiceGender; autoSpeak: boolean; speakingRate: number };
  updatedAt: string | null;
}

export interface ProfileUpdate {
  firstName?: string | null;
  lastName?: string | null;
  photoUrl?: string | null;
  phone?: string | null;
  locale?: Locale;
  currency?: string;
  timeZone?: string;
  preferences?: Partial<Profile['preferences']>;
  voice?: Partial<Profile['voice']>;
}

export async function getProfile(): Promise<Profile> {
  return (await api.get<Profile>('/profile')).data;
}

export async function updateProfile(update: ProfileUpdate): Promise<Profile> {
  return (await api.patch<Profile>('/profile', update)).data;
}
