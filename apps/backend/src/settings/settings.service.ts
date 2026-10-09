import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

/** Decimal text with up to 6 decimals ("2.50"): prices are never floats. */
const price = z.string().regex(/^\d{1,6}(\.\d{1,6})?$/, 'must look like 2.50');

export const PRICE_ENTRY = z.strictObject({
  kind: z.enum(['AI_CHAT', 'VOICE_SPEECH', 'VOICE_TRANSCRIPTION']),
  provider: z.string().trim().min(1).max(30),
  model: z.string().trim().min(1).max(150),
  /** USD per 1 million input units (tokens; characters for speech; MB for transcription). */
  input: price,
  /** USD per 1 million output units (tokens for chat; ignored for voice). */
  output: price,
});

/**
 * The global settings an admin can change. Only these keys exist; each has a strict schema
 * and a default, so a missing row means "default" and nothing else can be stored.
 */
export const SETTINGS = {
  'signups.enabled': {
    schema: z.boolean(),
    default: true,
    description:
      'Novas contas podem entrar com Google (e-mails de ADMIN_EMAILS sempre podem).',
  },
  'assistant.enabled': {
    schema: z.boolean(),
    default: true,
    description:
      'O assistente responde mensagens (desligado, o chat avisa que está em pausa).',
  },
  'voice.transcription.enabled': {
    schema: z.boolean(),
    default: true,
    description: 'Transcrição de voz disponível (se houver provedor configurado).',
  },
  'voice.speech.enabled': {
    schema: z.boolean(),
    default: true,
    description: 'Leitura em voz alta disponível (se houver provedor configurado).',
  },
  'usage.prices': {
    schema: z.array(PRICE_ENTRY).max(60),
    default: [] as z.infer<typeof PRICE_ENTRY>[],
    description:
      'Preços em USD por milhão de unidades, usados só para estimar o consumo.',
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValues = {
  [K in SettingKey]: z.infer<(typeof SETTINGS)[K]['schema']>;
};
export type PriceEntry = z.infer<typeof PRICE_ENTRY>;

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

/** A strict partial update: only known keys, each with its own schema. */
export const settingsUpdate = z
  .strictObject(
    Object.fromEntries(
      SETTING_KEYS.map((key) => [key, SETTINGS[key].schema.optional()]),
    ) as { [K in SettingKey]: z.ZodOptional<(typeof SETTINGS)[K]['schema']> },
  )
  .refine((value) => Object.keys(value).length > 0, 'at least one setting is required');

/** Short cache: settings are read on hot paths (login, every chat message). */
const CACHE_MS = 2_000;

@Injectable()
export class SettingsService {
  private cache: { values: SettingValues; at: number } | null = null;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async all(): Promise<SettingValues> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.values;
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: SETTING_KEYS } },
      select: { key: true, value: true },
    });
    const values = Object.fromEntries(
      SETTING_KEYS.map((key) => {
        const row = rows.find((item) => item.key === key);
        // A row that no longer matches the schema falls back to the default.
        const parsed = SETTINGS[key].schema.safeParse(row?.value);
        return [key, row && parsed.success ? parsed.data : SETTINGS[key].default];
      }),
    ) as SettingValues;
    this.cache = { values, at: Date.now() };
    return values;
  }

  async get<K extends SettingKey>(key: K): Promise<SettingValues[K]> {
    return (await this.all())[key];
  }

  /** Saves a validated partial update and returns every value. */
  async update(
    changes: Partial<SettingValues>,
    updatedById: string,
  ): Promise<SettingValues> {
    await this.prisma.$transaction(
      Object.entries(changes).map(([key, value]) =>
        this.prisma.systemSetting.upsert({
          where: { key },
          create: {
            key,
            value: value as Prisma.InputJsonValue,
            description: SETTINGS[key as SettingKey].description,
            updatedById,
          },
          update: { value: value as Prisma.InputJsonValue, updatedById },
        }),
      ),
    );
    this.cache = null;
    return this.all();
  }

  /** Tests and the admin screen read fresh values right after a change. */
  invalidate(): void {
    this.cache = null;
  }
}
