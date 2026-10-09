import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ResourceNotFoundException } from '../common/errors/api-error.js';
import { ownedBy } from '../common/security/ownership.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AppLocale, Installment, Prisma } from '../generated/prisma/client.js';
import { AccountsService } from './accounts.service.js';
import { ActionHistoryService, snapshotOf } from './action-history.service.js';
import { displayName } from './categories.service.js';
import { formatCalendarDate, parseCalendarDate, todayIn } from './dates.js';
import { type CreateInstallmentInput, ruleViolation } from './finance.schemas.js';
import { moneyString, ZERO } from './money.js';
import {
  addMonthsAnchored,
  cardFirstDueDate,
  parcelDueDate,
  splitAmount,
} from './schedule.js';
import {
  TRANSACTION_INCLUDE,
  type TransactionResponse,
  TransactionsService,
  toResponse as transactionResponse,
} from './transactions.service.js';
import { userSettings } from './user-settings.js';

type User = Pick<AuthenticatedUser, 'id'>;

const INCLUDE = {
  account: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, systemKey: true } },
} as const;
type Row = Prisma.InstallmentGetPayload<{ include: typeof INCLUDE }>;

export interface InstallmentResponse {
  id: string;
  description: string;
  totalAmount: string;
  currency: string;
  installmentCount: number;
  purchasedOn: string;
  firstDueOn: string;
  lastDueOn: string;
  account: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  paidCount: number;
  paidAmount: string;
  pendingCount: number;
  remainingAmount: string;
  /** Due date of the first parcel still pending. */
  nextDueOn: string | null;
  createdAt: string;
}

export interface InstallmentDetail extends InstallmentResponse {
  parcels: TransactionResponse[];
}

/**
 * Installment purchases ("TV de R$ 3.600 em 12x no cartão"): the purchase is an
 * `Installment` and every parcel a PENDING expense due monthly, created together.
 */
@Injectable()
export class InstallmentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(TransactionsService) private readonly transactions: TransactionsService,
    @Inject(ActionHistoryService) private readonly history: ActionHistoryService,
  ) {}

  async list(user: User): Promise<InstallmentResponse[]> {
    const { locale } = await userSettings(this.prisma, user.id);
    const rows = await this.prisma.installment.findMany({
      where: ownedBy(user),
      include: INCLUDE,
      orderBy: [{ purchasedOn: 'desc' }, { createdAt: 'desc' }],
    });
    const progress = await this.progress(
      user,
      rows.map((row) => row.id),
    );
    return rows.map((row) => toResponse(row, locale, progress.get(row.id)));
  }

  async get(user: User, id: string): Promise<InstallmentDetail> {
    const settings = await userSettings(this.prisma, user.id);
    const row = await this.prisma.installment.findFirst({
      where: { id, ...ownedBy(user) },
      include: INCLUDE,
    });
    if (!row) throw new ResourceNotFoundException();
    const [progress, parcels] = await Promise.all([
      this.progress(user, [id]),
      this.prisma.transaction.findMany({
        where: { ...ownedBy(user), installmentId: id },
        include: TRANSACTION_INCLUDE,
        orderBy: { installmentNumber: 'asc' },
      }),
    ]);
    const today = todayIn(settings.timeZone);
    return {
      ...toResponse(row, settings.locale, progress.get(id)),
      parcels: parcels.map((parcel) =>
        transactionResponse(parcel, settings.locale, today),
      ),
    };
  }

  async create(
    user: User,
    input: CreateInstallmentInput,
    context: { conversationId?: string } = {},
  ): Promise<InstallmentDetail> {
    const settings = await userSettings(this.prisma, user.id);
    const purchasedOn = parseCalendarDate(input.purchasedOn) as Date;

    // The same rules as a single expense (ownership, archived, category, currency, decimals).
    const values = await this.transactions.prepare(
      user,
      {
        type: 'EXPENSE',
        description: input.description,
        amount: input.totalAmount,
        occurredOn: input.purchasedOn,
        dueOn: input.purchasedOn,
        ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.paymentMethod !== undefined
          ? { paymentMethod: input.paymentMethod }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
      },
      settings.currency,
    );

    const account = values.accountId
      ? await this.accounts.findOwned(user, values.accountId)
      : null;
    const firstDueOn = input.firstDueOn
      ? (parseCalendarDate(input.firstDueOn) as Date)
      : account?.type === 'CREDIT_CARD' && account.closingDay && account.dueDay
        ? cardFirstDueDate(purchasedOn, account.closingDay, account.dueDay)
        : addMonthsAnchored(purchasedOn, 1);
    if (firstDueOn.getTime() < purchasedOn.getTime()) {
      throw ruleViolation(
        'first_due_before_purchase',
        'A primeira parcela não pode vencer antes da compra.',
      );
    }

    const amounts = splitAmount(values.amount, input.installmentCount, values.currency);
    if (!amounts) {
      throw ruleViolation(
        'installment_amount_too_small',
        'O valor total é pequeno demais para essa quantidade de parcelas.',
        {
          totalAmount: values.amount.toString(),
          installmentCount: input.installmentCount,
        },
      );
    }

    const spreadsheetId = await this.transactions.activeSpreadsheetId(user);
    const id = await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.installment.create({
        data: {
          ownerId: user.id,
          spreadsheetId,
          accountId: values.accountId,
          categoryId: values.categoryId,
          description: values.description,
          totalAmount: values.amount,
          currency: values.currency,
          installmentCount: input.installmentCount,
          purchasedOn,
          firstDueOn,
        },
      });
      const parcels = await tx.transaction.createManyAndReturn({
        data: amounts.map((amount, index) => {
          const dueOn = parcelDueDate(firstDueOn, index + 1);
          return {
            ownerId: user.id,
            spreadsheetId,
            type: 'EXPENSE' as const,
            status: 'PENDING' as const,
            description: values.description,
            amount,
            currency: values.currency,
            // A parcel weighs on the month it is due (budget view), not on the purchase date.
            occurredOn: dueOn,
            dueOn,
            paymentMethod: values.paymentMethod,
            accountId: values.accountId,
            categoryId: values.categoryId,
            installmentId: purchase.id,
            installmentNumber: index + 1,
            notes: values.notes,
            tags: values.tags,
            syncStatus: 'PENDING_SYNC' as const,
          };
        }),
      });
      // One user action, one history entry: the purchase with every parcel.
      await this.history.record(tx, {
        ownerId: user.id,
        entityType: 'INSTALLMENT',
        entityId: purchase.id,
        action: 'CREATE',
        after: {
          ...snapshotOf(purchase),
          parcels: parcels.map((parcel) => snapshotOf(parcel)),
        },
        conversationId: context.conversationId ?? null,
      });
      return purchase.id;
    });
    return this.get(user, id);
  }

  /** Deletes the purchase and all its parcels (paid ones included), with a full snapshot. */
  async delete(
    user: User,
    id: string,
    context: { conversationId?: string } = {},
  ): Promise<void> {
    const current = await this.prisma.installment.findFirst({
      where: { id, ...ownedBy(user) },
    });
    if (!current) throw new ResourceNotFoundException();
    await this.prisma.$transaction(async (tx) => {
      const parcels = await tx.transaction.findMany({
        where: { installmentId: id },
        orderBy: { installmentNumber: 'asc' },
      });
      await tx.transaction.deleteMany({ where: { installmentId: id } });
      await tx.installment.delete({ where: { id } });
      await this.history.record(tx, {
        ownerId: user.id,
        entityType: 'INSTALLMENT',
        entityId: id,
        action: 'DELETE',
        before: {
          ...snapshotOf(current),
          parcels: parcels.map((parcel) => snapshotOf(parcel)),
        },
        conversationId: context.conversationId ?? null,
      });
    });
  }

  /** Paid / pending sums and the next due date per purchase, from database aggregates. */
  private async progress(user: User, ids: string[]) {
    const result = new Map<string, Progress>();
    if (ids.length === 0) return result;
    const [sums, next] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['installmentId', 'status'],
        where: { ...ownedBy(user), installmentId: { in: ids } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['installmentId'],
        where: { ...ownedBy(user), installmentId: { in: ids }, status: 'PENDING' },
        _min: { dueOn: true },
      }),
    ]);
    for (const id of ids) {
      const pick = (status: string) =>
        sums.find((group) => group.installmentId === id && group.status === status);
      result.set(id, {
        paidCount: pick('COMPLETED')?._count._all ?? 0,
        paidAmount: pick('COMPLETED')?._sum.amount ?? ZERO,
        pendingCount: pick('PENDING')?._count._all ?? 0,
        remainingAmount: pick('PENDING')?._sum.amount ?? ZERO,
        nextDueOn: next.find((group) => group.installmentId === id)?._min.dueOn ?? null,
      });
    }
    return result;
  }
}

interface Progress {
  paidCount: number;
  paidAmount: Prisma.Decimal;
  pendingCount: number;
  remainingAmount: Prisma.Decimal;
  nextDueOn: Date | null;
}

function toResponse(
  row: Row | (Installment & Pick<Row, 'account' | 'category'>),
  locale: AppLocale,
  progress: Progress | undefined,
): InstallmentResponse {
  const currency = row.currency;
  return {
    id: row.id,
    description: row.description,
    totalAmount: moneyString(row.totalAmount, currency) as string,
    currency,
    installmentCount: row.installmentCount,
    purchasedOn: formatCalendarDate(row.purchasedOn),
    firstDueOn: formatCalendarDate(row.firstDueOn),
    lastDueOn: formatCalendarDate(parcelDueDate(row.firstDueOn, row.installmentCount)),
    account: row.account,
    category: row.category
      ? { id: row.category.id, name: displayName(row.category, locale) }
      : null,
    paidCount: progress?.paidCount ?? 0,
    paidAmount: moneyString(progress?.paidAmount ?? ZERO, currency) as string,
    pendingCount: progress?.pendingCount ?? 0,
    remainingAmount: moneyString(progress?.remainingAmount ?? ZERO, currency) as string,
    nextDueOn: progress?.nextDueOn ? formatCalendarDate(progress.nextDueOn) : null,
    createdAt: row.createdAt.toISOString(),
  };
}
