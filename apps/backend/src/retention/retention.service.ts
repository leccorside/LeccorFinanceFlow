import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { ReportsService } from '../reports/reports.service.js';

const DAY = 86_400_000;

/**
 * Retention periods (LGPD: keep only what is needed, for as long as needed). The user's own
 * data (finances, conversations, functional history) stays until the user deletes it; these
 * apply to records the platform creates around it.
 */
export const RETENTION = {
  /** Report rows already EXPIRED or FAILED (the files are deleted at expiry). */
  reportsDays: 30,
  /** Confirmations past their expiry. */
  confirmationsDays: 7,
  /** Revoked or fully expired sessions (kept a while to recognize reused refresh tokens). */
  sessionsDays: 30,
  /** Anonymous consumption events (13 months: a year of comparison). */
  usageDays: 395,
  /** Administrative audit trail. */
  adminAuditDays: 730,
} as const;

export interface SweepResult {
  reportFiles: number;
  reports: number;
  confirmations: number;
  loginAttempts: number;
  sessions: number;
  usageEvents: number;
  adminAuditEvents: number;
}

/**
 * Applies the retention policy: at startup and every RETENTION_SWEEP_INTERVAL_HOURS (0 turns
 * the timer off; tests call `sweep()` directly). No queue: each sweep is a few bounded deletes.
 */
@Injectable()
export class RetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  onApplicationBootstrap(): void {
    const hours = this.env.RETENTION_SWEEP_INTERVAL_HOURS;
    if (hours === 0) return;
    void this.safeSweep();
    this.timer = setInterval(() => void this.safeSweep(), hours * 3_600_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now: Date = new Date()): Promise<SweepResult> {
    const before = (days: number) => new Date(now.getTime() - days * DAY);
    const reportFiles = await this.reports.sweep();
    const [
      reports,
      confirmations,
      loginAttempts,
      sessions,
      usageEvents,
      adminAuditEvents,
    ] = await Promise.all([
      this.prisma.report.deleteMany({
        where: {
          status: { in: ['EXPIRED', 'FAILED'] },
          createdAt: { lt: before(RETENTION.reportsDays) },
        },
      }),
      this.prisma.assistantConfirmation.deleteMany({
        where: { expiresAt: { lt: before(RETENTION.confirmationsDays) } },
      }),
      this.prisma.authLoginAttempt.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.userSession.deleteMany({
        where: {
          OR: [
            { revokedAt: { lt: before(RETENTION.sessionsDays) } },
            { refreshExpiresAt: { lt: before(RETENTION.sessionsDays) } },
          ],
        },
      }),
      this.prisma.usageEvent.deleteMany({
        where: { createdAt: { lt: before(RETENTION.usageDays) } },
      }),
      this.prisma.adminAuditEvent.deleteMany({
        where: { createdAt: { lt: before(RETENTION.adminAuditDays) } },
      }),
    ]);
    return {
      reportFiles,
      reports: reports.count,
      confirmations: confirmations.count,
      loginAttempts: loginAttempts.count,
      sessions: sessions.count,
      usageEvents: usageEvents.count,
      adminAuditEvents: adminAuditEvents.count,
    };
  }

  private async safeSweep(): Promise<void> {
    try {
      await this.sweep();
    } catch (error) {
      this.logger.warn(
        `retention sweep failed: ${error instanceof Error ? error.name : 'error'}`,
      );
    }
  }
}
