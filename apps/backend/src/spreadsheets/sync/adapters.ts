import { HttpException } from '@nestjs/common';
import type { z } from 'zod';
import type { PrismaService } from '../../database/prisma.service.js';
import { AccountsService } from '../../finance/accounts.service.js';
import { displayName } from '../../finance/categories.service.js';
import { formatCalendarDate } from '../../finance/dates.js';
import {
  ACCOUNT_TYPES,
  createAccountSchema,
  createInvestmentSchema,
  createTransactionSchema,
  INVESTMENT_CLASSES,
  PAYMENT_METHODS,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  updateAccountSchema,
  updateInvestmentSchema,
  updateTransactionSchema,
} from '../../finance/finance.schemas.js';
import { InvestmentsService } from '../../finance/investments.service.js';
import { currencyDigits } from '../../finance/money.js';
import { TransactionsService } from '../../finance/transactions.service.js';
import {
  type AppLocale,
  type Category,
  type FinancialAccount,
  Prisma,
  type SyncStatus,
} from '../../generated/prisma/client.js';
import type { LocaleTexts } from '../spreadsheet-template.js';
import {
  amountOf,
  calendarDateOf,
  dateTimeToSerial,
  dateToSerial,
  enumOf,
  fold,
  integerOf,
  isEmpty,
  RowError,
  type RowCells,
  tagsOf,
  textOf,
} from './cells.js';

export type DataTab = 'transactions' | 'accounts' | 'investments';

export interface SyncContext {
  user: { id: string };
  /** Spreadsheet language (lists, category names): fixed when it was created. */
  locale: AppLocale;
  texts: LocaleTexts;
  timeZone: string;
  accounts: FinancialAccount[];
  categories: (Pick<Category, 'id' | 'parentId' | 'kind' | 'ownerId'> & {
    name: string;
  })[];
}

export interface SyncRecord {
  id: string;
  version: number;
  syncStatus: SyncStatus;
}

export interface TabAdapter<R extends SyncRecord = SyncRecord> {
  tab: DataTab;
  /** Columns a person may change in the sheet: hashed, compared and imported. */
  editable: readonly string[];
  load(ctx: SyncContext): Promise<R[]>;
  /** Every template column except the technical ones. */
  render(record: R, ctx: SyncContext): RowCells;
  /** New row → new record, through the domain service (all rules apply). */
  create(ctx: SyncContext, cells: RowCells): Promise<{ id: string; version: number }>;
  /** Edited row → domain update with the record's version; null when nothing changed. */
  update(ctx: SyncContext, record: R, cells: RowCells): Promise<number | null>;
}

/** Runs a domain DTO schema; a failure names the first offending field. */
function validated<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RowError('invalid_value', String(issue?.path[0] ?? ''));
  }
  return parsed.data;
}

/** Domain/API error → row error with the same stable code. */
export function rowErrorOf(error: unknown): RowError | null {
  if (error instanceof RowError) return error;
  if (error instanceof HttpException) {
    const body = error.getResponse() as { code?: string };
    return new RowError(body.code ?? 'invalid_row');
  }
  return null;
}

const money = (value: Prisma.Decimal | null, currency: string): number | null =>
  value === null ? null : Number(value.toFixed(currencyDigits(currency)));
const date = (value: Date | null): number | null => (value ? dateToSerial(value) : null);

function findAccount(ctx: SyncContext, name: string, preferCard: boolean) {
  const matches = ctx.accounts.filter((account) => fold(account.name) === fold(name));
  if (matches.length === 0) throw new RowError('account_not_found', 'account');
  if (matches.length === 1) return matches[0] as FinancialAccount;
  const narrowed = matches.filter(
    (account) => (account.type === 'CREDIT_CARD') === preferCard,
  );
  if (narrowed.length !== 1) throw new RowError('account_ambiguous', 'account');
  return narrowed[0] as FinancialAccount;
}

function findCategory(ctx: SyncContext, root: string | null, leaf: string | null) {
  if (root === null) {
    if (leaf !== null) throw new RowError('category_not_found', 'category');
    return null;
  }
  const parent = ctx.categories.find(
    (category) => category.parentId === null && fold(category.name) === fold(root),
  );
  if (!parent) throw new RowError('category_not_found', 'category');
  if (leaf === null) return parent.id;
  const child = ctx.categories.find(
    (category) => category.parentId === parent.id && fold(category.name) === fold(leaf),
  );
  if (!child) throw new RowError('category_not_found', 'subcategory');
  return child.id;
}

// ─────────────────────────────── Transactions ───────────────────────────────

const TX_INCLUDE = {
  account: { select: { name: true, type: true, institution: true } },
  transferAccount: { select: { name: true } },
  category: { select: { name: true, systemKey: true, parent: true } },
  installment: { select: { installmentCount: true } },
  recurringTransaction: { select: { frequency: true } },
} as const;
type TxRow = Prisma.TransactionGetPayload<{ include: typeof TX_INCLUDE }>;

const FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM'] as const;

export class TransactionsAdapter implements TabAdapter<TxRow> {
  readonly tab = 'transactions' as const;
  readonly editable = [
    'type',
    'description',
    'category',
    'subcategory',
    'amount',
    'occurred_on',
    'due_on',
    'paid_on',
    'status',
    'payment_method',
    'account',
    'card',
    'notes',
    'tags',
  ] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  load(ctx: SyncContext): Promise<TxRow[]> {
    return this.prisma.transaction.findMany({
      where: { ownerId: ctx.user.id },
      include: TX_INCLUDE,
      orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }],
    });
  }

  render(row: TxRow, ctx: SyncContext): RowCells {
    const { lists } = ctx.texts;
    const leaf = row.category;
    const root = leaf?.parent ?? leaf;
    const isTransfer = row.type === 'TRANSFER';
    return {
      type: lists.transactionType[TRANSACTION_TYPES.indexOf(row.type)] ?? null,
      description: row.description,
      category: root ? displayName(root, ctx.locale) : null,
      subcategory: leaf?.parent ? displayName(leaf, ctx.locale) : null,
      amount: money(row.amount, row.currency),
      occurred_on: date(row.occurredOn),
      due_on: date(row.dueOn),
      paid_on: date(row.paidOn),
      status: lists.transactionStatus[TRANSACTION_STATUSES.indexOf(row.status)] ?? null,
      payment_method: row.paymentMethod
        ? (lists.paymentMethod[PAYMENT_METHODS.indexOf(row.paymentMethod)] ?? null)
        : null,
      account: isTransfer
        ? `${row.account?.name ?? ''} → ${row.transferAccount?.name ?? ''}`
        : (row.account?.name ?? null),
      bank: row.account?.institution ?? null,
      card: !isTransfer && row.account?.type === 'CREDIT_CARD' ? row.account.name : null,
      installment_number: row.installmentNumber,
      installment_total: row.installment?.installmentCount ?? null,
      recurring: lists.yesNo[row.recurringTransactionId ? 0 : 1] ?? null,
      frequency: row.recurringTransaction
        ? (lists.frequency[FREQUENCIES.indexOf(row.recurringTransaction.frequency)] ??
          null)
        : null,
      notes: row.notes,
      tags: row.tags.length > 0 ? row.tags.join(', ') : null,
      created_at: dateTimeToSerial(row.createdAt, ctx.timeZone),
      updated_at: dateTimeToSerial(row.updatedAt, ctx.timeZone),
    };
  }

  private parse(ctx: SyncContext, cells: RowCells) {
    const { lists } = ctx.texts;
    const type = enumOf(cells.type, lists.transactionType, TRANSACTION_TYPES, 'type');
    if (type === null) throw new RowError('required', 'type');
    const description = textOf(cells.description);
    if (description === null) throw new RowError('required', 'description');
    const amount = amountOf(cells.amount, 'amount');
    if (amount === null) throw new RowError('required', 'amount');
    const occurredOn = calendarDateOf(cells.occurred_on, 'occurred_on');
    if (occurredOn === null) throw new RowError('required', 'occurred_on');
    return {
      type,
      description,
      amount,
      occurredOn,
      dueOn: calendarDateOf(cells.due_on, 'due_on'),
      paidOn: calendarDateOf(cells.paid_on, 'paid_on'),
      status: enumOf(
        cells.status,
        lists.transactionStatus,
        TRANSACTION_STATUSES,
        'status',
      ),
      paymentMethod: enumOf(
        cells.payment_method,
        lists.paymentMethod,
        PAYMENT_METHODS,
        'payment_method',
      ),
      categoryId: findCategory(ctx, textOf(cells.category), textOf(cells.subcategory)),
      notes: textOf(cells.notes),
      tags: tagsOf(cells.tags),
    };
  }

  async create(ctx: SyncContext, cells: RowCells) {
    const parsed = this.parse(ctx, cells);
    if (parsed.type === 'TRANSFER') {
      // The sheet has no destination column: transfers are created in the app.
      throw new RowError('transfer_not_editable', 'type');
    }
    const account = textOf(cells.account);
    const input = validated(createTransactionSchema, {
      ...parsed,
      status: parsed.status ?? undefined,
      accountId: account ? findAccount(ctx, account, !isEmpty(cells.card)).id : null,
    });
    const created = await this.transactions.create(ctx.user, input);
    return { id: created.id, version: created.version };
  }

  async update(ctx: SyncContext, row: TxRow, cells: RowCells): Promise<number | null> {
    const parsed = this.parse(ctx, cells);
    const rendered = this.render(row, ctx);
    const patch: Record<string, unknown> = {};

    if (row.type === 'TRANSFER' || parsed.type === 'TRANSFER') {
      if (parsed.type !== row.type) throw new RowError('transfer_not_editable', 'type');
      if (fold(textOf(cells.account) ?? '') !== fold(String(rendered.account ?? ''))) {
        throw new RowError('transfer_not_editable', 'account');
      }
    } else {
      const name = textOf(cells.account);
      const accountId = name ? findAccount(ctx, name, !isEmpty(cells.card)).id : null;
      if (accountId !== row.accountId) patch.accountId = accountId;
      if (parsed.type !== row.type) patch.type = parsed.type;
    }

    if (parsed.description !== row.description) patch.description = parsed.description;
    if (parsed.categoryId !== row.categoryId) patch.categoryId = parsed.categoryId;
    if (!new Prisma.Decimal(parsed.amount).equals(row.amount))
      patch.amount = parsed.amount;
    if (parsed.occurredOn !== formatCalendarDate(row.occurredOn)) {
      patch.occurredOn = parsed.occurredOn;
    }
    const day = (value: Date | null) => (value ? formatCalendarDate(value) : null);
    if (parsed.dueOn !== day(row.dueOn)) patch.dueOn = parsed.dueOn;
    if (parsed.paidOn !== day(row.paidOn)) patch.paidOn = parsed.paidOn;
    if (parsed.status !== null && parsed.status !== row.status)
      patch.status = parsed.status;
    if (parsed.paymentMethod !== row.paymentMethod) {
      patch.paymentMethod = parsed.paymentMethod;
    }
    if (parsed.notes !== row.notes) patch.notes = parsed.notes;
    if (parsed.tags.join('\n') !== row.tags.join('\n')) patch.tags = parsed.tags;

    if (Object.keys(patch).length === 0) return null;
    const input = validated(updateTransactionSchema, { ...patch, version: row.version });
    return (await this.transactions.update(ctx.user, row.id, input)).version;
  }
}

// ───────────────────────────────── Accounts ─────────────────────────────────

export class AccountsAdapter implements TabAdapter<FinancialAccount> {
  readonly tab = 'accounts' as const;
  readonly editable = [
    'name',
    'account_type',
    'institution',
    'currency',
    'initial_balance',
    'credit_limit',
    'closing_day',
    'due_day',
  ] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
  ) {}

  load(ctx: SyncContext): Promise<FinancialAccount[]> {
    return this.prisma.financialAccount.findMany({
      where: { ownerId: ctx.user.id },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  render(row: FinancialAccount, ctx: SyncContext): RowCells {
    return {
      name: row.name,
      account_type: ctx.texts.lists.accountType[ACCOUNT_TYPES.indexOf(row.type)] ?? null,
      institution: row.institution,
      currency: row.currency,
      initial_balance: money(row.initialBalance, row.currency),
      credit_limit: money(row.creditLimit, row.currency),
      closing_day: row.closingDay,
      due_day: row.dueDay,
    };
  }

  private parse(ctx: SyncContext, cells: RowCells) {
    const type = enumOf(
      cells.account_type,
      ctx.texts.lists.accountType,
      ACCOUNT_TYPES,
      'account_type',
    );
    if (type === null) throw new RowError('required', 'account_type');
    const name = textOf(cells.name);
    if (name === null) throw new RowError('required', 'name');
    return {
      type,
      name,
      institution: textOf(cells.institution),
      currency: textOf(cells.currency)?.toUpperCase() ?? null,
      initialBalance: amountOf(cells.initial_balance, 'initial_balance'),
      creditLimit: amountOf(cells.credit_limit, 'credit_limit'),
      closingDay: integerOf(cells.closing_day, 'closing_day'),
      dueDay: integerOf(cells.due_day, 'due_day'),
    };
  }

  async create(ctx: SyncContext, cells: RowCells) {
    const parsed = this.parse(ctx, cells);
    const input = validated(createAccountSchema, {
      ...parsed,
      currency: parsed.currency ?? undefined,
      initialBalance: parsed.initialBalance ?? undefined,
    });
    const created = await this.accounts.create(ctx.user, input);
    return { id: created.id, version: created.version };
  }

  async update(
    ctx: SyncContext,
    row: FinancialAccount,
    cells: RowCells,
  ): Promise<number | null> {
    const parsed = this.parse(ctx, cells);
    // Type and currency are fixed after creation (transactions depend on them).
    if (parsed.type !== row.type)
      throw new RowError('field_not_editable', 'account_type');
    if (parsed.currency !== row.currency) {
      throw new RowError('field_not_editable', 'currency');
    }
    const patch: Record<string, unknown> = {};
    if (parsed.name !== row.name) patch.name = parsed.name;
    if (parsed.institution !== row.institution) patch.institution = parsed.institution;
    const differs = (text: string | null, value: Prisma.Decimal | null) =>
      text === null ? value !== null : value === null || !value.equals(text);
    if (differs(parsed.initialBalance, row.initialBalance)) {
      patch.initialBalance = parsed.initialBalance ?? '0';
    }
    if (differs(parsed.creditLimit, row.creditLimit))
      patch.creditLimit = parsed.creditLimit;
    if (parsed.closingDay !== row.closingDay) patch.closingDay = parsed.closingDay;
    if (parsed.dueDay !== row.dueDay) patch.dueDay = parsed.dueDay;

    if (Object.keys(patch).length === 0) return null;
    const input = validated(updateAccountSchema, { ...patch, version: row.version });
    return (await this.accounts.update(ctx.user, row.id, input)).version;
  }
}

// ──────────────────────────────── Investments ───────────────────────────────

type InvestmentRow = Prisma.InvestmentGetPayload<{
  include: { account: { select: { name: true } } };
}> & { invested: string };

export class InvestmentsAdapter implements TabAdapter<InvestmentRow> {
  readonly tab = 'investments' as const;
  /** Total cost (opening + contributions) and currency are derived/fixed: export only. */
  readonly editable = [
    'name',
    'asset_class',
    'symbol',
    'quantity',
    'account',
    'notes',
  ] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly investments: InvestmentsService,
  ) {}

  async load(ctx: SyncContext): Promise<InvestmentRow[]> {
    const [rows, positions] = await Promise.all([
      this.prisma.investment.findMany({
        where: { ownerId: ctx.user.id },
        include: { account: { select: { name: true } } },
        orderBy: [{ createdAt: 'asc' }],
      }),
      this.investments.list(ctx.user),
    ]);
    const invested = new Map(positions.map((item) => [item.id, item.invested]));
    return rows.map((row) => ({ ...row, invested: invested.get(row.id) ?? '0' }));
  }

  render(row: InvestmentRow, ctx: SyncContext): RowCells {
    return {
      name: row.name,
      asset_class:
        ctx.texts.lists.assetClass[INVESTMENT_CLASSES.indexOf(row.assetClass)] ?? null,
      symbol: row.symbol,
      quantity: Number(row.quantity.toFixed()),
      total_cost: Number(row.invested),
      currency: row.currency,
      account: row.account?.name ?? null,
      notes: row.notes,
    };
  }

  private parse(ctx: SyncContext, cells: RowCells) {
    const assetClass = enumOf(
      cells.asset_class,
      ctx.texts.lists.assetClass,
      INVESTMENT_CLASSES,
      'asset_class',
    );
    if (assetClass === null) throw new RowError('required', 'asset_class');
    const name = textOf(cells.name);
    if (name === null) throw new RowError('required', 'name');
    const account = textOf(cells.account);
    return {
      assetClass,
      name,
      symbol: textOf(cells.symbol),
      quantity: amountOf(cells.quantity, 'quantity'),
      accountId: account ? findAccount(ctx, account, false).id : null,
      notes: textOf(cells.notes),
    };
  }

  async create(ctx: SyncContext, cells: RowCells) {
    const parsed = this.parse(ctx, cells);
    const input = validated(createInvestmentSchema, {
      ...parsed,
      quantity: parsed.quantity ?? undefined,
      // On a new row the total cost is the opening position.
      totalCost: amountOf(cells.total_cost, 'total_cost') ?? undefined,
      currency: textOf(cells.currency)?.toUpperCase() ?? undefined,
    });
    const created = await this.investments.create(ctx.user, input);
    return { id: created.id, version: created.version };
  }

  async update(
    ctx: SyncContext,
    row: InvestmentRow,
    cells: RowCells,
  ): Promise<number | null> {
    const parsed = this.parse(ctx, cells);
    const patch: Record<string, unknown> = {};
    if (parsed.assetClass !== row.assetClass) patch.assetClass = parsed.assetClass;
    if (parsed.name !== row.name) patch.name = parsed.name;
    if ((parsed.symbol?.toUpperCase() ?? null) !== row.symbol)
      patch.symbol = parsed.symbol;
    if (parsed.quantity === null || !row.quantity.equals(parsed.quantity)) {
      patch.quantity = parsed.quantity ?? '0';
    }
    if (parsed.accountId !== row.accountId) patch.accountId = parsed.accountId;
    if (parsed.notes !== row.notes) patch.notes = parsed.notes;

    if (Object.keys(patch).length === 0) return null;
    const input = validated(updateInvestmentSchema, { ...patch, version: row.version });
    return (await this.investments.update(ctx.user, row.id, input)).version;
  }
}

/** Categories tab: generated by the app (system + own), never imported. */
export function categoryRows(ctx: SyncContext): { id: string; cells: RowCells }[] {
  const kinds = ['INCOME', 'EXPENSE', 'INVESTMENT', 'GENERAL'] as const;
  const label = (kind: (typeof kinds)[number]) =>
    ctx.texts.lists.categoryKind[kinds.indexOf(kind)] ?? null;
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, ctx.locale.replace('_', '-'));
  const roots = ctx.categories
    .filter((category) => category.parentId === null)
    .sort(
      (a, b) =>
        kinds.indexOf(a.kind as (typeof kinds)[number]) -
          kinds.indexOf(b.kind as (typeof kinds)[number]) || byName(a, b),
    );
  const rows: { id: string; cells: RowCells }[] = [];
  for (const root of roots) {
    rows.push({
      id: root.id,
      cells: { name: root.name, kind: label(root.kind), parent: null },
    });
    for (const child of ctx.categories
      .filter((category) => category.parentId === root.id)
      .sort(byName)) {
      rows.push({
        id: child.id,
        cells: { name: child.name, kind: label(child.kind), parent: root.name },
      });
    }
  }
  return rows;
}
