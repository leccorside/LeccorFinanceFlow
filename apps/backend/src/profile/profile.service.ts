import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ResourceNotFoundException } from '../common/errors/api-error.js';
import { defined } from '../common/validation/defined.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  DEFAULT_PREFERENCES,
  LOCALES,
  type LocaleTag,
  type Preferences,
  preferencesSchema,
  toLocaleTag,
  type UpdateProfileInput,
} from './profile.schemas.js';

export interface ProfileResponse {
  /** Account e-mail: read-only, synchronized from the verified Google identity at login. */
  email: string;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  phone: string | null;
  locale: LocaleTag;
  currency: string;
  timeZone: string;
  preferences: Preferences;
  voice: {
    gender: 'FEMALE' | 'MALE';
    autoSpeak: boolean;
    speakingRate: number;
  };
  updatedAt: string | null;
}

const PROFILE_DEFAULTS = {
  locale: 'pt_BR',
  currency: 'BRL',
  timeZone: 'America/Sao_Paulo',
} as const;
const VOICE_DEFAULTS = { gender: 'FEMALE', autoSpeak: true, speakingRate: 1 } as const;

@Injectable()
export class ProfileService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Always the caller's own profile: the user id comes from the session only. */
  async get(user: Pick<AuthenticatedUser, 'id'>): Promise<ProfileResponse> {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { profile: true, voicePreference: true },
    });
    if (!row) {
      throw new ResourceNotFoundException();
    }

    const profile = row.profile;
    const voice = row.voicePreference;
    return {
      email: row.email,
      firstName: profile?.firstName ?? null,
      lastName: profile?.lastName ?? null,
      photoUrl: profile?.photoUrl ?? null,
      phone: profile?.phone ?? null,
      locale: toLocaleTag(profile?.locale ?? PROFILE_DEFAULTS.locale),
      currency: profile?.currency ?? PROFILE_DEFAULTS.currency,
      timeZone: profile?.timeZone ?? PROFILE_DEFAULTS.timeZone,
      preferences: readPreferences(profile?.preferences),
      voice: {
        gender: voice?.gender ?? VOICE_DEFAULTS.gender,
        autoSpeak: voice?.autoSpeak ?? VOICE_DEFAULTS.autoSpeak,
        speakingRate: voice ? voice.speakingRate.toNumber() : VOICE_DEFAULTS.speakingRate,
      },
      updatedAt: latest(profile?.updatedAt, voice?.updatedAt),
    };
  }

  /** Partial update; absent fields are kept, `null` clears optional text fields. */
  async update(
    user: Pick<AuthenticatedUser, 'id'>,
    input: UpdateProfileInput,
  ): Promise<ProfileResponse> {
    const { voice, preferences, locale, ...rest } = input;
    const fields = defined(rest);

    await this.prisma.$transaction(async (tx) => {
      const hasProfileChanges =
        Object.keys(fields).length > 0 ||
        locale !== undefined ||
        preferences !== undefined;
      if (hasProfileChanges) {
        const current = await tx.userProfile.findUnique({ where: { userId: user.id } });
        const data = {
          ...fields,
          ...(locale ? { locale: LOCALES[locale] } : {}),
          ...(preferences
            ? {
                preferences: {
                  ...readPreferences(current?.preferences),
                  ...defined(preferences),
                },
              }
            : {}),
        };
        await tx.userProfile.upsert({
          where: { userId: user.id },
          create: { ...data, userId: user.id },
          update: data,
        });
      }

      const voiceFields = voice ? defined(voice) : {};
      if (Object.keys(voiceFields).length > 0) {
        const { speakingRate, ...others } = voiceFields;
        const data = {
          ...others,
          ...(speakingRate === undefined
            ? {}
            : { speakingRate: new Prisma.Decimal(speakingRate.toFixed(2)) }),
        };
        await tx.voicePreference.upsert({
          where: { userId: user.id },
          create: { ...data, userId: user.id },
          update: data,
        });
      }
    });

    return this.get(user);
  }
}

/** Stored JSON is untrusted: unknown keys are dropped and invalid values fall back to defaults. */
function readPreferences(stored: Prisma.JsonValue | undefined): Preferences {
  const parsed = preferencesSchema.safeParse(
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? Object.fromEntries(
          Object.entries(stored).filter(([key]) => key in DEFAULT_PREFERENCES),
        )
      : {},
  );
  return { ...DEFAULT_PREFERENCES, ...(parsed.success ? parsed.data : {}) };
}

function latest(...dates: (Date | undefined)[]): string | null {
  const times = dates
    .filter((date): date is Date => date !== undefined)
    .map((date) => date.getTime());
  return times.length === 0 ? null : new Date(Math.max(...times)).toISOString();
}
