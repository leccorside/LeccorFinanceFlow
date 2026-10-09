import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ApiException, ResourceNotFoundException } from '../common/errors/api-error.js';
import { ownedBy } from '../common/security/ownership.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  type AppLocale,
  type Category,
  type FinancialAccount,
  type PaymentMethod,
  Prisma,
  type Transaction,
  type TransactionStatus,
  type TransactionType,
} from '../generated/prisma/client.js';
import { AccountsService, rethrowVersionConflict } from './accounts.service.js';
import {
  ActionHistoryService,
  diffSnapshots,
  snapshotOf,
} from './action-history.service.js';
import { CategoriesService, displayName, KINDS_FOR_TYPE } from './categories.service.js';
import { formatCalendarDate, parseCalendarDate, todayIn } from './dates.js';
import {
  type CreateTransactionInput,
  ruleViolation,
  type SearchTransactionsInput,
  type UpdateTransactionInput,
} from './finance.schemas.js';
import { moneyString, parseMoney } from './money.js';
import { userSettings } from './user-settings.js';

type User = Pick<AuthenticatedUser, 'id'>;

const WITH_RELATIONS = {
  account: { select: { id: true, name: true } },
  transferAccount: { select: { id: true, name: true } },
  category: {
    select: {
      id: true,
      name: true,
      systemKey: true,
      parent: { select: { id: true, name: true, systemKey: true } },
    },
  },
} as const;

type TransactionRow = Prisma.TransactionGetPayload<{ include: typeof WITH_RELATIONS }>;

export interface TransactionResponse {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  description: string;
  amount: string;
  currency: string;
  occurredOn: string;
  dueOn: string | null;
  paidOn: string | null;
  /** PENDING with a due date before today in the user's time zone. */
  isOverdue: boolean;
  paymentMethod: PaymentMethod | null;
  account: { id: string; name: string } | null;
  transferAccount: { id: string; name: string } | null;
  /** Leaf category; `parent` is the "Categoria" when the leaf is a "Subcategoria". */
  category: {
    id: string;
    name: string;
    parent: { id: string; name: string } | null;
  } | null;
  notes: string | null;
  tags: string[];
  syncStatus: Transaction['syncStatus'];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SearchResult {
  items: TransactionResponse[];
  total: number;
  limit: number;
  offset: number;
}

/** Fully resolved, validated values ready to be stored. */
interface Resolved {
  type: TransactionType;
  status: TransactionStatus;
  description: string;
  amount: Prisma.Decimal;
  currency: string;
  occurredOn: Date;
  dueOn: Date | null;
  paidOn: Date | null;
  paymentMethod: PaymentMethod | null;
  accountId: string | null;
  transferAccountId: string | null;
  categoryId: string | null;
  notes: string | null;
  tags: string[];
}

@Injectable()
export class TransactionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(CategoriesService) private readonly categories: CategoriesService,
    @Inject(ActionHistoryService) private readonly history: ActionHistoryService,
  ) {}

  async get(user: User, id: string): Promise<TransactionResponse> {
    const settings = await userSettings(this.prisma, user.id);
    const row = await this.prisma.transaction.findFirst({
      where: { id, ...ownedBy(user) },
      include: WITH_RELATIONS,
    });
    if (!row) throw new ResourceNotFoundException();
    return toResponse(row, settings.locale, todayIn(settings.timeZone));
  }

  async create(
    user: User,
    input: CreateTransactionInput,
    context: { conversationId?: string } = {},
  ): Promise<TransactionResponse> {
    const settings = await userSettings(this.prisma, user.id);
    const resolved = await this.resolve(user, null, input, settings.currency);
    const spreadsheet = await this.prisma.spreadsheet.findFirst({
      where: { ...ownedBy(user), isActive: true, status: 'ACTIVE' },
      select: { id: true },
    });

    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          ...resolved,
          ownerId: user.id,
          spreadsheetId: spreadsheet?.id ?? null,
          syncStatus: 'PENDING_SYNC',
        },
      });
      await this.history.record(tx, {
        ownerId: user.id,
        entityType: 'TRANSACTION',
        entityId: created.id,
        action: 'CREATE',
        after: snapshotOf(created),
        conversationId: context.conversationId ?? null,
      });
      return created.id;
    });
    return this.get(user, id);
  }

  async update(
    user: User,
    id: string,
    input: UpdateTransactionInput,
    context: { conversationId?: string } = {},
  ): Promise<TransactionResponse> {
    const settings = await userSettings(this.prisma, user.id);
    const current = await this.prisma.transaction.findFirst({
      where: { id, ...ownedBy(user) },
    });
    if (!current) throw new ResourceNotFoundException();
    if (input.version !== undefined && input.version !== current.version) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'version_conflict',
        'A movimentação foi alterada por outra operação. Recarregue e tente de novo.',
      );
    }
    const { version: _version, ...changes } = input;
    void _version;
    const resolved = await this.resolve(user, current, changes, settings.currency);

    await this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.transaction.update({
          where: { id, version: current.version },
          data: {
            ...resolved,
            version: { increment: 1 },
            syncStatus: 'PENDING_SYNC',
            syncError: null,
          },
        });
        const diff = diffSnapshots(snapshotOf(current), snapshotOf(updated));
        if (diff) {
          await this.history.record(tx, {
            ownerId: user.id,
            entityType: 'TRANSACTION',
            entityId: id,
            action: 'UPDATE',
            ...diff,
            conversationId: context.conversationId ?? null,
          });
        }
      })
      .catch(rethrowVersionConflict);
    return this.get(user, id);
  }

  async delete(
    user: User,
    id: string,
    context: { conversationId?: string } = {},
  ): Promise<void> {
    const current = await this.prisma.transaction.findFirst({
      where: { id, ...ownedBy(user) },
    });
    if (!current) throw new ResourceNotFoundException();
    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.delete({ where: { id } });
      // Full snapshot: enough to restore it (undo, PASSO 15).
      await this.history.record(tx, {
        ownerId: user.id,
        entityType: 'TRANSACTION',
        entityId: id,
        action: 'DELETE',
        before: snapshotOf(current),
        conversationId: context.conversationId ?? null,
      });
    });
  }

  async search(user: User, filter: SearchTransactionsInput): Promise<SearchResult> {
    const settings = await userSettings(this.prisma, user.id);
    const today = todayIn(settings.timeZone);
    const where: Prisma.TransactionWhereInput = { ...ownedBy(user) };
    const and: Prisma.TransactionWhereInput[] = [];

    if (filter.from || filter.to) {
      where.occurredOn = {
        ...(filter.from ? { gte: parseCalendarDate(filter.from) as Date } : {}),
        ...(filter.to ? { lte: parseCalendarDate(filter.to) as Date } : {}),
      };
    }
    if (filter.type) where.type = { in: filter.type };
    if (filter.status) where.status = { in: filter.status };
    if (filter.accountId) {
      await this.accounts.findOwned(user, filter.accountId); // 404 for a foreign id
      and.push({
        OR: [{ accountId: filter.accountId }, { transferAccountId: filter.accountId }],
      });
    }
    if (filter.categoryId) {
      await this.categories.findUsable(user, filter.categoryId);
      const children = await this.prisma.category.findMany({
        where: { parentId: filter.categoryId, OR: [{ ownerId: null }, ownedBy(user)] },
        select: { id: true },
      });
      where.categoryId = {
        in: [filter.categoryId, ...children.map((child) => child.id)],
      };
    }
    if (filter.q) {
      and.push({
        OR: [
          { description: { contains: filter.q, mode: 'insensitive' } },
          { notes: { contains: filter.q, mode: 'insensitive' } },
        ],
      });
    }
    if (filter.minAmount || filter.maxAmount) {
      where.amount = {
        ...(filter.minAmount ? { gte: new Prisma.Decimal(filter.minAmount) } : {}),
        ...(filter.maxAmount ? { lte: new Prisma.Decimal(filter.maxAmount) } : {}),
      };
    }
    if (filter.overdue === 'true') {
      and.push({ status: 'PENDING', dueOn: { lt: today } });
    }
    if (and.length > 0) where.AND = and;

    const orderBy: Prisma.TransactionOrderByWithRelationInput[] = {
      date_desc: [{ occurredOn: 'desc' as const }, { createdAt: 'desc' as const }],
      date_asc: [{ occurredOn: 'asc' as const }, { createdAt: 'asc' as const }],
      amount_desc: [{ amount: 'desc' as const }, { occurredOn: 'desc' as const }],
      amount_asc: [{ amount: 'asc' as const }, { occurredOn: 'desc' as const }],
    }[filter.sort ?? 'date_desc'];
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const [rows, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: WITH_RELATIONS,
        orderBy,
        take: limit,
        skip: offset,
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return {
      items: rows.map((row) => toResponse(row, settings.locale, today)),
      total,
      limit,
      offset,
    };
  }

  /**
   * Single place where every rule is applied, for creates (current = null) and partial
   * updates (current + changes). Deterministic: never trusts the caller's interpretation.
   */
  private async resolve(
    user: User,
    current: Transaction | null,
    changes: Partial<Omit<UpdateTransactionInput, 'version'>> | CreateTransactionInput,
    defaultCurrency: string,
  ): Promise<Resolved> {
    const has = (key: keyof typeof changes) => changes[key] !== undefined;
    const type = (changes.type ?? current?.type) as TransactionType;

    // References: accounts and category must belong to the user (404 otherwise).
    const accountId = has('accountId')
      ? (changes.accountId ?? null)
      : (current?.accountId ?? null);
    let transferAccountId = has('transferAccountId')
      ? (changes.transferAccountId ?? null)
      : (current?.transferAccountId ?? null);
    if (
      type !== 'TRANSFER' &&
      !has('transferAccountId') &&
      current?.type === 'TRANSFER'
    ) {
      transferAccountId = null; // type changed away from transfer: drop the destination
    }
    const categoryId = has('categoryId')
      ? (changes.categoryId ?? null)
      : (current?.categoryId ?? null);

    const account = accountId ? await this.accounts.findOwned(user, accountId) : null;
    const transferAccount = transferAccountId
      ? await this.accounts.findOwned(user, transferAccountId)
      : null;
    const category = categoryId
      ? await this.categories.findUsable(user, categoryId)
      : null;

    const newlyReferenced = (key: 'accountId' | 'transferAccountId' | 'categoryId') =>
      has(key) && changes[key] !== null && changes[key] !== current?.[key];
    if (
      (account?.isArchived && newlyReferenced('accountId')) ||
      (transferAccount?.isArchived && newlyReferenced('transferAccountId'))
    ) {
      throw ruleViolation(
        'account_archived',
        'A conta está arquivada e não aceita novas movimentações.',
      );
    }
    if (category?.isArchived && newlyReferenced('categoryId')) {
      throw ruleViolation('category_archived', 'A categoria está arquivada.');
    }

    // Transfers.
    if (type === 'TRANSFER') {
      if (!account || !transferAccount) {
        throw ruleViolation(
          'transfer_requires_accounts',
          'Transferências precisam da conta de origem e da conta de destino.',
        );
      }
      if (account.id === transferAccount.id) {
        throw ruleViolation(
          'transfer_same_account',
          'A conta de origem e a de destino precisam ser diferentes.',
        );
      }
      if (category) {
        throw ruleViolation(
          'transfer_category_not_allowed',
          'Transferências entre contas não têm categoria.',
        );
      }
    } else if (transferAccount) {
      throw ruleViolation(
        'transfer_account_not_allowed',
        'Conta de destino só existe em transferências.',
      );
    }

    // Category must fit the type (income category on an income, …).
    if (category && !KINDS_FOR_TYPE[type].includes(category.kind)) {
      throw ruleViolation(
        'category_kind_mismatch',
        'A categoria não combina com o tipo da movimentação.',
        {
          type,
          categoryKind: category.kind,
        },
      );
    }

    // Currency: the account's; no implicit conversion between currencies.
    const currency = this.resolveCurrency(
      changes.currency ?? (account ? undefined : current?.currency),
      account,
      transferAccount,
      defaultCurrency,
    );

    // Amount, validated against the currency's decimals (re-checked if the currency changes).
    const rawAmount = has('amount') ? changes.amount : current?.amount.toString();
    const parsed = parseMoney(rawAmount, currency);
    if (!parsed.ok) {
      throw ruleViolation(parsed.issue, messageFor(parsed.issue, currency), {
        field: 'amount',
        currency,
      });
    }

    // Dates and status.
    const occurredOn = has('occurredOn')
      ? (parseCalendarDate(changes.occurredOn as string) as Date)
      : (current?.occurredOn as Date);
    const dueOn = has('dueOn')
      ? changes.dueOn
        ? parseCalendarDate(changes.dueOn)
        : null
      : (current?.dueOn ?? null);
    const status: TransactionStatus =
      changes.status ?? current?.status ?? (dueOn ? 'PENDING' : 'COMPLETED');
    let paidOn = has('paidOn')
      ? changes.paidOn
        ? parseCalendarDate(changes.paidOn)
        : null
      : (current?.paidOn ?? null);

    if (status === 'COMPLETED') {
      paidOn ??= occurredOn; // "paid/received" without a date: on the occurrence date
    } else if (paidOn) {
      if (has('paidOn') && changes.paidOn) {
        throw ruleViolation(
          'paid_on_requires_completed',
          'Data de pagamento só existe em movimentações concluídas.',
        );
      }
      paidOn = null; // status moved away from COMPLETED: the payment date no longer applies
    }

    // Payment method: an expense on a credit card account is a card payment by default.
    let paymentMethod = has('paymentMethod')
      ? (changes.paymentMethod ?? null)
      : (current?.paymentMethod ?? null);
    if (
      !current &&
      !has('paymentMethod') &&
      account?.type === 'CREDIT_CARD' &&
      type === 'EXPENSE'
    ) {
      paymentMethod = 'CREDIT_CARD';
    }

    return {
      type,
      status,
      description: (changes.description ?? current?.description) as string,
      amount: parsed.value,
      currency,
      occurredOn,
      dueOn,
      paidOn,
      paymentMethod,
      accountId: account?.id ?? null,
      transferAccountId: transferAccount?.id ?? null,
      categoryId: category?.id ?? null,
      notes: has('notes') ? (changes.notes ?? null) : (current?.notes ?? null),
      tags: changes.tags ?? current?.tags ?? [],
    };
  }

  private resolveCurrency(
    requested: string | undefined,
    account: FinancialAccount | null,
    transferAccount: FinancialAccount | null,
    defaultCurrency: string,
  ): string {
    if (account && transferAccount && account.currency !== transferAccount.currency) {
      throw ruleViolation(
        'currency_mismatch',
        'As contas da transferência usam moedas diferentes; conversão não é suportada.',
        {
          from: account.currency,
          to: transferAccount.currency,
        },
      );
    }
    if (account) {
      if (requested && requested !== account.currency) {
        throw ruleViolation(
          'currency_mismatch',
          'A moeda informada é diferente da moeda da conta.',
          {
            requested,
            account: account.currency,
          },
        );
      }
      return account.currency;
    }
    return requested ?? defaultCurrency;
  }
}

function messageFor(issue: string, currency: string): string {
  if (issue === 'too_many_decimals')
    return `Valor com mais casas decimais do que ${currency} permite.`;
  if (issue === 'amount_not_positive') return 'O valor precisa ser maior que zero.';
  return 'Valor inválido.';
}

type CategoryRef = Pick<Category, 'id' | 'name' | 'systemKey'>;

export function toResponse(
  row: TransactionRow,
  locale: AppLocale,
  today: Date,
): TransactionResponse {
  const category = row.category as (CategoryRef & { parent: CategoryRef | null }) | null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    description: row.description,
    amount: moneyString(row.amount, row.currency) as string,
    currency: row.currency,
    occurredOn: formatCalendarDate(row.occurredOn),
    dueOn: row.dueOn ? formatCalendarDate(row.dueOn) : null,
    paidOn: row.paidOn ? formatCalendarDate(row.paidOn) : null,
    isOverdue:
      row.status === 'PENDING' &&
      row.dueOn !== null &&
      row.dueOn.getTime() < today.getTime(),
    paymentMethod: row.paymentMethod,
    account: row.account,
    transferAccount: row.transferAccount,
    category: category
      ? {
          id: category.id,
          name: displayName(category, locale),
          parent: category.parent
            ? { id: category.parent.id, name: displayName(category.parent, locale) }
            : null,
        }
      : null,
    notes: row.notes,
    tags: row.tags,
    syncStatus: row.syncStatus,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
