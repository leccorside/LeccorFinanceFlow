import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ApiException, ResourceNotFoundException } from '../common/errors/api-error.js';
import { ownedBy } from '../common/security/ownership.js';
import { defined } from '../common/validation/defined.js';
import { PrismaService } from '../database/prisma.service.js';
import { type FinancialAccount, Prisma } from '../generated/prisma/client.js';
import {
  ActionHistoryService,
  diffSnapshots,
  snapshotOf,
} from './action-history.service.js';
import {
  type CreateAccountInput,
  ruleViolation,
  type UpdateAccountInput,
} from './finance.schemas.js';
import { moneyString, parseMoney, ZERO } from './money.js';
import { userSettings } from './user-settings.js';

type User = Pick<AuthenticatedUser, 'id'>;

export interface AccountResponse {
  id: string;
  type: FinancialAccount['type'];
  name: string;
  institution: string | null;
  currency: string;
  initialBalance: string;
  creditLimit: string | null;
  closingDay: number | null;
  dueDay: number | null;
  lastFourDigits: string | null;
  isArchived: boolean;
  /** initialBalance + COMPLETED flows. Negative on a credit card = amount owed. */
  balance: string;
  /** Net of PENDING flows (not yet in the balance). */
  pendingNet: string;
  syncStatus: FinancialAccount['syncStatus'];
  version: number;
  createdAt: string;
  updatedAt: string;
}

const CARD_ONLY = ['creditLimit', 'closingDay', 'dueDay', 'lastFourDigits'] as const;

@Injectable()
export class AccountsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActionHistoryService) private readonly history: ActionHistoryService,
  ) {}

  async list(user: User, includeArchived = false): Promise<AccountResponse[]> {
    const rows = await this.prisma.financialAccount.findMany({
      where: { ...ownedBy(user), ...(includeArchived ? {} : { isArchived: false }) },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
    });
    const balances = await this.balances(
      user.id,
      rows.map((row) => row.id),
    );
    return rows.map((row) => toResponse(row, balances.get(row.id)));
  }

  async get(user: User, id: string): Promise<AccountResponse> {
    const row = await this.findOwned(user, id);
    return toResponse(row, (await this.balances(user.id, [id])).get(id));
  }

  /** Loads an account of the user or answers 404 (also used by other services). */
  async findOwned(user: User, id: string): Promise<FinancialAccount> {
    const row = await this.prisma.financialAccount.findFirst({
      where: { id, ...ownedBy(user) },
    });
    if (!row) throw new ResourceNotFoundException();
    return row;
  }

  async create(
    user: User,
    input: CreateAccountInput,
    context: { conversationId?: string } = {},
  ): Promise<AccountResponse> {
    const currency =
      input.currency ?? (await userSettings(this.prisma, user.id)).currency;
    this.validateCardFields(input, input.type);
    const data = {
      ...this.validateAmounts(input, input.type, currency),
      type: input.type,
      name: input.name,
      institution: input.institution ?? null,
      currency,
      closingDay: input.closingDay ?? null,
      dueDay: input.dueDay ?? null,
      lastFourDigits: input.lastFourDigits ?? null,
    };

    const row = await this.withUniqueName(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.financialAccount.create({
          data: { ...data, ownerId: user.id },
        });
        await this.history.record(tx, {
          ownerId: user.id,
          entityType: 'FINANCIAL_ACCOUNT',
          conversationId: context.conversationId ?? null,
          entityId: created.id,
          action: 'CREATE',
          after: snapshotOf(created),
        });
        return created;
      }),
    );
    return toResponse(row, undefined);
  }

  async update(
    user: User,
    id: string,
    input: UpdateAccountInput,
    context: { conversationId?: string } = {},
  ): Promise<AccountResponse> {
    const current = await this.findOwned(user, id);
    if (input.version !== undefined && input.version !== current.version) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'version_conflict',
        'A conta foi alterada por outra operação. Recarregue e tente de novo.',
      );
    }
    const { version: _version, ...fields } = input;
    void _version;
    this.validateCardFields(fields, current.type);
    const changes = defined({
      ...fields,
      ...this.validateAmounts(fields, current.type, current.currency),
    });

    const row = await this.withUniqueName(() =>
      this.prisma.$transaction(async (tx) => {
        const updated = await tx.financialAccount.update({
          where: { id, version: current.version },
          data: { ...changes, version: { increment: 1 }, syncStatus: 'PENDING_SYNC' },
        });
        const diff = diffSnapshots(snapshotOf(current), snapshotOf(updated));
        if (diff) {
          await this.history.record(tx, {
            ownerId: user.id,
            entityType: 'FINANCIAL_ACCOUNT',
            conversationId: context.conversationId ?? null,
            entityId: id,
            action: 'UPDATE',
            ...diff,
          });
        }
        return updated;
      }),
    ).catch(rethrowVersionConflict);
    return toResponse(row, (await this.balances(user.id, [id])).get(id));
  }

  /** Accounts referenced by transactions or plans cannot be deleted: archive them instead. */
  async delete(
    user: User,
    id: string,
    context: { conversationId?: string } = {},
  ): Promise<void> {
    const current = await this.findOwned(user, id);
    const usage = await Promise.all([
      this.prisma.transaction.count({
        where: { ...ownedBy(user), OR: [{ accountId: id }, { transferAccountId: id }] },
      }),
      this.prisma.investment.count({ where: { ...ownedBy(user), accountId: id } }),
      this.prisma.recurringTransaction.count({
        where: { ...ownedBy(user), accountId: id },
      }),
      this.prisma.installment.count({ where: { ...ownedBy(user), accountId: id } }),
    ]);
    if (usage.some((count) => count > 0)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'account_in_use',
        'A conta tem movimentações ou planos vinculados. Arquive-a em vez de excluir.',
        { transactions: usage[0] },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.financialAccount.delete({ where: { id } });
      await this.history.record(tx, {
        ownerId: user.id,
        entityType: 'FINANCIAL_ACCOUNT',
        conversationId: context.conversationId ?? null,
        entityId: id,
        action: 'DELETE',
        before: snapshotOf(current),
      });
    });
  }

  /** Balance (COMPLETED) and pending net per account, from exact database sums. */
  async balances(
    ownerId: string,
    accountIds: string[],
  ): Promise<
    Map<
      string,
      { balance: Prisma.Decimal; pending: Prisma.Decimal; initial?: Prisma.Decimal }
    >
  > {
    const result = new Map<
      string,
      { balance: Prisma.Decimal; pending: Prisma.Decimal }
    >();
    if (accountIds.length === 0) return result;
    for (const id of accountIds) result.set(id, { balance: ZERO, pending: ZERO });

    const [outgoing, incoming] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['accountId', 'type', 'status'],
        where: {
          ownerId,
          accountId: { in: accountIds },
          status: { in: ['COMPLETED', 'PENDING'] },
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['transferAccountId', 'status'],
        where: {
          ownerId,
          type: 'TRANSFER',
          transferAccountId: { in: accountIds },
          status: { in: ['COMPLETED', 'PENDING'] },
        },
        _sum: { amount: true },
      }),
    ]);

    const add = (accountId: string | null, status: string, amount: Prisma.Decimal) => {
      if (!accountId) return;
      const entry = result.get(accountId);
      if (!entry) return;
      if (status === 'COMPLETED') entry.balance = entry.balance.plus(amount);
      else entry.pending = entry.pending.plus(amount);
    };
    for (const group of outgoing) {
      const amount = group._sum.amount ?? ZERO;
      add(
        group.accountId,
        group.status,
        group.type === 'INCOME' ? amount : amount.negated(),
      );
    }
    for (const group of incoming) {
      add(group.transferAccountId, group.status, group._sum.amount ?? ZERO);
    }
    return result;
  }

  private validateAmounts(
    input: { initialBalance?: unknown; creditLimit?: unknown },
    type: FinancialAccount['type'],
    currency: string,
  ): { initialBalance?: Prisma.Decimal; creditLimit?: Prisma.Decimal | null } {
    const out: { initialBalance?: Prisma.Decimal; creditLimit?: Prisma.Decimal | null } =
      {};
    if (input.initialBalance !== undefined) {
      const parsed = parseMoney(input.initialBalance, currency, {
        allowZero: true,
        allowNegative: true,
      });
      if (!parsed.ok)
        throw ruleViolation(
          parsed.issue,
          'Saldo inicial inválido para a moeda da conta.',
          { field: 'initialBalance' },
        );
      out.initialBalance = parsed.value;
    }
    if (input.creditLimit !== undefined && input.creditLimit !== null) {
      if (type !== 'CREDIT_CARD') {
        throw ruleViolation(
          'card_fields_not_allowed',
          'Limite, fechamento e vencimento só existem em cartões de crédito.',
        );
      }
      const parsed = parseMoney(input.creditLimit, currency, { allowZero: true });
      if (!parsed.ok)
        throw ruleViolation(parsed.issue, 'Limite inválido para a moeda da conta.', {
          field: 'creditLimit',
        });
      out.creditLimit = parsed.value;
    } else if (input.creditLimit === null) {
      out.creditLimit = null;
    }
    return out;
  }

  /** Throws when card-only fields are set on a non-card account (validation only). */
  private validateCardFields(
    input: Partial<Record<(typeof CARD_ONLY)[number], unknown>>,
    type: FinancialAccount['type'],
  ): void {
    if (type !== 'CREDIT_CARD') {
      const used = CARD_ONLY.filter(
        (field) => input[field] !== undefined && input[field] !== null,
      );
      if (used.length > 0) {
        throw ruleViolation(
          'card_fields_not_allowed',
          'Limite, fechamento e vencimento só existem em cartões de crédito.',
          { fields: used },
        );
      }
    }
  }

  private async withUniqueName<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'account_name_taken',
          'Já existe uma conta desse tipo com esse nome.',
        );
      }
      throw error;
    }
  }
}

/** `update where version` found nothing: someone else changed the row in between. */
export function rethrowVersionConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    throw new ApiException(
      HttpStatus.CONFLICT,
      'version_conflict',
      'O registro foi alterado por outra operação. Recarregue e tente de novo.',
    );
  }
  throw error;
}

function toResponse(
  row: FinancialAccount,
  flows: { balance: Prisma.Decimal; pending: Prisma.Decimal } | undefined,
): AccountResponse {
  const currency = row.currency;
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    institution: row.institution,
    currency,
    initialBalance: moneyString(row.initialBalance, currency) as string,
    creditLimit: moneyString(row.creditLimit, currency),
    closingDay: row.closingDay,
    dueDay: row.dueDay,
    lastFourDigits: row.lastFourDigits,
    isArchived: row.isArchived,
    balance: moneyString(
      row.initialBalance.plus(flows?.balance ?? ZERO),
      currency,
    ) as string,
    pendingNet: moneyString(flows?.pending ?? ZERO, currency) as string,
    syncStatus: row.syncStatus,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
