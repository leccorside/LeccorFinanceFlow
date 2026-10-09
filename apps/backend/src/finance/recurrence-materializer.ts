import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ownedBy } from '../common/security/ownership.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, RecurringTransaction } from '../generated/prisma/client.js';
import { addDays } from './dates.js';
import { nextOccurrence, occurrencesBetween, type RecurrenceRule } from './schedule.js';

type User = Pick<AuthenticatedUser, 'id'>;

/** Furthest into the future occurrences are ever materialized (from today). */
export const MAX_HORIZON_DAYS = 366;

export function ruleOf(row: RecurringTransaction): RecurrenceRule {
  return {
    frequency: row.frequency,
    intervalCount: row.intervalCount,
    intervalUnit: row.intervalUnit,
    dayOfMonth: row.dayOfMonth,
    startOn: row.startOn,
    endOn: row.endOn,
  };
}

/**
 * Pending occurrences on or after `from` that still carry exactly the values the recurrence
 * generated (nobody edited them). Only these follow later changes to the recurrence.
 */
export function untouchedOccurrences(
  row: RecurringTransaction,
  from: Date,
): Prisma.TransactionWhereInput {
  return {
    ownerId: row.ownerId,
    recurringTransactionId: row.id,
    recurrenceOccurrenceOn: { gte: from },
    status: 'PENDING',
    type: row.type,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    accountId: row.accountId,
    categoryId: row.categoryId,
    paymentMethod: row.paymentMethod,
  };
}

/** Locks the recurrence row until the end of the transaction (serializes materializations/edits). */
export async function lockRecurrence(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "recurring_transactions" WHERE "id" = ${id}::uuid FOR UPDATE`;
}

/**
 * On-demand materialization, without queues: before answering a query that reaches `upTo`,
 * every active recurrence of the user gets its occurrences up to that date (capped at
 * today + MAX_HORIZON_DAYS) as PENDING transactions due on the occurrence date.
 *
 * Idempotent: the recurrence row is locked and re-read inside the transaction, existing
 * occurrence dates are skipped and the unique (recurrence, occurrence date) index is the
 * last line of defense (`skipDuplicates`).
 */
@Injectable()
export class RecurrenceMaterializer {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async materialize(user: User, upTo: Date, today: Date): Promise<number> {
    const cap = addDays(today, MAX_HORIZON_DAYS);
    const horizon = upTo.getTime() > cap.getTime() ? cap : upTo;
    const due = await this.prisma.recurringTransaction.findMany({
      where: {
        ...ownedBy(user),
        isActive: true,
        nextOccurrenceOn: { lte: horizon },
        // Finished recurrences (end date before the next occurrence) cost nothing.
        OR: [
          { endOn: null },
          { endOn: { gte: this.prisma.recurringTransaction.fields.nextOccurrenceOn } },
        ],
      },
      select: { id: true },
    });
    if (due.length === 0) return 0;

    const spreadsheet = await this.prisma.spreadsheet.findFirst({
      where: { ...ownedBy(user), isActive: true, status: 'ACTIVE' },
      select: { id: true },
    });
    let created = 0;
    for (const { id } of due) {
      created += await this.prisma.$transaction((tx) =>
        this.materializeOne(tx, id, horizon, spreadsheet?.id ?? null),
      );
    }
    return created;
  }

  private async materializeOne(
    tx: Prisma.TransactionClient,
    id: string,
    horizon: Date,
    spreadsheetId: string | null,
  ): Promise<number> {
    await lockRecurrence(tx, id);
    const row = await tx.recurringTransaction.findUnique({ where: { id } });
    // Re-checked under the lock: a concurrent request may have done the work already.
    if (!row?.isActive || row.nextOccurrenceOn.getTime() > horizon.getTime()) return 0;

    const rule = ruleOf(row);
    const dates = occurrencesBetween(rule, row.nextOccurrenceOn, horizon);
    const last = dates.at(-1);
    if (!last) return 0; // past the end date

    const existing = await tx.transaction.findMany({
      where: { recurringTransactionId: id, recurrenceOccurrenceOn: { in: dates } },
      select: { recurrenceOccurrenceOn: true },
    });
    const taken = new Set(existing.map((item) => item.recurrenceOccurrenceOn?.getTime()));
    const fresh = dates.filter((date) => !taken.has(date.getTime()));

    const result = await tx.transaction.createMany({
      data: fresh.map((date) => ({
        ownerId: row.ownerId,
        spreadsheetId,
        type: row.type,
        status: 'PENDING' as const,
        description: row.description,
        amount: row.amount,
        currency: row.currency,
        occurredOn: date,
        dueOn: date,
        paymentMethod: row.paymentMethod,
        accountId: row.accountId,
        categoryId: row.categoryId,
        recurringTransactionId: id,
        recurrenceOccurrenceOn: date,
        syncStatus: 'PENDING_SYNC' as const,
      })),
      skipDuplicates: true,
    });
    await tx.recurringTransaction.update({
      where: { id },
      data: {
        nextOccurrenceOn: nextOccurrence(rule, addDays(last, 1)) ?? addDays(last, 1),
        lastMaterializedOn: last,
      },
    });
    return result.count;
  }
}
