import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ownedBy } from '../common/security/ownership.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  type Category,
  Prisma,
  type TransactionType,
} from '../generated/prisma/client.js';
import { displayName } from './categories.service.js';
import {
  addDays,
  daysBetween,
  formatCalendarDate,
  parseCalendarDate,
  todayIn,
} from './dates.js';
import { ruleViolation } from './finance.schemas.js';
import { moneyString, ZERO } from './money.js';
import { RecurrenceMaterializer } from './recurrence-materializer.js';
import {
  TRANSACTION_INCLUDE,
  type TransactionResponse,
  toResponse,
} from './transactions.service.js';
import { userSettings } from './user-settings.js';

type User = Pick<AuthenticatedUser, 'id'>;

/** Longest period a single query may cover (keeps queries cheap and synchronous). */
export const MAX_PERIOD_DAYS = 3_700;

export interface Totals {
  /** COMPLETED (realized). */
  completed: string;
  /** PENDING (scheduled, not realized). */
  pending: string;
  total: string;
}

export interface CurrencySummary {
  currency: string;
  incomes: Totals;
  expenses: Totals;
  investments: Totals;
  /** incomes − expenses − investments, realized only ("how much is left"). */
  balance: string;
  /** Same, including pending items. */
  projectedBalance: string;
  transactionCount: number;
  expensesByCategory: {
    categoryId: string | null;
    name: string | null;
    amount: string;
    /** Share of the currency's expenses, percent with 2 decimals ("28.40"). */
    share: string;
  }[];
}

export interface FinancialSummary {
  from: string;
  to: string;
  /** One block per currency: amounts in different currencies are never added together. */
  currencies: CurrencySummary[];
  largestExpenses: TransactionResponse[];
}

export interface PeriodSeries {
  type: 'INCOME' | 'EXPENSE' | 'INVESTMENT';
  from: string;
  to: string;
  groupBy: 'day' | 'month';
  series: { period: string; currency: string; amount: string; count: number }[];
}

export interface BillsResponse {
  today: string;
  items: TransactionResponse[];
  totals: { currency: string; amount: string; count: number }[];
}

const INCLUDE = TRANSACTION_INCLUDE;

/**
 * Deterministic aggregations over the user's own transactions. CANCELED items and
 * transfers (money moving between the user's own accounts) never count as income/expense.
 * Recurrences are materialized up to the end of the queried period first (on demand).
 */
@Injectable()
export class FinanceQueriesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RecurrenceMaterializer) private readonly recurrences: RecurrenceMaterializer,
  ) {}

  async summary(user: User, fromText: string, toText: string): Promise<FinancialSummary> {
    const { from, to } = period(fromText, toText);
    const settings = await userSettings(this.prisma, user.id);
    await this.recurrences.materialize(user, to, todayIn(settings.timeZone));
    const base = {
      ...ownedBy(user),
      occurredOn: { gte: from, lte: to },
      status: { in: ['COMPLETED' as const, 'PENDING' as const] },
    };

    const [byType, byCategory, largest] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['currency', 'type', 'status'],
        where: { ...base, type: { in: ['INCOME', 'EXPENSE', 'INVESTMENT'] } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['currency', 'categoryId'],
        where: { ...base, type: 'EXPENSE' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.findMany({
        where: { ...base, type: 'EXPENSE' },
        include: INCLUDE,
        orderBy: [{ amount: 'desc' }, { occurredOn: 'desc' }],
        take: 5,
      }),
    ]);

    const categories = await this.categoryTree(
      user,
      byCategory.map((group) => group.categoryId),
    );
    const currencies = [
      ...new Set([
        ...byType.map((group) => group.currency),
        ...byCategory.map((group) => group.currency),
      ]),
    ].sort();
    const today = todayIn(settings.timeZone);

    return {
      from: fromText,
      to: toText,
      currencies: currencies.map((currency) => {
        const totals = (type: TransactionType) => {
          const pick = (status: string) =>
            byType.find(
              (group) =>
                group.currency === currency &&
                group.type === type &&
                group.status === status,
            )?._sum.amount ?? ZERO;
          const completed = pick('COMPLETED');
          const pending = pick('PENDING');
          return { completed, pending, total: completed.plus(pending) };
        };
        const incomes = totals('INCOME');
        const expenses = totals('EXPENSE');
        const investments = totals('INVESTMENT');

        // Leaves roll up into their root category ("Combustível" counts in "Transporte").
        const rolled = new Map<string | null, Prisma.Decimal>();
        for (const group of byCategory.filter((item) => item.currency === currency)) {
          const root = group.categoryId
            ? (categories.get(group.categoryId)?.rootId ?? group.categoryId)
            : null;
          rolled.set(root, (rolled.get(root) ?? ZERO).plus(group._sum.amount ?? ZERO));
        }
        const totalExpenses = expenses.total;

        return {
          currency,
          incomes: format(incomes, currency),
          expenses: format(expenses, currency),
          investments: format(investments, currency),
          balance: moneyString(
            incomes.completed.minus(expenses.completed).minus(investments.completed),
            currency,
          ) as string,
          projectedBalance: moneyString(
            incomes.total.minus(expenses.total).minus(investments.total),
            currency,
          ) as string,
          transactionCount: byType
            .filter((group) => group.currency === currency)
            .reduce((count, group) => count + group._count._all, 0),
          expensesByCategory: [...rolled.entries()]
            .sort(([, a], [, b]) => b.comparedTo(a))
            .map(([categoryId, amount]) => {
              const node = categoryId ? categories.get(categoryId) : undefined;
              return {
                categoryId,
                name: node ? displayName(node.root, settings.locale) : null,
                amount: moneyString(amount, currency) as string,
                share: totalExpenses.isZero()
                  ? '0.00'
                  : amount.dividedBy(totalExpenses).times(100).toFixed(2),
              };
            }),
        };
      }),
      largestExpenses: largest.map((row) => toResponse(row, settings.locale, today)),
    };
  }

  /** Incomes, expenses or investments per day or month (database sums, folded with Decimal). */
  async byPeriod(
    user: User,
    type: 'INCOME' | 'EXPENSE' | 'INVESTMENT',
    fromText: string,
    toText: string,
    groupBy: 'day' | 'month' = 'month',
  ): Promise<PeriodSeries> {
    const { from, to } = period(fromText, toText);
    const settings = await userSettings(this.prisma, user.id);
    await this.recurrences.materialize(user, to, todayIn(settings.timeZone));
    const groups = await this.prisma.transaction.groupBy({
      by: ['occurredOn', 'currency'],
      where: {
        ...ownedBy(user),
        type,
        occurredOn: { gte: from, lte: to },
        status: { in: ['COMPLETED', 'PENDING'] },
      },
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: [{ occurredOn: 'asc' }],
    });

    const buckets = new Map<
      string,
      { period: string; currency: string; amount: Prisma.Decimal; count: number }
    >();
    for (const group of groups) {
      const day = formatCalendarDate(group.occurredOn);
      const key = groupBy === 'month' ? day.slice(0, 7) : day;
      const id = `${key}|${group.currency}`;
      const bucket = buckets.get(id) ?? {
        period: key,
        currency: group.currency,
        amount: ZERO,
        count: 0,
      };
      bucket.amount = bucket.amount.plus(group._sum.amount ?? ZERO);
      bucket.count += group._count._all;
      buckets.set(id, bucket);
    }

    return {
      type,
      from: fromText,
      to: toText,
      groupBy,
      series: [...buckets.values()]
        .sort(
          (a, b) =>
            a.period.localeCompare(b.period) || a.currency.localeCompare(b.currency),
        )
        .map((bucket) => ({
          ...bucket,
          amount: moneyString(bucket.amount, bucket.currency) as string,
        })),
    };
  }

  /** Pending expenses due from today to today + days − 1, in the user's time zone. */
  async upcomingBills(user: User, days = 7): Promise<BillsResponse> {
    const settings = await userSettings(this.prisma, user.id);
    const today = todayIn(settings.timeZone);
    await this.recurrences.materialize(user, addDays(today, days - 1), today);
    return this.bills(
      user,
      { gte: today, lte: addDays(today, days - 1) },
      today,
      settings.locale,
    );
  }

  /** Pending expenses whose due date is before today, in the user's time zone. */
  async overdueBills(user: User): Promise<BillsResponse> {
    const settings = await userSettings(this.prisma, user.id);
    const today = todayIn(settings.timeZone);
    await this.recurrences.materialize(user, today, today);
    return this.bills(user, { lt: today }, today, settings.locale);
  }

  private async bills(
    user: User,
    dueOn: Prisma.DateTimeFilter,
    today: Date,
    locale: Parameters<typeof toResponse>[1],
  ): Promise<BillsResponse> {
    const rows = await this.prisma.transaction.findMany({
      where: { ...ownedBy(user), type: 'EXPENSE', status: 'PENDING', dueOn },
      include: INCLUDE,
      orderBy: [{ dueOn: 'asc' }, { amount: 'desc' }],
      take: 200,
    });
    const totals = new Map<string, { amount: Prisma.Decimal; count: number }>();
    for (const row of rows) {
      const entry = totals.get(row.currency) ?? { amount: ZERO, count: 0 };
      entry.amount = entry.amount.plus(row.amount);
      entry.count += 1;
      totals.set(row.currency, entry);
    }
    return {
      today: formatCalendarDate(today),
      items: rows.map((row) => toResponse(row, locale, today)),
      totals: [...totals.entries()].map(([currency, entry]) => ({
        currency,
        amount: moneyString(entry.amount, currency) as string,
        count: entry.count,
      })),
    };
  }

  /** id → its root category (itself for top-level ones). */
  private async categoryTree(user: User, ids: (string | null)[]) {
    const wanted = ids.filter((id): id is string => id !== null);
    const rows = await this.prisma.category.findMany({
      where: { id: { in: wanted }, OR: [{ ownerId: null }, ownedBy(user)] },
      include: { parent: true },
    });
    const map = new Map<
      string,
      { rootId: string; root: Pick<Category, 'name' | 'systemKey'> }
    >();
    for (const row of rows) {
      const root = row.parent ?? row;
      map.set(row.id, { rootId: root.id, root });
      map.set(root.id, { rootId: root.id, root });
    }
    return map;
  }
}

function format(
  totals: { completed: Prisma.Decimal; pending: Prisma.Decimal; total: Prisma.Decimal },
  currency: string,
): Totals {
  return {
    completed: moneyString(totals.completed, currency) as string,
    pending: moneyString(totals.pending, currency) as string,
    total: moneyString(totals.total, currency) as string,
  };
}

function period(fromText: string, toText: string): { from: Date; to: Date } {
  const from = parseCalendarDate(fromText) as Date;
  const to = parseCalendarDate(toText) as Date;
  if (daysBetween(from, to) > MAX_PERIOD_DAYS) {
    throw ruleViolation(
      'period_too_long',
      'O período consultado é longo demais. Divida a consulta em partes menores.',
    );
  }
  return { from, to };
}
