import { z } from 'zod';
import type { AppLocale } from '../generated/prisma/enums.js';
import { dto } from '../common/validation/zod-validation.pipe.js';

/** BCP 47 tags exposed by the API ↔ database enum values. */
export const LOCALES = {
  'pt-BR': 'pt_BR',
  'en-US': 'en_US',
  'es-ES': 'es_ES',
} as const satisfies Record<string, AppLocale>;

export type LocaleTag = keyof typeof LOCALES;
export const LOCALE_TAGS = Object.keys(LOCALES) as [LocaleTag, ...LocaleTag[]];

export function toLocaleTag(locale: AppLocale): LocaleTag {
  const entry = Object.entries(LOCALES).find(([, value]) => value === locale);
  return (entry?.[0] as LocaleTag | undefined) ?? 'pt-BR';
}

const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

/** ISO 4217 code known to the runtime's Intl data (so it can always be formatted). */
export const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, 'must be an upper-case ISO 4217 code')
  .refine((code) => SUPPORTED_CURRENCIES.has(code), 'unknown currency');

/** IANA time zone name accepted by Intl (offsets like "+03:00" are not accepted). */
export const timeZoneName = z
  .string()
  .max(64)
  .regex(
    /^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+)$/,
    'must be an IANA time zone such as America/Sao_Paulo',
  )
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, 'unknown time zone');

/** Free text without control characters; blank becomes null (clears the field). */
const personName = z
  .string()
  .trim()
  .max(100)
  .refine((value) => !/\p{Cc}/u.test(value), 'must not contain control characters')
  .transform((value) => (value === '' ? null : value))
  .nullable();

/** E.164 (+5511999998888). */
const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'must be in E.164 format, e.g. +5511999998888')
  .nullable();

/** Only https images; the browser loads it, so plain http or data: URLs are refused. */
const photoUrl = z
  .url({ protocol: /^https$/ })
  .max(2048)
  .nullable();

export const preferencesSchema = dto({
  theme: z.enum(['system', 'light', 'dark']),
  weekStartsOn: z.enum(['monday', 'sunday']),
}).partial();

export type Preferences = Required<z.infer<typeof preferencesSchema>>;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  weekStartsOn: 'monday',
};

export const voiceSchema = dto({
  gender: z.enum(['FEMALE', 'MALE']),
  autoSpeak: z.boolean(),
  /** Multiples of 0.05 between 0.5 and 2.0. */
  speakingRate: z
    .number()
    .min(0.5)
    .max(2)
    .refine(
      (rate) => Math.abs(rate * 20 - Math.round(rate * 20)) < 1e-9,
      'must be a multiple of 0.05',
    ),
}).partial();

/**
 * PATCH /profile. Strict: `email`, `id`, `userId`, `roles`, `status` and any unknown key are
 * rejected. The account e-mail only changes through a verified Google identity (login).
 */
export const updateProfileSchema = dto({
  firstName: personName,
  lastName: personName,
  photoUrl,
  phone,
  locale: z.enum(LOCALE_TAGS),
  currency: currencyCode,
  timeZone: timeZoneName,
  preferences: preferencesSchema,
  voice: voiceSchema,
})
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
