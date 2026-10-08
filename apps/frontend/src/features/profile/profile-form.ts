import type { Locale } from '../../i18n/catalog';
import type {
  Profile,
  ProfileUpdate,
  Theme,
  VoiceGender,
  WeekStart,
} from '../../services/profile';

/** Form state: text inputs are strings ('' means "clear"). */
export interface ProfileFormState {
  firstName: string;
  lastName: string;
  photoUrl: string;
  phone: string;
  locale: Locale;
  currency: string;
  timeZone: string;
  theme: Theme;
  weekStartsOn: WeekStart;
  gender: VoiceGender;
  autoSpeak: boolean;
  speakingRate: number;
}

export type ProfileField = keyof ProfileFormState;

export function toFormState(profile: Profile): ProfileFormState {
  return {
    firstName: profile.firstName ?? '',
    lastName: profile.lastName ?? '',
    photoUrl: profile.photoUrl ?? '',
    phone: profile.phone ?? '',
    locale: profile.locale,
    currency: profile.currency,
    timeZone: profile.timeZone,
    theme: profile.preferences.theme,
    weekStartsOn: profile.preferences.weekStartsOn,
    gender: profile.voice.gender,
    autoSpeak: profile.voice.autoSpeak,
    speakingRate: profile.voice.speakingRate,
  };
}

const nullable = (value: string) => (value.trim() === '' ? null : value.trim());

/** Only the fields that changed, so the PATCH never overwrites what the user did not touch. */
export function diffProfile(
  original: ProfileFormState,
  current: ProfileFormState,
): ProfileUpdate {
  const update: ProfileUpdate = {};
  for (const field of ['firstName', 'lastName', 'photoUrl', 'phone'] as const) {
    if (nullable(original[field]) !== nullable(current[field])) {
      update[field] = nullable(current[field]);
    }
  }
  for (const field of ['locale', 'currency', 'timeZone'] as const) {
    if (original[field] !== current[field]) {
      (update as Record<string, unknown>)[field] = current[field];
    }
  }

  const preferences: NonNullable<ProfileUpdate['preferences']> = {};
  if (original.theme !== current.theme) preferences.theme = current.theme;
  if (original.weekStartsOn !== current.weekStartsOn)
    preferences.weekStartsOn = current.weekStartsOn;
  if (Object.keys(preferences).length > 0) update.preferences = preferences;

  const voice: NonNullable<ProfileUpdate['voice']> = {};
  if (original.gender !== current.gender) voice.gender = current.gender;
  if (original.autoSpeak !== current.autoSpeak) voice.autoSpeak = current.autoSpeak;
  if (original.speakingRate !== current.speakingRate)
    voice.speakingRate = current.speakingRate;
  if (Object.keys(voice).length > 0) update.voice = voice;

  return update;
}

const API_PATH_TO_FIELD: Record<string, ProfileField> = {
  firstName: 'firstName',
  lastName: 'lastName',
  photoUrl: 'photoUrl',
  phone: 'phone',
  locale: 'locale',
  currency: 'currency',
  timeZone: 'timeZone',
  'preferences.theme': 'theme',
  'preferences.weekStartsOn': 'weekStartsOn',
  'voice.gender': 'gender',
  'voice.autoSpeak': 'autoSpeak',
  'voice.speakingRate': 'speakingRate',
};

/** Maps `validation_failed` issue paths from the API to form fields. */
export function fieldErrorsFrom(details: unknown): Set<ProfileField> {
  const fields = new Set<ProfileField>();
  const issues = (details as { issues?: { path?: unknown }[] } | null)?.issues;
  if (!Array.isArray(issues)) return fields;
  for (const issue of issues) {
    const field =
      typeof issue.path === 'string' ? API_PATH_TO_FIELD[issue.path] : undefined;
    if (field) fields.add(field);
  }
  return fields;
}
