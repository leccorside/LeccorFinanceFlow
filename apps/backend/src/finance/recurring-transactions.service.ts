import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ApiException, ResourceNotFoundException } from '../common/errors/api-error.js';
import { ownedBy } from '../common/security/ownership.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  AppLocale,
  Prisma,
  RecurringTransaction,
} from '../generated/prisma/client.js';
import { rethrowVersionConflict } from './accounts.service.js';
import {
  ActionHistoryService,
  diffSnapshots,
  snapshotOf,
} from './action-history.service.js';
import { displayName } from './categories.service.js';
import { formatCalendarDate, parseCalendarDate, todayIn } from './dates.js';
import {
  type CreateRecurringInput,
  ruleViolation,
  type UpdateRecurringInput,
} from './finance.schemas.js';
import { moneyString } from './money.js';
import {
  lockRecurrence,
  ruleOf,
  untouchedOccurrences,
} from './recurrence-materializer.js';
import { nextOccurrence, occurrencesBetween } from './schedule.js';
import { TransactionsService } from './transactions.service.js';
import { userSettings } from './user-settings.js';

type User = Pick<AuthenticatedUser, 'id'>;

const INCLUDE = {
  account: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, systemKey: true } },
} as const;
type Row = Prisma.RecurringTransactionGetPayload<{ include: typeof INCLUDE }>;

export interface RecurringResponse {
  id: string;
  type: RecurringTransaction['type'];
  description: string;
  amount: string;
  currency: string;
  paymentMethod: RecurringTransaction['paymentMethod'];
  account: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  frequency: RecurringTransaction['frequency'];
  intervalCount: number;
  intervalUnit: RecurringTransaction['intervalUnit'];
  dayOfMonth: number | null;
  startOn: string;
  endOn: string | null;
  isActive: boolean;
  /** No occurrence left (the end date has passed). */
  isFinished: boolean;
  /** Next dates not yet materialized (up to 3), for confirmations ("próximas: 05/11…"). */
  upcomingDates: string[];
  lastMaterializedOn: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const VALUE_FIELDS = [
  'description',
  'amount',
  'accountId',
  'categoryId',
  'paymentMethod',
] as const;

@Injectable()
export class RecurringTransactionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionsService) private readonly transactions: TransactionsService,
    @Inject(ActionHistoryService) private readonly history: ActionHistoryService,
  ) {}

  async list(user: User, includeInactive = false): Promise<RecurringResponse[]> {
    const { locale } = await userSettings(this.prisma, user.id);
    const rows = await this.prisma.recurringTransaction.findMany({
      where: { ...ownedBy(user), ...(includeInactive ? {} : { isActive: true }) },
      include: INCLUDE,
      orderBy: [
        { isActive: 'desc' },
        { nextOccurrenceOn: 'asc' },
        { description: 'asc' },
      ],
    });
    return rows.map((row) => toResponse(row, locale));
  }

  async get(user: User, id: string): Promise<RecurringResponse> {
    const { locale } = await userSettings(this.prisma, user.id);
    return toResponse(await this.findOwned(user, id), locale);
  }

  async create(
    user: User,
    input: CreateRecurringInput,
    context: { conversationId?: string } = {},
  ): Promise<RecurringResponse> {
    const settings = await userSettings(this.prisma, user.id);
    const startOn = input.startOn
      ? (parseCalendarDate(input.startOn) as Date)
      : todayIn(settings.timeZone);
    const endOn = input.endOn ? parseCalendarDate(input.endOn) : null;
    if (endOn && endOn.getTime() < startOn.getTime()) {
      throw ruleViolation('end_before_start', 'A data final é anterior ao início.');
    }

    // Same rules as a single transaction (ownership, archived, kind, currency, decimals).
    const start = formatCalendarDate(startOn);
    const values = await this.transactions.prepare(
      user,
      {
        type: input.type,
        description: input.description,
        amount: input.amount,
        occurredOn: start,
        dueOn: start,
        ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.paymentMethod !== undefined
          ? { paymentMethod: input.paymentMethod }
          : {}),
      },
      settings.currency,
    );

    const schedule = {
      frequency: input.frequency,
      intervalCount: input.intervalCount ?? 1,
      intervalUnit: input.intervalUnit ?? null,
      dayOfMonth: input.dayOfMonth ?? null,
      startOn,
      endOn,
    };
    const first = nextOccurrence(schedule, startOn);
    if (!first || (endOn && first.getTime() > endOn.getTime())) {
      throw ruleViolation(
        'recurrence_without_occurrences',
        'Com essas datas a recorrência não tem nenhuma ocorrência.',
      );
    }

    const spreadsheetId = await this.transactions.activeSpreadsheetId(user);
    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.recurringTransaction.create({
        data: {
          ...schedule,
          ownerId: user.id,
          spreadsheetId,
          type: values.type,
          description: values.description,
          amount: values.amount,
          currency: values.currency,
          paymentMethod: values.paymentMethod,
          accountId: values.accountId,
          categoryId: values.categoryId,
          nextOccurrenceOn: first,
        },
      });
      await this.history.record(tx, {
        ownerId: user.id,
        entityType: 'RECURRING_TRANSACTION',
        entityId: created.id,
        action: 'CREATE',
        after: snapshotOf(created),
        conversationId: context.conversationId ?? null,
      });
      return created.id;
    });
    return this.get(user, id);
  }

  /**
   * Values, end date and pause apply to future materializations and to the pending
   * occurrences from today on that nobody edited; past and edited ones stay as they are.
   * The schedule itself is fixed (create a new recurrence to change it).
   */
  async update(
    user: User,
    id: string,
    input: UpdateRecurringInput,
    context: { conversationId?: string } = {},
  ): Promise<RecurringResponse> {
    const settings = await userSettings(this.prisma, user.id);
    const today = todayIn(settings.timeZone);
    const current = await this.findOwned(user, id);
    if (input.version !== undefined && input.version !== current.version) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'version_conflict',
        'A recorrência foi alterada por outra operação. Recarregue e tente de novo.',
      );
    }

    const endOn =
      input.endOn === undefined
        ? current.endOn
        : input.endOn
          ? parseCalendarDate(input.endOn)
          : null;
    if (endOn && endOn.getTime() < current.startOn.getTime()) {
      throw ruleViolation('end_before_start', 'A data final é anterior ao início.');
    }

    let values: Partial<
      Pick<
        RecurringTransaction,
        | 'description'
        | 'amount'
        | 'currency'
        | 'accountId'
        | 'categoryId'
        | 'paymentMethod'
      >
    > = {};
    if (VALUE_FIELDS.some((field) => input[field] !== undefined)) {
      const pick = <K extends (typeof VALUE_FIELDS)[number]>(key: K) =>
        input[key] !== undefined ? input[key] : current[key];
      const start = formatCalendarDate(current.startOn);
      const resolved = await this.transactions.prepare(
        user,
        {
          type: current.type,
          description: pick('description') as string,
          amount: input.amount ?? current.amount.toString(),
          occurredOn: start,
          dueOn: start,
          accountId: pick('accountId'),
          categoryId: pick('categoryId'),
          paymentMethod: pick('paymentMethod'),
        },
        settings.currency,
      );
      values = {
        description: resolved.description,
        amount: resolved.amount,
        currency: resolved.currency,
        accountId: resolved.accountId,
        categoryId: resolved.categoryId,
        paymentMethod: resolved.paymentMethod,
      };
    }
    const isActive = input.isActive ?? current.isActive;

    await this.prisma
      .$transaction(async (tx) => {
        await lockRecurrence(tx, id);
        const fresh = await tx.recurringTransaction.findUniqueOrThrow({ where: { id } });
        // Pending, unedited occurrences from today on follow the recurrence.
        const followers = await tx.transaction.findMany({
          where: untouchedOccurrences(fresh, today),
          orderBy: { recurrenceOccurrenceOn: 'asc' },
        });
        const drop = followers.filter(
          (row) =>
            !isActive ||
            (endOn !== null &&
              (row.recurrenceOccurrenceOn as Date).getTime() > endOn.getTime()),
        );
        const keep = followers.filter((row) => !drop.includes(row));

        // Dropped occurrences come back if the recurrence is resumed or extended; a resumed
        // recurrence does not resurrect the occurrences missed while paused.
        let nextOccurrenceOn = fresh.nextOccurrenceOn;
        const firstDropped = drop[0]?.recurrenceOccurrenceOn;
        if (firstDropped && firstDropped.getTime() < nextOccurrenceOn.getTime()) {
          nextOccurrenceOn = firstDropped;
        }
        if (isActive && !fresh.isActive) {
          const resumeAt = nextOccurrence(ruleOf(fresh), today);
          if (resumeAt && resumeAt.getTime() > nextOccurrenceOn.getTime()) {
            nextOccurrenceOn = resumeAt;
          }
        }

        const updated = await tx.recurringTransaction.update({
          where: { id, version: input.version ?? current.version },
          data: {
            ...values,
            endOn,
            isActive,
            nextOccurrenceOn,
            version: { increment: 1 },
          },
        });
        if (drop.length > 0) {
          await tx.transaction.deleteMany({
            where: { id: { in: drop.map((row) => row.id) } },
          });
        }
        if (keep.length > 0 && Object.keys(values).length > 0) {
          await tx.transaction.updateMany({
            where: { id: { in: keep.map((row) => row.id) } },
            data: {
              ...values,
              version: { increment: 1 },
              syncStatus: 'PENDING_SYNC',
              syncError: null,
            },
          });
        }

        const diff = diffSnapshots(snapshotOf(current), snapshotOf(updated));
        const touched = drop.length + (Object.keys(values).length > 0 ? keep.length : 0);
        if (diff || touched > 0) {
          await this.history.record(tx, {
            ownerId: user.id,
            entityType: 'RECURRING_TRANSACTION',
            entityId: id,
            action: 'UPDATE',
            // Occurrences that followed the change, as they were (enough to undo it).
            before: {
              ...(diff?.before ?? {}),
              occurrences: [...keep, ...drop].map((row) => snapshotOf(row)),
            },
            after: {
              ...(diff?.after ?? {}),
              updatedOccurrences:
                Object.keys(values).length > 0 ? keep.map((row) => row.id) : [],
              deletedOccurrences: drop.map((row) => row.id),
            },
            conversationId: context.conversationId ?? null,
          });
        }
      })
      .catch(rethrowVersionConflict);
    return this.get(user, id);
  }

  /**
   * Removes the recurrence and its pending, unedited occurrences from today on. Realized or
   * edited occurrences stay as ordinary transactions.
   */
  async delete(
    user: User,
    id: string,
    context: { conversationId?: string } = {},
  ): Promise<void> {
    const settings = await userSettings(this.prisma, user.id);
    const today = todayIn(settings.timeZone);
    await this.findOwned(user, id);
    await this.prisma.$transaction(async (tx) => {
      await lockRecurrence(tx, id);
      const fresh = await tx.recurringTransaction.findUniqueOrThrow({ where: { id } });
      const followers = await tx.transaction.findMany({
        where: untouchedOccurrences(fresh, today),
      });
      await tx.transaction.deleteMany({
        where: { id: { in: followers.map((row) => row.id) } },
      });
      await tx.recurringTransaction.delete({ where: { id } });
      await this.history.record(tx, {
        ownerId: user.id,
        entityType: 'RECURRING_TRANSACTION',
        entityId: id,
        action: 'DELETE',
        before: {
          ...snapshotOf(fresh),
          occurrences: followers.map((row) => snapshotOf(row)),
        },
        conversationId: context.conversationId ?? null,
      });
    });
  }

  private async findOwned(user: User, id: string): Promise<Row> {
    const row = await this.prisma.recurringTransaction.findFirst({
      where: { id, ...ownedBy(user) },
      include: INCLUDE,
    });
    if (!row) throw new ResourceNotFoundException();
    return row;
  }
}

function toResponse(row: Row, locale: AppLocale): RecurringResponse {
  const rule = ruleOf(row);
  const upcoming = row.isActive
    ? occurrencesBetween(rule, row.nextOccurrenceOn, new Date(Date.UTC(2100, 11, 31)), 3)
    : [];
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    amount: moneyString(row.amount, row.currency) as string,
    currency: row.currency,
    paymentMethod: row.paymentMethod,
    account: row.account,
    category: row.category
      ? { id: row.category.id, name: displayName(row.category, locale) }
      : null,
    frequency: row.frequency,
    intervalCount: row.intervalCount,
    intervalUnit: row.intervalUnit,
    dayOfMonth: row.dayOfMonth,
    startOn: formatCalendarDate(row.startOn),
    endOn: row.endOn ? formatCalendarDate(row.endOn) : null,
    isActive: row.isActive,
    isFinished:
      row.endOn !== null && row.nextOccurrenceOn.getTime() > row.endOn.getTime(),
    upcomingDates: upcoming.map(formatCalendarDate),
    lastMaterializedOn: row.lastMaterializedOn
      ? formatCalendarDate(row.lastMaterializedOn)
      : null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
