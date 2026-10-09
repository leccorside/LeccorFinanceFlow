import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { UsageKind } from '../generated/prisma/enums.js';
import { type PriceEntry, SettingsService } from '../settings/settings.service.js';

/** Window of the usage and "recent" counters. */
export const USAGE_WINDOW_DAYS = 30;

export interface UsageRow {
  kind: UsageKind;
  provider: string;
  model: string;
  requests: number;
  failures: number;
  inputUnits: number;
  outputUnits: number;
  /** USD, exact decimal text; null when no price is configured for this model. */
  estimatedCostUsd: string | null;
}

export interface VoiceChainStatus {
  enabled: boolean;
  providers: { provider: string; keyConfigured: boolean; model: string | null }[];
}

export interface AdminOverview {
  windowDays: number;
  users: {
    total: number;
    active: number;
    blocked: number;
    admins: number;
    newInWindow: number;
  };
  google: { connected: number; needsReauth: number; revoked: number };
  spreadsheets: { active: number; total: number };
  assistant: { conversations: number; messagesInWindow: number; enabled: boolean };
  reports: { generatedInWindow: number };
  ai: { activeProviders: number; activeConfigurations: number };
  usage: { rows: UsageRow[]; estimatedCostUsd: string; unpriced: number };
  voice: { transcription: VoiceChainStatus; speech: VoiceChainStatus };
}

const MILLION = new Prisma.Decimal(1_000_000);

/** Price of a usage row, or null when the model has no configured price. */
export function estimateCost(
  row: Pick<UsageRow, 'kind' | 'provider' | 'model' | 'inputUnits' | 'outputUnits'>,
  prices: PriceEntry[],
): string | null {
  const price = prices.find(
    (entry) =>
      entry.kind === row.kind &&
      entry.provider.toLowerCase() === row.provider.toLowerCase() &&
      entry.model === row.model,
  );
  if (!price) return null;
  const input = new Prisma.Decimal(row.inputUnits).dividedBy(MILLION).times(price.input);
  const output =
    row.kind === 'AI_CHAT'
      ? new Prisma.Decimal(row.outputUnits).dividedBy(MILLION).times(price.output)
      : new Prisma.Decimal(0);
  return input.plus(output).toFixed(6);
}

/**
 * The admin dashboard: platform counters, the last 30 days of AI/voice consumption with
 * an estimated cost (from admin-defined prices) and the voice configuration — never a key,
 * only whether one is configured.
 */
@Injectable()
export class AdminOverviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async overview(): Promise<AdminOverview> {
    const since = new Date(Date.now() - USAGE_WINDOW_DAYS * 86_400_000);
    const adminFilter = { roles: { some: { role: { name: 'ADMIN' as const } } } };
    const [
      total,
      active,
      blocked,
      admins,
      newUsers,
      google,
      spreadsheetsActive,
      spreadsheetsTotal,
      conversations,
      messages,
      reports,
      providers,
      configurations,
      usage,
      settings,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { status: 'BLOCKED' } }),
      this.prisma.user.count({ where: { status: 'ACTIVE', ...adminFilter } }),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.googleConnection.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.spreadsheet.count({ where: { status: 'ACTIVE' } }),
      this.prisma.spreadsheet.count(),
      this.prisma.conversation.count(),
      this.prisma.conversationMessage.count({
        where: { role: 'USER', createdAt: { gte: since } },
      }),
      this.prisma.report.count({ where: { createdAt: { gte: since } } }),
      this.prisma.aIProvider.count({ where: { isActive: true } }),
      this.prisma.aIConfiguration.count({
        where: { isActive: true, provider: { isActive: true } },
      }),
      this.prisma.usageEvent.groupBy({
        by: ['kind', 'provider', 'model', 'outcome'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { inputUnits: true, outputUnits: true },
      }),
      this.settings.all(),
    ]);

    const byModel = new Map<string, UsageRow>();
    for (const group of usage) {
      const key = `${group.kind}|${group.provider}|${group.model}`;
      const row = byModel.get(key) ?? {
        kind: group.kind,
        provider: group.provider,
        model: group.model,
        requests: 0,
        failures: 0,
        inputUnits: 0,
        outputUnits: 0,
        estimatedCostUsd: null,
      };
      row.requests += group._count._all;
      if (group.outcome !== 'ok') row.failures += group._count._all;
      row.inputUnits += group._sum.inputUnits ?? 0;
      row.outputUnits += group._sum.outputUnits ?? 0;
      byModel.set(key, row);
    }
    const prices = settings['usage.prices'];
    const rows = [...byModel.values()]
      .map((row) => ({ ...row, estimatedCostUsd: estimateCost(row, prices) }))
      .sort((a, b) => b.requests - a.requests);
    const cost = rows.reduce(
      (sum, row) => (row.estimatedCostUsd ? sum.plus(row.estimatedCostUsd) : sum),
      new Prisma.Decimal(0),
    );
    const googleCount = (status: string) =>
      google.find((group) => group.status === status)?._count._all ?? 0;
    const chain = (
      configs: AppEnv['VOICE']['transcription'],
      enabled: boolean,
    ): VoiceChainStatus => ({
      enabled,
      providers: configs.map((config) => ({
        provider: config.provider,
        keyConfigured: Boolean(config.apiKey),
        model: config.model ?? null,
      })),
    });

    return {
      windowDays: USAGE_WINDOW_DAYS,
      users: { total, active, blocked, admins, newInWindow: newUsers },
      google: {
        connected: googleCount('ACTIVE'),
        needsReauth: googleCount('NEEDS_REAUTH'),
        revoked: googleCount('REVOKED'),
      },
      spreadsheets: { active: spreadsheetsActive, total: spreadsheetsTotal },
      assistant: {
        conversations,
        messagesInWindow: messages,
        enabled: settings['assistant.enabled'],
      },
      reports: { generatedInWindow: reports },
      ai: { activeProviders: providers, activeConfigurations: configurations },
      usage: {
        rows,
        estimatedCostUsd: cost.toFixed(6),
        unpriced: rows.filter((row) => row.estimatedCostUsd === null).length,
      },
      voice: {
        transcription: chain(
          this.env.VOICE.transcription,
          settings['voice.transcription.enabled'],
        ),
        speech: chain(this.env.VOICE.speech, settings['voice.speech.enabled']),
      },
    };
  }
}
