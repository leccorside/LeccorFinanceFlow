import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { UsageKind } from '../generated/prisma/enums.js';

export interface UsageRecord {
  kind: UsageKind;
  provider: string;
  model: string;
  inputUnits?: number | undefined;
  outputUnits?: number | undefined;
  outcome: string;
}

const clamp = (value: number | undefined) =>
  Math.max(0, Math.min(2_147_483_647, Math.round(value ?? 0)));

/**
 * Anonymous consumption log (provider, model, volumes, outcome). Recording never breaks
 * the request it measures: a failure here is logged and ignored.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(event: UsageRecord): Promise<void> {
    try {
      await this.prisma.usageEvent.create({
        data: {
          kind: event.kind,
          provider: event.provider.slice(0, 30),
          model: event.model.slice(0, 150),
          inputUnits: clamp(event.inputUnits),
          outputUnits: clamp(event.outputUnits),
          outcome: event.outcome.slice(0, 40),
        },
      });
    } catch (error) {
      this.logger.warn(
        `usage not recorded: ${error instanceof Error ? error.name : 'error'}`,
      );
    }
  }
}
