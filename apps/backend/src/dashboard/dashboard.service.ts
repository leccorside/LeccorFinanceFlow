import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ownedBy } from '../common/security/ownership.js';
import { PrismaService } from '../database/prisma.service.js';
import { AccountsService } from '../finance/accounts.service.js';
import { addDays, daysBetween, formatCalendarDate, todayIn } from '../finance/dates.js';
import {
  type CurrencySummary,
  FinanceQueriesService,
  type FinancialSummary,
  type PeriodSeries,
} from '../finance/finance-queries.service.js';
import { ruleViolation } from '../finance/finance.schemas.js';
import { InvestmentsService } from '../finance/investments.service.js';
import { moneyString, ZERO } from '../finance/money.js';
import { RecurrenceMaterializer } from '../finance/recurrence-materializer.js';
import type { TransactionResponse } from '../finance/transactions.service.js';
import { userSettings } from '../finance/user-settings.js';
import { Prisma } from '../generated/prisma/client.js';
import { buildInsights, type Insight } from './insights.js';
import {
  bucketEnd,
  bucketsOf,
  MAX_DASHBOARD_DAYS,
  type PeriodKey,
  type ResolvedPeriod,
  resolvePeriod,
  type WeekStart,
} from './periods.js';

type User = Pick<AuthenticatedUser, 'id'>;
type Decimal = Prisma.Decimal;

/** Window of the "upcoming bills" card and insight. */
export const UPCOMING_DAYS = 7;
/** Bills listed in each block (the totals cover all of them). */
export const BILLS_LISTED = 5;

export interface DashboardQuery {
  period: PeriodKey;
  from?: Date | undefined;
  to?: Date | undefined;
}

interface Amounts {
  incomes: string;
  expenses: string;
  investments: string;
  /** incomes − expenses (completed + pending). */
  result: string;
}

export interface CurrencyDashboard {
  currency: string;
  cards: Amounts & {
    /** Of incomes and expenses, how much is still pending (scheduled). */
    pendingIncomes: string;
    pendingExpenses: string;
    /** Realized: completed incomes − completed expenses. */
    savings: string;
    /** savings ÷ completed incomes, percent with 1 decimal; null without incomes. */
    savingsRate: string | null;
    /** Sum of every account balance now (archived ones included), like GET /accounts. */
    accountsBalance: string;
    /** Invested amount now (cost basis), like GET /investments/summary. */
    invested: string;
    /** accountsBalance + invested. */
    netWorth: string;
    upcomingBills: { amount: string; count: number };
    overdueBills: { amount: string; count: number };
  };
  previous: Amounts;
  cashFlow: {
    period: string;
    incomes: string;
    expenses: string;
    investments: string;
    net: string;
  }[];
  /** Accounts + invested at the end of each bucket (completed movements only). */
  netWorth: { period: string; value: string }[];
  categories: CurrencySummary['expensesByCategory'];
  investments: {
    invested: string;
    byClass: { assetClass: string; invested: string; share: string }[];
  };
}

export interface DashboardResponse {
  period: {
    key: PeriodKey;
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
    groupBy: 'day' | 'month';
    today: string;
    timeZone: string;
    weekStartsOn: WeekStart;
  };
  /** The profile currency when it has data, else the first one. */
  primaryCurrency: string;
  currencies: CurrencyDashboard[];
  bills: {
    upcoming: TransactionResponse[];
    overdue: TransactionResponse[];
    upcomingTo: string;
  };
  insights: Insight[];
}

const date = formatCalendarDate;

/**
 * The dashboard is a view over the same queries as the rest of the API (summary, series,
 * bills, accounts, investments), so every number matches what those routes answer.
 * Amounts in different currencies are never added together.
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinanceQueriesService) private readonly queries: FinanceQueriesService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(InvestmentsService) private readonly investments: InvestmentsService,
    @Inject(RecurrenceMaterializer) private readonly recurrences: RecurrenceMaterializer,
  ) {}

  async overview(user: User, query: DashboardQuery): Promise<DashboardResponse> {
    const settings = await userSettings(this.prisma, user.id);
    const weekStartsOn = await this.weekStart(user);
    const today = todayIn(settings.timeZone);
    if (query.period === 'custom') {
      if (!query.from || !query.to) {
        throw ruleViolation(
          'period_dates_required',
          'Informe o início e o fim do período.',
        );
      }
      if (query.from > query.to) {
        throw ruleViolation('period_inverted', 'O início do período é depois do fim.');
      }
      if (daysBetween(query.from, query.to) > MAX_DASHBOARD_DAYS) {
        throw ruleViolation(
          'period_too_long',
          'O período é longo demais para o painel (máximo de 5 anos).',
        );
      }
    }
    const period = resolvePeriod(
      query.period,
      today,
      weekStartsOn,
      query.period === 'custom' && query.from && query.to
        ? { from: query.from, to: query.to }
        : undefined,
    );
    const upcomingTo = addDays(today, UPCOMING_DAYS - 1);
    const savingsFrom = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1),
    );

    // Materialize once, up to the farthest date any block reads; the parallel queries
    // below then find nothing left to create.
    const horizon = [period.to, upcomingTo].reduce((a, b) => (a > b ? a : b));
    await this.recurrences.materialize(user, horizon, today);

    const span = (from: Date, to: Date) => [date(from), date(to)] as const;
    const [
      current,
      previous,
      savings,
      incomes,
      expenses,
      investmentFlows,
      upcoming,
      overdue,
      accounts,
      positions,
      netWorth,
    ] = await Promise.all([
      this.queries.summary(user, ...span(period.from, period.to)),
      this.queries.summary(user, ...span(period.previousFrom, period.previousTo)),
      this.queries.summary(user, ...span(savingsFrom, today)),
      this.queries.byPeriod(
        user,
        'INCOME',
        ...span(period.from, period.to),
        period.groupBy,
      ),
      this.queries.byPeriod(
        user,
        'EXPENSE',
        ...span(period.from, period.to),
        period.groupBy,
      ),
      this.queries.byPeriod(
        user,
        'INVESTMENT',
        ...span(period.from, period.to),
        period.groupBy,
      ),
      this.queries.upcomingBills(user, UPCOMING_DAYS),
      this.queries.overdueBills(user),
      this.accounts.list(user, true),
      this.investments.summary(user),
      this.netWorthSeries(user, period, settings.timeZone),
    ]);

    const currencies = [
      ...new Set([
        ...current.currencies.map((item) => item.currency),
        ...previous.currencies.map((item) => item.currency),
        ...accounts.map((item) => item.currency),
        ...positions.currencies.map((item) => item.currency),
        ...upcoming.totals.map((item) => item.currency),
        ...overdue.totals.map((item) => item.currency),
      ]),
    ].sort();
    const buckets = bucketsOf(period.from, period.to, period.groupBy);

    const blocks = currencies.map((currency): CurrencyDashboard => {
      const money = (value: Decimal) => moneyString(value, currency) as string;
      const now = blockOf(current, currency);
      const before = blockOf(previous, currency);
      const completedIncomes = dec(now?.incomes.completed);
      const saved = completedIncomes.minus(dec(now?.expenses.completed));
      const accountsBalance = accounts
        .filter((account) => account.currency === currency)
        .reduce((sum, account) => sum.plus(account.balance), ZERO);
      const position = positions.currencies.find((item) => item.currency === currency);
      const invested = dec(position?.invested);
      const totalOf = (bills: { currency: string; amount: string; count: number }[]) => {
        const entry = bills.find((item) => item.currency === currency);
        return { amount: money(dec(entry?.amount)), count: entry?.count ?? 0 };
      };
      const series = (data: PeriodSeries) => {
        const map = new Map<string, Decimal>();
        for (const item of data.series) {
          if (item.currency === currency) map.set(item.period, dec(item.amount));
        }
        return map;
      };
      const inSeries = series(incomes);
      const outSeries = series(expenses);
      const investedSeries = series(investmentFlows);
      const worth = netWorth.get(currency);

      return {
        currency,
        cards: {
          ...amounts(now, currency),
          pendingIncomes: money(dec(now?.incomes.pending)),
          pendingExpenses: money(dec(now?.expenses.pending)),
          savings: money(saved),
          savingsRate: completedIncomes.greaterThan(0)
            ? saved.dividedBy(completedIncomes).times(100).toFixed(1)
            : null,
          accountsBalance: money(accountsBalance),
          invested: money(invested),
          netWorth: money(accountsBalance.plus(invested)),
          upcomingBills: totalOf(upcoming.totals),
          overdueBills: totalOf(overdue.totals),
        },
        previous: amounts(before, currency),
        cashFlow: buckets.map((bucket) => {
          const income = inSeries.get(bucket) ?? ZERO;
          const expense = outSeries.get(bucket) ?? ZERO;
          return {
            period: bucket,
            incomes: money(income),
            expenses: money(expense),
            investments: money(investedSeries.get(bucket) ?? ZERO),
            net: money(income.minus(expense)),
          };
        }),
        netWorth: buckets.map((bucket) => ({
          period: bucket,
          value: money(worth?.get(bucket) ?? ZERO),
        })),
        categories: now?.expensesByCategory ?? [],
        investments: {
          invested: money(invested),
          byClass: (position?.byClass ?? []).map((item) => ({
            assetClass: item.assetClass,
            invested: item.invested,
            share: item.share,
          })),
        },
      };
    });

    const insights = blocks.flatMap((block) => {
      const now = blockOf(current, block.currency);
      const before = blockOf(previous, block.currency);
      const realized = blockOf(savings, block.currency);
      return buildInsights({
        currency: block.currency,
        from: date(period.from),
        to: date(period.to),
        previousFrom: date(period.previousFrom),
        previousTo: date(period.previousTo),
        incomes: dec(now?.incomes.total),
        expenses: dec(now?.expenses.total),
        previousExpenses: dec(before?.expenses.total),
        categories: (now?.expensesByCategory ?? []).map((item) => ({
          key: item.categoryId ?? '',
          name: item.name,
          amount: dec(item.amount),
        })),
        previousCategories: (before?.expensesByCategory ?? []).map((item) => ({
          key: item.categoryId ?? '',
          amount: dec(item.amount),
        })),
        upcoming: {
          amount: dec(block.cards.upcomingBills.amount),
          count: block.cards.upcomingBills.count,
          days: UPCOMING_DAYS,
          from: date(today),
          to: date(upcomingTo),
        },
        overdue: {
          amount: dec(block.cards.overdueBills.amount),
          count: block.cards.overdueBills.count,
          today: date(today),
        },
        savings: {
          from: date(savingsFrom),
          to: date(today),
          incomes: dec(realized?.incomes.completed),
          expenses: dec(realized?.expenses.completed),
        },
      });
    });

    const primaryCurrency = currencies.includes(settings.currency)
      ? settings.currency
      : (currencies[0] ?? settings.currency);

    return {
      period: {
        key: period.key,
        from: date(period.from),
        to: date(period.to),
        previousFrom: date(period.previousFrom),
        previousTo: date(period.previousTo),
        groupBy: period.groupBy,
        today: date(today),
        timeZone: settings.timeZone,
        weekStartsOn,
      },
      primaryCurrency,
      currencies: blocks,
      bills: {
        upcoming: upcoming.items.slice(0, BILLS_LISTED),
        overdue: overdue.items.slice(0, BILLS_LISTED),
        upcomingTo: date(upcomingTo),
      },
      insights,
    };
  }

  /** Insights only (for the assistant): same numbers as the dashboard. */
  async insights(
    user: User,
    query: DashboardQuery,
  ): Promise<{
    period: DashboardResponse['period'];
    insights: Insight[];
  }> {
    const overview = await this.overview(user, query);
    return { period: overview.period, insights: overview.insights };
  }

  private async weekStart(user: User): Promise<WeekStart> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId: user.id },
      select: { preferences: true },
    });
    const value = (profile?.preferences as { weekStartsOn?: unknown } | null)
      ?.weekStartsOn;
    return value === 'sunday' ? 'sunday' : 'monday';
  }

  /**
   * Net worth at the end of each bucket, per currency: account opening balances + completed
   * account movements (same signs as the account balance) + investments' opening cost (from
   * the day they were registered) + completed contributions. Contributions moved money from
   * an account into an investment, so they do not change the total.
   */
  private async netWorthSeries(
    user: User,
    period: ResolvedPeriod,
    timeZone: string,
  ): Promise<Map<string, Map<string, Decimal>>> {
    const owner = ownedBy(user);
    const until = { lte: period.to };
    const [accounts, positions, outgoing, incoming, contributions] = await Promise.all([
      this.prisma.financialAccount.findMany({
        where: owner,
        select: { id: true, currency: true, initialBalance: true },
      }),
      this.prisma.investment.findMany({
        where: owner,
        select: { id: true, currency: true, totalCost: true, createdAt: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['accountId', 'type', 'occurredOn'],
        where: {
          ...owner,
          status: 'COMPLETED',
          accountId: { not: null },
          occurredOn: until,
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['transferAccountId', 'occurredOn'],
        where: {
          ...owner,
          status: 'COMPLETED',
          type: 'TRANSFER',
          transferAccountId: { not: null },
          occurredOn: until,
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['investmentId', 'occurredOn'],
        where: {
          ...owner,
          status: 'COMPLETED',
          type: 'INVESTMENT',
          investmentId: { not: null },
          occurredOn: until,
        },
        _sum: { amount: true },
      }),
    ]);

    const accountCurrency = new Map(accounts.map((row) => [row.id, row.currency]));
    const positionCurrency = new Map(positions.map((row) => [row.id, row.currency]));
    /** Dated changes per currency; undated (opening balances) count from the start. */
    const changes: { currency: string; on: Date | null; amount: Decimal }[] = [];
    for (const row of accounts) {
      changes.push({ currency: row.currency, on: null, amount: row.initialBalance });
    }
    for (const row of positions) {
      changes.push({
        currency: row.currency,
        on: todayIn(timeZone, row.createdAt),
        amount: row.totalCost,
      });
    }
    for (const group of outgoing) {
      const currency = group.accountId ? accountCurrency.get(group.accountId) : undefined;
      if (!currency) continue;
      const amount = group._sum.amount ?? ZERO;
      changes.push({
        currency,
        on: group.occurredOn,
        amount: group.type === 'INCOME' ? amount : amount.negated(),
      });
    }
    for (const group of incoming) {
      const currency = group.transferAccountId
        ? accountCurrency.get(group.transferAccountId)
        : undefined;
      if (currency) {
        changes.push({
          currency,
          on: group.occurredOn,
          amount: group._sum.amount ?? ZERO,
        });
      }
    }
    for (const group of contributions) {
      const currency = group.investmentId
        ? positionCurrency.get(group.investmentId)
        : undefined;
      if (currency) {
        changes.push({
          currency,
          on: group.occurredOn,
          amount: group._sum.amount ?? ZERO,
        });
      }
    }

    const buckets = bucketsOf(period.from, period.to, period.groupBy).map((bucket) => ({
      bucket,
      end: bucketEnd(bucket, period.to),
    }));
    const result = new Map<string, Map<string, Decimal>>();
    for (const currency of new Set(changes.map((change) => change.currency))) {
      const own = changes.filter((change) => change.currency === currency);
      const values = new Map<string, Decimal>();
      for (const { bucket, end } of buckets) {
        values.set(
          bucket,
          own
            .filter((change) => change.on === null || change.on <= end)
            .reduce((sum, change) => sum.plus(change.amount), ZERO),
        );
      }
      result.set(currency, values);
    }
    return result;
  }
}

function dec(value: string | Decimal | undefined | null): Decimal {
  return value === undefined || value === null ? ZERO : new Prisma.Decimal(value);
}

function blockOf(summary: FinancialSummary, currency: string) {
  return summary.currencies.find((item) => item.currency === currency);
}

function amounts(block: CurrencySummary | undefined, currency: string): Amounts {
  const incomes = dec(block?.incomes.total);
  const expenses = dec(block?.expenses.total);
  return {
    incomes: moneyString(incomes, currency) as string,
    expenses: moneyString(expenses, currency) as string,
    investments: moneyString(dec(block?.investments.total), currency) as string,
    result: moneyString(incomes.minus(expenses), currency) as string,
  };
}
