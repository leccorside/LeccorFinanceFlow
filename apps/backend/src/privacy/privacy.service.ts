import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ownedBy } from '../common/security/ownership.js';
import { PrismaService } from '../database/prisma.service.js';

type User = Pick<AuthenticatedUser, 'id'>;

export const EXPORT_FORMAT = 'leccor-finance-flow/export@1';

/** Decimal columns become exact text; dates ISO; everything else unchanged. */
function plain(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === 'object' &&
    'toFixed' in value &&
    typeof (value as { toFixed: unknown }).toFixed === 'function'
  ) {
    return (value as { toString(): string }).toString();
  }
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, plain(item)]),
    );
  }
  return value;
}

/**
 * Data portability (LGPD art. 18): everything the app holds about the user, in a readable
 * JSON. Secrets and server internals are never included — tokens, hashes, CSRF, encrypted
 * values, file locations — and neither is anything about other people.
 */
@Injectable()
export class PrivacyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async export(user: User): Promise<Record<string, unknown>> {
    const owner = ownedBy(user);
    const [
      account,
      accounts,
      categories,
      transactions,
      installments,
      recurring,
      investments,
      spreadsheets,
      conversations,
      reports,
      history,
      sessions,
    ] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
          roles: { select: { role: { select: { name: true } }, assignedAt: true } },
          profile: {
            select: {
              firstName: true,
              lastName: true,
              photoUrl: true,
              phone: true,
              locale: true,
              currency: true,
              timeZone: true,
              preferences: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          voicePreference: {
            select: { gender: true, speakingRate: true, autoSpeak: true, locale: true },
          },
          googleConnection: {
            select: {
              googleEmail: true,
              grantedScopes: true,
              status: true,
              lastRefreshedAt: true,
              revokedAt: true,
            },
          },
        },
      }),
      this.prisma.financialAccount.findMany({
        where: owner,
        omit: { ownerId: true, syncError: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.category.findMany({
        where: owner,
        omit: { ownerId: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.transaction.findMany({
        where: owner,
        omit: { ownerId: true, syncError: true },
        orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.installment.findMany({
        where: owner,
        omit: { ownerId: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.recurringTransaction.findMany({
        where: owner,
        omit: { ownerId: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.investment.findMany({
        where: owner,
        omit: { ownerId: true, syncError: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.spreadsheet.findMany({
        where: owner,
        select: {
          id: true,
          name: true,
          googleSpreadsheetId: true,
          status: true,
          isActive: true,
          lastSyncedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.conversation.findMany({
        where: owner,
        select: {
          id: true,
          title: true,
          locale: true,
          createdAt: true,
          messages: {
            select: { role: true, content: true, toolName: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.report.findMany({
        where: owner,
        select: {
          id: true,
          type: true,
          format: true,
          periodStart: true,
          periodEnd: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.actionHistory.findMany({
        where: owner,
        select: {
          entityType: true,
          entityId: true,
          action: true,
          beforeState: true,
          afterState: true,
          revertedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.userSession.findMany({
        where: { userId: user.id },
        select: {
          createdAt: true,
          lastUsedAt: true,
          refreshExpiresAt: true,
          revokedAt: true,
          revokedReason: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return plain({
      format: EXPORT_FORMAT,
      generatedAt: new Date(),
      account: {
        ...account,
        roles: account.roles.map((item) => ({
          role: item.role.name,
          since: item.assignedAt,
        })),
      },
      financialAccounts: accounts,
      categories,
      transactions,
      installments,
      recurringTransactions: recurring,
      investments,
      spreadsheets,
      conversations,
      reports,
      changeHistory: history,
      sessions,
    }) as Record<string, unknown>;
  }
}
