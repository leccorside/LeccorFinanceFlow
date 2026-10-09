import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ownedBy } from '../common/security/ownership.js';
import { bucketsOf } from '../dashboard/periods.js';
import { PrismaService } from '../database/prisma.service.js';
import { type AccountResponse, AccountsService } from '../finance/accounts.service.js';
import { daysBetween, formatCalendarDate, todayIn } from '../finance/dates.js';
import {
  type CurrencySummary,
  FinanceQueriesService,
  type FinancialSummary,
} from '../finance/finance-queries.service.js';
import { InvestmentsService } from '../finance/investments.service.js';
import { moneyString, ZERO } from '../finance/money.js';
import {
  TRANSACTION_INCLUDE,
  type TransactionResponse,
  toResponse,
} from '../finance/transactions.service.js';
import { userSettings } from '../finance/user-settings.js';
import { Prisma } from '../generated/prisma/client.js';
import { formatBucket, formatDate } from './report-format.js';
import { bcp47, type ReportText, reportText, titleOf } from './report-i18n.js';
import type { Cell, ReportDocument, ReportTypeName, Section } from './report.types.js';

type User = Pick<AuthenticatedUser, 'id' | 'email'>;
type Decimal = Prisma.Decimal;

/** Up to this many days the cash flow is daily; above, monthly. */
const DAILY_UP_TO_DAYS = 62;
/** Bars beyond this are grouped (keeps charts readable). */
const MAX_BARS = 12;

const dec = (value: string | undefined | null): Decimal => new Prisma.Decimal(value ?? 0);

interface Context {
  user: User;
  type: ReportTypeName;
  from: Date;
  to: Date;
  fromText: string;
  toText: string;
  locale: string;
  t: ReportText;
  summary: FinancialSummary;
  rows: TransactionResponse[];
  multiCurrency: boolean;
}

/**
 * Builds the report document from the same queries as the dashboard and the assistant
 * (summary, series, accounts, investments, transactions of the period), so the totals
 * of a report match what the app shows. Amounts in different currencies never mix.
 */
@Injectable()
export class ReportBuilder {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinanceQueriesService) private readonly queries: FinanceQueriesService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(InvestmentsService) private readonly investments: InvestmentsService,
  ) {}

  /** Movements (non-canceled) in the period: the volume a report has to list. */
  countMovements(user: User, from: Date, to: Date): Promise<number> {
    return this.prisma.transaction.count({
      where: {
        ...ownedBy(user),
        occurredOn: { gte: from, lte: to },
        status: { in: ['COMPLETED', 'PENDING'] },
      },
    });
  }

  async build(
    user: User,
    type: ReportTypeName,
    from: Date,
    to: Date,
  ): Promise<ReportDocument> {
    const settings = await userSettings(this.prisma, user.id);
    const locale = bcp47(settings.locale);
    const t = reportText(settings.locale);
    const fromText = formatCalendarDate(from);
    const toText = formatCalendarDate(to);
    // The summary also materializes recurrences up to the end of the period.
    const summary = await this.queries.summary(user, fromText, toText);
    const today = todayIn(settings.timeZone);
    const rows = (
      await this.prisma.transaction.findMany({
        where: {
          ...ownedBy(user),
          occurredOn: { gte: from, lte: to },
          status: { in: ['COMPLETED', 'PENDING'] },
        },
        include: TRANSACTION_INCLUDE,
        orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }],
      })
    ).map((row) => toResponse(row, settings.locale, today));

    const profile = await this.prisma.userProfile.findUnique({
      where: { userId: user.id },
      select: { firstName: true, lastName: true },
    });
    const owner =
      [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || user.email;

    const ctx: Context = {
      user,
      type,
      from,
      to,
      fromText,
      toText,
      locale,
      t,
      summary,
      rows,
      multiCurrency: false,
    };
    const sections = await this.sections(ctx);

    return {
      title: titleOf(settings.locale, type),
      period: t('period', {
        from: formatDate(fromText, locale, 'long'),
        to: formatDate(toText, locale, 'long'),
      }),
      owner,
      generatedAt: t('generated', {
        date: new Intl.DateTimeFormat(locale, {
          dateStyle: 'long',
          timeStyle: 'short',
          timeZone: settings.timeZone,
        }).format(new Date()),
      }),
      locale,
      sections,
      note: t('note'),
    };
  }

  private async sections(ctx: Context): Promise<Section[]> {
    const accounts = ['ACCOUNTS', 'CONSOLIDATED'].includes(ctx.type)
      ? await this.accounts.list(ctx.user, true)
      : [];
    const positions = ['INVESTMENTS', 'CONSOLIDATED'].includes(ctx.type)
      ? await this.investments.list(ctx.user)
      : [];
    const currencies = [
      ...new Set([
        ...ctx.summary.currencies.map((item) => item.currency),
        ...accounts.map((item) => item.currency),
        ...positions.map((item) => item.currency),
      ]),
    ].sort();
    ctx.multiCurrency = currencies.length > 1;

    const out: Section[] = [];
    for (const currency of currencies) {
      const block = ctx.summary.currencies.find((item) => item.currency === currency);
      switch (ctx.type) {
        case 'MONTHLY':
          out.push(
            this.kpis(ctx, currency, block),
            this.categoryBars(ctx, currency, block),
            this.categoryTable(ctx, currency, block),
            await this.cashFlow(ctx, currency),
            this.transactions(ctx, currency, null),
          );
          break;
        case 'ANNUAL': {
          const flow = await this.cashFlow(ctx, currency);
          out.push(
            this.kpis(ctx, currency, block),
            flow,
            this.netBars(ctx, currency, flow),
            this.categoryTable(ctx, currency, block),
            this.incomeCategoryTable(ctx, currency),
            this.largestExpenses(ctx, currency),
          );
          break;
        }
        case 'INCOME':
          out.push(
            this.typeKpis(ctx, currency, 'INCOME'),
            this.incomeCategoryBars(ctx, currency),
            this.incomeCategoryTable(ctx, currency),
            this.transactions(ctx, currency, 'INCOME'),
          );
          break;
        case 'EXPENSES':
          out.push(
            this.typeKpis(ctx, currency, 'EXPENSE'),
            this.categoryBars(ctx, currency, block),
            this.categoryTable(ctx, currency, block),
            this.largestExpenses(ctx, currency),
            this.transactions(ctx, currency, 'EXPENSE'),
          );
          break;
        case 'CATEGORIES':
          out.push(
            this.categoryBars(ctx, currency, block),
            this.categoryTable(ctx, currency, block),
            this.incomeCategoryTable(ctx, currency),
          );
          break;
        case 'INVESTMENTS':
          out.push(...(await this.investmentSections(ctx, currency, positions)));
          break;
        case 'ACCOUNTS':
          out.push(...this.accountSections(ctx, currency, accounts));
          break;
        case 'CASH_FLOW': {
          const flow = await this.cashFlow(ctx, currency);
          out.push(
            this.kpis(ctx, currency, block),
            flow,
            this.netBars(ctx, currency, flow),
          );
          break;
        }
        case 'CONSOLIDATED':
          out.push(
            this.kpis(ctx, currency, block),
            this.categoryBars(ctx, currency, block),
            this.categoryTable(ctx, currency, block),
            this.incomeCategoryTable(ctx, currency),
            await this.cashFlow(ctx, currency),
            ...this.accountSections(ctx, currency, accounts),
            ...(await this.investmentSections(ctx, currency, positions)),
            this.transactions(ctx, currency, null),
          );
          break;
      }
    }
    if (out.length === 0) {
      out.push({
        kind: 'kpis',
        title: ctx.t('summary'),
        items: [
          { label: ctx.t('movements'), value: { count: 0 }, hint: ctx.t('noData') },
        ],
      });
    }
    return out;
  }

  // ─────────────────────────── Sections ───────────────────────────

  private title(ctx: Context, key: string, currency: string): string {
    return ctx.multiCurrency ? `${ctx.t(key)} (${currency})` : ctx.t(key);
  }

  private money(value: Decimal | string, currency: string): Cell {
    return {
      money: moneyString(
        typeof value === 'string' ? dec(value) : value,
        currency,
      ) as string,
      currency,
    };
  }

  private kpis(
    ctx: Context,
    currency: string,
    block: CurrencySummary | undefined,
  ): Section {
    const t = ctx.t;
    const pending = (value: string | undefined) =>
      dec(value).isZero()
        ? undefined
        : t('pending', { amount: formatMoneyHint(value ?? '0', currency, ctx.locale) });
    return {
      kind: 'kpis',
      title: this.title(ctx, 'summary', currency),
      items: [
        {
          label: t('incomes'),
          value: this.money(block?.incomes.total ?? '0', currency),
          ...hint(pending(block?.incomes.pending)),
        },
        {
          label: t('expenses'),
          value: this.money(block?.expenses.total ?? '0', currency),
          ...hint(pending(block?.expenses.pending)),
        },
        {
          label: t('investments'),
          value: this.money(block?.investments.total ?? '0', currency),
        },
        { label: t('balance'), value: this.money(block?.balance ?? '0', currency) },
        {
          label: t('projected'),
          value: this.money(block?.projectedBalance ?? '0', currency),
        },
        { label: t('movements'), value: { count: block?.transactionCount ?? 0 } },
      ],
    };
  }

  private typeKpis(ctx: Context, currency: string, type: 'INCOME' | 'EXPENSE'): Section {
    const own = ctx.rows.filter((row) => row.currency === currency && row.type === type);
    const completed = sumOf(own.filter((row) => row.status === 'COMPLETED'));
    const pending = sumOf(own.filter((row) => row.status === 'PENDING'));
    const t = ctx.t;
    return {
      kind: 'kpis',
      title: this.title(ctx, 'summary', currency),
      items: [
        {
          label: t('total'),
          value: this.money(completed.plus(pending), currency),
        },
        { label: t('status.COMPLETED'), value: this.money(completed, currency) },
        { label: t('status.PENDING'), value: this.money(pending, currency) },
        { label: t('movements'), value: { count: own.length } },
      ],
    };
  }

  private categoryBars(
    ctx: Context,
    currency: string,
    block: CurrencySummary | undefined,
  ): Section {
    return {
      kind: 'bars',
      title: this.title(ctx, 'categoriesExpenses', currency),
      currency,
      items: grouped(
        (block?.expensesByCategory ?? []).map((item) => ({
          label: item.name ?? ctx.t('uncategorized'),
          value: item.amount,
        })),
        ctx.t('class.OTHER'),
        currency,
      ),
      empty: ctx.t('noData'),
    };
  }

  private categoryTable(
    ctx: Context,
    currency: string,
    block: CurrencySummary | undefined,
  ): Section {
    const items = block?.expensesByCategory ?? [];
    return {
      kind: 'table',
      title: this.title(ctx, 'categoriesExpenses', currency),
      columns: [
        { header: ctx.t('category'), align: 'left', width: 40 },
        { header: ctx.t('amount'), align: 'right', width: 18 },
        { header: ctx.t('share'), align: 'right', width: 14 },
      ],
      rows: items.map((item) => [
        item.name ?? ctx.t('uncategorized'),
        this.money(item.amount, currency),
        { percent: item.share },
      ]),
      ...(items.length > 0
        ? {
            totals: [
              ctx.t('total'),
              this.money(block?.expenses.total ?? '0', currency),
              { percent: '100' },
            ],
          }
        : {}),
      empty: ctx.t('noData'),
    };
  }

  /** Incomes grouped by root category (from the period's movements). */
  private incomeCategories(ctx: Context, currency: string) {
    const totals = new Map<string, Decimal>();
    for (const row of ctx.rows) {
      if (row.currency !== currency || row.type !== 'INCOME') continue;
      const name =
        row.category?.parent?.name ?? row.category?.name ?? ctx.t('uncategorized');
      totals.set(name, (totals.get(name) ?? ZERO).plus(row.amount));
    }
    const total = [...totals.values()].reduce((sum, value) => sum.plus(value), ZERO);
    return {
      total,
      items: [...totals.entries()]
        .sort(([, a], [, b]) => b.comparedTo(a))
        .map(([name, amount]) => ({
          name,
          amount,
          share: total.isZero() ? '0.00' : amount.dividedBy(total).times(100).toFixed(2),
        })),
    };
  }

  private incomeCategoryBars(ctx: Context, currency: string): Section {
    const { items } = this.incomeCategories(ctx, currency);
    return {
      kind: 'bars',
      title: this.title(ctx, 'categoriesIncomes', currency),
      currency,
      items: grouped(
        items.map((item) => ({
          label: item.name,
          value: moneyString(item.amount, currency) as string,
        })),
        ctx.t('class.OTHER'),
        currency,
      ),
      empty: ctx.t('noData'),
    };
  }

  private incomeCategoryTable(ctx: Context, currency: string): Section {
    const { items, total } = this.incomeCategories(ctx, currency);
    return {
      kind: 'table',
      title: this.title(ctx, 'categoriesIncomes', currency),
      columns: [
        { header: ctx.t('category'), align: 'left', width: 40 },
        { header: ctx.t('amount'), align: 'right', width: 18 },
        { header: ctx.t('share'), align: 'right', width: 14 },
      ],
      rows: items.map((item) => [
        item.name,
        this.money(item.amount, currency),
        { percent: item.share },
      ]),
      ...(items.length > 0
        ? { totals: [ctx.t('total'), this.money(total, currency), { percent: '100' }] }
        : {}),
      empty: ctx.t('noData'),
    };
  }

  private async cashFlow(
    ctx: Context,
    currency: string,
  ): Promise<Extract<Section, { kind: 'table' }>> {
    const groupBy = daysBetween(ctx.from, ctx.to) <= DAILY_UP_TO_DAYS ? 'day' : 'month';
    const series_ = (type: 'INCOME' | 'EXPENSE' | 'INVESTMENT') =>
      this.queries.byPeriod(ctx.user, type, ctx.fromText, ctx.toText, groupBy);
    const [incomes, expenses, investments] = await Promise.all([
      series_('INCOME'),
      series_('EXPENSE'),
      series_('INVESTMENT'),
    ]);
    const series = (data: typeof incomes) =>
      new Map(
        data.series
          .filter((item) => item.currency === currency)
          .map((item) => [item.period, dec(item.amount)]),
      );
    const inMap = series(incomes);
    const outMap = series(expenses);
    const invMap = series(investments);
    let accumulated = ZERO;
    let totalIn = ZERO;
    let totalOut = ZERO;
    let totalInv = ZERO;
    const rows = bucketsOf(ctx.from, ctx.to, groupBy)
      .map((bucket) => {
        const income = inMap.get(bucket) ?? ZERO;
        const expense = outMap.get(bucket) ?? ZERO;
        const invested = invMap.get(bucket) ?? ZERO;
        const net = income.minus(expense);
        accumulated = accumulated.plus(net);
        totalIn = totalIn.plus(income);
        totalOut = totalOut.plus(expense);
        totalInv = totalInv.plus(invested);
        return { bucket, income, expense, invested, net, accumulated };
      })
      // Daily reports list only days with movements (a month of zeros says nothing).
      .filter(
        (row) =>
          groupBy === 'month' ||
          !(row.income.isZero() && row.expense.isZero() && row.invested.isZero()),
      );
    return {
      kind: 'table',
      title: this.title(ctx, 'cashFlow', currency),
      columns: [
        { header: ctx.t('period_'), align: 'left', width: 16 },
        { header: ctx.t('incomes'), align: 'right', width: 16 },
        { header: ctx.t('expenses'), align: 'right', width: 16 },
        { header: ctx.t('investments'), align: 'right', width: 16 },
        { header: ctx.t('net'), align: 'right', width: 16 },
        { header: ctx.t('accumulated'), align: 'right', width: 16 },
      ],
      rows: rows.map((row) => [
        formatBucket(row.bucket, ctx.locale),
        this.money(row.income, currency),
        this.money(row.expense, currency),
        this.money(row.invested, currency),
        this.money(row.net, currency),
        this.money(row.accumulated, currency),
      ]),
      ...(rows.length > 0
        ? {
            totals: [
              ctx.t('total'),
              this.money(totalIn, currency),
              this.money(totalOut, currency),
              this.money(totalInv, currency),
              this.money(totalIn.minus(totalOut), currency),
              '',
            ],
          }
        : {}),
      empty: ctx.t('noData'),
    };
  }

  private netBars(
    ctx: Context,
    currency: string,
    flow: Extract<Section, { kind: 'table' }>,
  ): Section {
    return {
      kind: 'bars',
      title: this.title(ctx, 'netByPeriod', currency),
      currency,
      items: flow.rows.slice(-24).map((row) => ({
        label: row[0] as string,
        value: (row[4] as { money: string }).money,
      })),
      empty: ctx.t('noData'),
    };
  }

  private largestExpenses(ctx: Context, currency: string): Section {
    const rows = ctx.summary.largestExpenses.filter((row) => row.currency === currency);
    return {
      kind: 'table',
      title: this.title(ctx, 'largestExpenses', currency),
      columns: [
        { header: ctx.t('date'), align: 'left', width: 13 },
        { header: ctx.t('description'), align: 'left', width: 34 },
        { header: ctx.t('category'), align: 'left', width: 20 },
        { header: ctx.t('amount'), align: 'right', width: 16 },
      ],
      rows: rows.map((row) => [
        { date: row.occurredOn },
        row.description,
        row.category?.name ?? ctx.t('uncategorized'),
        this.money(row.amount, currency),
      ]),
      empty: ctx.t('noData'),
    };
  }

  private transactions(
    ctx: Context,
    currency: string,
    type: 'INCOME' | 'EXPENSE' | null,
  ): Section {
    const rows = ctx.rows.filter(
      (row) => row.currency === currency && (type === null || row.type === type),
    );
    // Mixed listings show money going out as negative (transfers stay neutral).
    const shown = (row: TransactionResponse) =>
      type === null && (row.type === 'EXPENSE' || row.type === 'INVESTMENT')
        ? `-${row.amount}`
        : row.amount;
    return {
      kind: 'table',
      title: this.title(ctx, 'transactions', currency),
      columns: [
        { header: ctx.t('date'), align: 'left', width: 12 },
        { header: ctx.t('description'), align: 'left', width: 30 },
        { header: ctx.t('category'), align: 'left', width: 18 },
        { header: ctx.t('account'), align: 'left', width: 16 },
        ...(type === null
          ? [{ header: ctx.t('type'), align: 'left' as const, width: 13 }]
          : []),
        { header: ctx.t('status'), align: 'left', width: 12 },
        { header: ctx.t('amount'), align: 'right', width: 15 },
      ],
      rows: rows.map((row) => [
        { date: row.occurredOn },
        row.description,
        row.category?.name ?? '',
        row.account?.name ?? '',
        ...(type === null ? [ctx.t(`tx.${row.type}`)] : []),
        ctx.t(`status.${row.status}`),
        this.money(shown(row), currency),
      ]),
      ...(type !== null && rows.length > 0
        ? {
            totals: [ctx.t('total'), '', '', '', '', this.money(sumOf(rows), currency)],
          }
        : {}),
      empty: ctx.t('noData'),
    };
  }

  private accountSections(
    ctx: Context,
    currency: string,
    accounts: AccountResponse[],
  ): Section[] {
    const own = accounts.filter((account) => account.currency === currency);
    if (own.length === 0) return [];
    const flows = new Map<string, { in: Decimal; out: Decimal }>();
    const flow = (id: string) => {
      const entry = flows.get(id) ?? { in: ZERO, out: ZERO };
      flows.set(id, entry);
      return entry;
    };
    for (const row of ctx.rows) {
      const amount = dec(row.amount);
      if (row.account) {
        const entry = flow(row.account.id);
        if (row.type === 'INCOME') entry.in = entry.in.plus(amount);
        else entry.out = entry.out.plus(amount);
      }
      if (row.type === 'TRANSFER' && row.transferAccount) {
        const entry = flow(row.transferAccount.id);
        entry.in = entry.in.plus(amount);
      }
    }
    const total = own.reduce((sum, account) => sum.plus(account.balance), ZERO);
    return [
      {
        kind: 'table',
        title: this.title(ctx, 'accounts', currency),
        columns: [
          { header: ctx.t('name'), align: 'left', width: 24 },
          { header: ctx.t('type'), align: 'left', width: 16 },
          { header: ctx.t('institution'), align: 'left', width: 16 },
          { header: ctx.t('accountBalance'), align: 'right', width: 16 },
          { header: ctx.t('pendingNet'), align: 'right', width: 14 },
          { header: ctx.t('inflow'), align: 'right', width: 16 },
          { header: ctx.t('outflow'), align: 'right', width: 16 },
        ],
        rows: own.map((account) => [
          account.isArchived ? `${account.name} *` : account.name,
          ctx.t(`acct.${account.type}`),
          account.institution ?? '',
          this.money(account.balance, currency),
          this.money(account.pendingNet, currency),
          this.money(flows.get(account.id)?.in ?? ZERO, currency),
          this.money(flows.get(account.id)?.out ?? ZERO, currency),
        ]),
        totals: [ctx.t('total'), '', '', this.money(total, currency), '', '', ''],
        empty: ctx.t('noData'),
      },
    ];
  }

  private async investmentSections(
    ctx: Context,
    currency: string,
    positions: Awaited<ReturnType<InvestmentsService['list']>>,
  ): Promise<Section[]> {
    const own = positions.filter((item) => item.currency === currency);
    const contributions = ctx.rows.filter(
      (row) => row.currency === currency && row.type === 'INVESTMENT',
    );
    if (own.length === 0 && contributions.length === 0) return [];
    const summary = (await this.investments.summary(ctx.user)).currencies.find(
      (item) => item.currency === currency,
    );
    const invested = dec(summary?.invested);
    return [
      {
        kind: 'kpis',
        title: this.title(ctx, 'investments', currency),
        items: [
          { label: ctx.t('investedTotal'), value: this.money(invested, currency) },
          { label: ctx.t('positionsCount'), value: { count: own.length } },
          {
            label: ctx.t('contributions'),
            value: this.money(sumOf(contributions), currency),
          },
        ],
      },
      {
        kind: 'bars',
        title: this.title(ctx, 'byClass', currency),
        currency,
        items: (summary?.byClass ?? []).map((item) => ({
          label: ctx.t(`class.${item.assetClass}`),
          value: item.invested,
        })),
        empty: ctx.t('noData'),
      },
      {
        kind: 'table',
        title: this.title(ctx, 'positions', currency),
        columns: [
          { header: ctx.t('name'), align: 'left', width: 28 },
          { header: ctx.t('class'), align: 'left', width: 20 },
          { header: ctx.t('account'), align: 'left', width: 18 },
          { header: ctx.t('invested'), align: 'right', width: 18 },
          { header: ctx.t('share'), align: 'right', width: 12 },
        ],
        rows: own.map((item) => [
          item.symbol ? `${item.name} (${item.symbol})` : item.name,
          ctx.t(`class.${item.assetClass}`),
          item.account?.name ?? '',
          this.money(item.invested, currency),
          {
            percent: invested.isZero()
              ? '0'
              : dec(item.invested).dividedBy(invested).times(100).toFixed(2),
          },
        ]),
        ...(own.length > 0
          ? {
              totals: [
                ctx.t('total'),
                '',
                '',
                this.money(invested, currency),
                { percent: '100' },
              ],
            }
          : {}),
        empty: ctx.t('noData'),
      },
      {
        kind: 'table',
        title: this.title(ctx, 'contributions', currency),
        columns: [
          { header: ctx.t('date'), align: 'left', width: 14 },
          { header: ctx.t('description'), align: 'left', width: 36 },
          { header: ctx.t('status'), align: 'left', width: 14 },
          { header: ctx.t('amount'), align: 'right', width: 18 },
        ],
        rows: contributions.map((row) => [
          { date: row.occurredOn },
          row.description,
          ctx.t(`status.${row.status}`),
          this.money(row.amount, currency),
        ]),
        ...(contributions.length > 0
          ? {
              totals: [
                ctx.t('total'),
                '',
                '',
                this.money(sumOf(contributions), currency),
              ],
            }
          : {}),
        empty: ctx.t('noData'),
      },
    ];
  }
}

function sumOf(rows: { amount: string }[]): Decimal {
  return rows.reduce((sum, row) => sum.plus(row.amount), ZERO);
}

function hint(value: string | undefined): { hint?: string } {
  return value ? { hint: value } : {};
}

function formatMoneyHint(amount: string, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amount as unknown as number,
  );
}

/** Keeps the largest bars and folds the rest into one "Others" bar (exact sum). */
function grouped(
  items: { label: string; value: string }[],
  others: string,
  currency: string,
): { label: string; value: string }[] {
  if (items.length <= MAX_BARS) return items;
  const head = items.slice(0, MAX_BARS - 1);
  const rest = items
    .slice(MAX_BARS - 1)
    .reduce((sum, item) => sum.plus(item.value), new Prisma.Decimal(0));
  return [...head, { label: others, value: moneyString(rest, currency) as string }];
}
