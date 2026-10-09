import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ApiException, ResourceNotFoundException } from '../common/errors/api-error.js';
import { ownedBy } from '../common/security/ownership.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  type FinancialAccount,
  type Investment,
  type InvestmentClass,
  Prisma,
} from '../generated/prisma/client.js';
import { AccountsService, rethrowVersionConflict } from './accounts.service.js';
import {
  ActionHistoryService,
  diffSnapshots,
  snapshotOf,
} from './action-history.service.js';
import { formatCalendarDate, todayIn } from './dates.js';
import {
  type ContributionInput,
  type CreateInvestmentInput,
  ruleViolation,
  type UpdateInvestmentInput,
} from './finance.schemas.js';
import { moneyString, parseMoney, ZERO } from './money.js';
import {
  TRANSACTION_INCLUDE,
  type TransactionResponse,
  TransactionsService,
  toResponse as transactionResponse,
} from './transactions.service.js';
import { userSettings } from './user-settings.js';

type User = Pick<AuthenticatedUser, 'id'>;

const INCLUDE = { account: { select: { id: true, name: true } } } as const;
type Row = Prisma.InvestmentGetPayload<{ include: typeof INCLUDE }>;

export interface InvestmentResponse {
  id: string;
  assetClass: InvestmentClass;
  name: string;
  symbol: string | null;
  account: { id: string; name: string } | null;
  currency: string;
  /** Units held, as declared by the user (no market prices). */
  quantity: string;
  /** Cost of the position held before the contributions registered here. */
  openingCost: string;
  /** Sum of COMPLETED contributions. */
  contributed: string;
  /** Sum of PENDING contributions (scheduled). */
  pendingContributions: string;
  /** openingCost + contributed: the amount invested (cost basis, not market value). */
  invested: string;
  contributionCount: number;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvestmentDetail extends InvestmentResponse {
  contributions: TransactionResponse[];
}

export interface InvestmentSummary {
  /** One block per currency: never added across currencies. */
  currencies: {
    currency: string;
    invested: string;
    positions: number;
    byClass: {
      assetClass: InvestmentClass;
      invested: string;
      share: string;
      positions: number;
    }[];
  }[];
}

interface Flows {
  contributed: Prisma.Decimal;
  pending: Prisma.Decimal;
  count: number;
}

/**
 * Investment positions by class (stocks, REITs, ETFs, crypto, treasury, CDB, LCI/LCA, funds,
 * pension, other). Contributions are INVESTMENT transactions linked to the position, so the
 * invested amount always comes from exact database sums. Cost basis only: no quotes, no
 * returns and never a promise of returns.
 */
@Injectable()
export class InvestmentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(TransactionsService) private readonly transactions: TransactionsService,
    @Inject(ActionHistoryService) private readonly history: ActionHistoryService,
  ) {}

  async list(user: User, assetClass?: InvestmentClass): Promise<InvestmentResponse[]> {
    const rows = await this.prisma.investment.findMany({
      where: { ...ownedBy(user), ...(assetClass ? { assetClass } : {}) },
      include: INCLUDE,
      orderBy: [{ assetClass: 'asc' }, { name: 'asc' }],
    });
    const flows = await this.flows(
      user,
      rows.map((row) => row.id),
    );
    return rows.map((row) => toResponse(row, flows.get(row.id)));
  }

  async get(user: User, id: string): Promise<InvestmentDetail> {
    const settings = await userSettings(this.prisma, user.id);
    const row = await this.findOwned(user, id);
    const [flows, contributions] = await Promise.all([
      this.flows(user, [id]),
      this.prisma.transaction.findMany({
        where: { ...ownedBy(user), investmentId: id },
        include: TRANSACTION_INCLUDE,
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      }),
    ]);
    const today = todayIn(settings.timeZone);
    return {
      ...toResponse(row, flows.get(id)),
      contributions: contributions.map((item) =>
        transactionResponse(item, settings.locale, today),
      ),
    };
  }

  /** Invested amount per currency and class, with each class's share. */
  async summary(user: User): Promise<InvestmentSummary> {
    const positions = await this.list(user);
    const currencies = [...new Set(positions.map((item) => item.currency))].sort();
    return {
      currencies: currencies.map((currency) => {
        const own = positions.filter((item) => item.currency === currency);
        const total = own.reduce(
          (sum, item) => sum.plus(item.invested),
          new Prisma.Decimal(0),
        );
        const classes = new Map<
          InvestmentClass,
          { invested: Prisma.Decimal; positions: number }
        >();
        for (const item of own) {
          const entry = classes.get(item.assetClass) ?? { invested: ZERO, positions: 0 };
          entry.invested = entry.invested.plus(item.invested);
          entry.positions += 1;
          classes.set(item.assetClass, entry);
        }
        return {
          currency,
          invested: moneyString(total, currency) as string,
          positions: own.length,
          byClass: [...classes.entries()]
            .sort(([, a], [, b]) => b.invested.comparedTo(a.invested))
            .map(([assetClass, entry]) => ({
              assetClass,
              invested: moneyString(entry.invested, currency) as string,
              share: total.isZero()
                ? '0.00'
                : entry.invested.dividedBy(total).times(100).toFixed(2),
              positions: entry.positions,
            })),
        };
      }),
    };
  }

  async create(
    user: User,
    input: CreateInvestmentInput,
    context: { conversationId?: string } = {},
  ): Promise<InvestmentResponse> {
    const account = input.accountId
      ? await this.usableAccount(user, input.accountId)
      : null;
    if (account && input.currency && input.currency !== account.currency) {
      throw ruleViolation(
        'currency_mismatch',
        'A moeda informada é diferente da moeda da conta.',
        { requested: input.currency, account: account.currency },
      );
    }
    const currency =
      account?.currency ??
      input.currency ??
      (await userSettings(this.prisma, user.id)).currency;

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.investment.create({
        data: {
          ownerId: user.id,
          assetClass: input.assetClass,
          name: input.name,
          symbol: input.symbol ?? null,
          accountId: account?.id ?? null,
          currency,
          quantity: new Prisma.Decimal(input.quantity ?? '0'),
          totalCost: this.cost(input.totalCost ?? '0', currency),
          notes: input.notes ?? null,
        },
      });
      await this.history.record(tx, {
        ownerId: user.id,
        entityType: 'INVESTMENT',
        entityId: row.id,
        action: 'CREATE',
        after: snapshotOf(row),
        conversationId: context.conversationId ?? null,
      });
      return row;
    });
    return this.getSummary(user, created.id);
  }

  async update(
    user: User,
    id: string,
    input: UpdateInvestmentInput,
    context: { conversationId?: string } = {},
  ): Promise<InvestmentResponse> {
    const current = await this.findOwned(user, id);
    if (input.version !== undefined && input.version !== current.version) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'version_conflict',
        'O investimento foi alterado por outra operação. Recarregue e tente de novo.',
      );
    }
    if (input.accountId && input.accountId !== current.accountId) {
      const account = await this.usableAccount(user, input.accountId);
      if (account.currency !== current.currency) {
        throw ruleViolation(
          'currency_mismatch',
          'A conta usa outra moeda; a moeda do investimento não muda.',
          { investment: current.currency, account: account.currency },
        );
      }
    }

    const data: Prisma.InvestmentUpdateInput = {
      ...(input.assetClass !== undefined ? { assetClass: input.assetClass } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.symbol !== undefined ? { symbol: input.symbol } : {}),
      ...(input.accountId !== undefined
        ? {
            account: input.accountId
              ? { connect: { id: input.accountId } }
              : { disconnect: true },
          }
        : {}),
      ...(input.quantity !== undefined
        ? { quantity: new Prisma.Decimal(input.quantity) }
        : {}),
      ...(input.totalCost !== undefined
        ? { totalCost: this.cost(input.totalCost, current.currency) }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };

    await this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.investment.update({
          where: { id, version: current.version },
          data: { ...data, version: { increment: 1 }, syncStatus: 'PENDING_SYNC' },
        });
        const diff = diffSnapshots(snapshotOf(current), snapshotOf(updated));
        if (diff) {
          await this.history.record(tx, {
            ownerId: user.id,
            entityType: 'INVESTMENT',
            entityId: id,
            action: 'UPDATE',
            ...diff,
            conversationId: context.conversationId ?? null,
          });
        }
      })
      .catch(rethrowVersionConflict);
    return this.getSummary(user, id);
  }

  /** Positions with contributions cannot be deleted (their history would be orphaned). */
  async delete(
    user: User,
    id: string,
    context: { conversationId?: string } = {},
  ): Promise<void> {
    const current = await this.findOwned(user, id);
    const contributions = await this.prisma.transaction.count({
      where: { ...ownedBy(user), investmentId: id },
    });
    if (contributions > 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'investment_in_use',
        'O investimento tem aportes registrados. Exclua os aportes antes.',
        { contributions },
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.investment.delete({ where: { id } });
      await this.history.record(tx, {
        ownerId: user.id,
        entityType: 'INVESTMENT',
        entityId: id,
        action: 'DELETE',
        before: snapshotOf(current),
        conversationId: context.conversationId ?? null,
      });
    });
  }

  /**
   * "Investi R$ 1.000 em Bitcoin hoje": an INVESTMENT transaction linked to the position
   * (paid today by default) and, when units are given, the quantity increased atomically.
   */
  async contribute(
    user: User,
    id: string,
    input: ContributionInput,
    context: { conversationId?: string } = {},
  ): Promise<{ investment: InvestmentResponse; transaction: TransactionResponse }> {
    const settings = await userSettings(this.prisma, user.id);
    const investment = await this.findOwned(user, id);
    const occurredOn = input.occurredOn ?? formatCalendarDate(todayIn(settings.timeZone));
    const defaultCategory = await this.prisma.category.findUnique({
      where: { systemKey: 'investments' },
      select: { id: true },
    });

    const values = await this.transactions.prepare(
      user,
      {
        type: 'INVESTMENT',
        description: input.description ?? investment.name,
        amount: input.amount,
        currency: investment.currency,
        occurredOn,
        accountId: input.accountId ?? null,
        categoryId:
          input.categoryId !== undefined
            ? input.categoryId
            : (defaultCategory?.id ?? null),
        ...(input.paymentMethod !== undefined
          ? { paymentMethod: input.paymentMethod }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      settings.currency,
    );
    const spreadsheetId = await this.transactions.activeSpreadsheetId(user);

    const transactionId = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.transaction.create({
          data: {
            ...values,
            ownerId: user.id,
            spreadsheetId,
            investmentId: id,
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
        if (
          input.quantity !== undefined &&
          !new Prisma.Decimal(input.quantity).isZero()
        ) {
          const updated = await tx.investment.update({
            where: { id, version: investment.version },
            data: {
              quantity: { increment: new Prisma.Decimal(input.quantity) },
              version: { increment: 1 },
              syncStatus: 'PENDING_SYNC',
            },
          });
          const diff = diffSnapshots(snapshotOf(investment), snapshotOf(updated));
          if (diff) {
            await this.history.record(tx, {
              ownerId: user.id,
              entityType: 'INVESTMENT',
              entityId: id,
              action: 'UPDATE',
              ...diff,
              conversationId: context.conversationId ?? null,
            });
          }
        }
        return created.id;
      })
      .catch(rethrowVersionConflict);

    return {
      investment: await this.getSummary(user, id),
      transaction: await this.transactions.get(user, transactionId),
    };
  }

  private async getSummary(user: User, id: string): Promise<InvestmentResponse> {
    const row = await this.findOwned(user, id);
    return toResponse(row, (await this.flows(user, [id])).get(id));
  }

  private async findOwned(user: User, id: string): Promise<Row> {
    const row = await this.prisma.investment.findFirst({
      where: { id, ...ownedBy(user) },
      include: INCLUDE,
    });
    if (!row) throw new ResourceNotFoundException();
    return row;
  }

  private async usableAccount(user: User, id: string): Promise<FinancialAccount> {
    const account = await this.accounts.findOwned(user, id);
    if (account.isArchived) {
      throw ruleViolation(
        'account_archived',
        'A conta está arquivada e não aceita novos vínculos.',
      );
    }
    return account;
  }

  private cost(value: unknown, currency: string): Prisma.Decimal {
    const parsed = parseMoney(value, currency, { allowZero: true });
    if (!parsed.ok) {
      throw ruleViolation(parsed.issue, 'Custo inválido para a moeda do investimento.', {
        field: 'totalCost',
        currency,
      });
    }
    return parsed.value;
  }

  private async flows(user: User, ids: string[]): Promise<Map<string, Flows>> {
    const result = new Map<string, Flows>();
    if (ids.length === 0) return result;
    const groups = await this.prisma.transaction.groupBy({
      by: ['investmentId', 'status'],
      where: {
        ...ownedBy(user),
        investmentId: { in: ids },
        status: { in: ['COMPLETED', 'PENDING'] },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    for (const group of groups) {
      if (!group.investmentId) continue;
      const entry = result.get(group.investmentId) ?? {
        contributed: ZERO,
        pending: ZERO,
        count: 0,
      };
      const amount = group._sum.amount ?? ZERO;
      if (group.status === 'COMPLETED')
        entry.contributed = entry.contributed.plus(amount);
      else entry.pending = entry.pending.plus(amount);
      entry.count += group._count._all;
      result.set(group.investmentId, entry);
    }
    return result;
  }
}

function toResponse(
  row: Row | (Investment & Pick<Row, 'account'>),
  flows?: Flows,
): InvestmentResponse {
  const currency = row.currency;
  const contributed = flows?.contributed ?? ZERO;
  return {
    id: row.id,
    assetClass: row.assetClass,
    name: row.name,
    symbol: row.symbol,
    account: row.account,
    currency,
    quantity: row.quantity.toFixed(),
    openingCost: moneyString(row.totalCost, currency) as string,
    contributed: moneyString(contributed, currency) as string,
    pendingContributions: moneyString(flows?.pending ?? ZERO, currency) as string,
    invested: moneyString(row.totalCost.plus(contributed), currency) as string,
    contributionCount: flows?.count ?? 0,
    notes: row.notes,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
