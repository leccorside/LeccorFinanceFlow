import { z } from 'zod';
import { ResourceNotFoundException } from '../../common/errors/api-error.js';
import { defined } from '../../common/validation/defined.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { AccountsService } from '../../finance/accounts.service.js';
import type { CategoriesService } from '../../finance/categories.service.js';
import { formatCalendarDate, todayIn } from '../../finance/dates.js';
import type { FinanceQueriesService } from '../../finance/finance-queries.service.js';
import {
  ACCOUNT_TYPES,
  CATEGORY_KINDS,
  calendarDate,
  contributionSchema,
  createAccountSchema,
  createCategorySchema,
  createInstallmentSchema,
  createInvestmentSchema,
  createRecurringSchema,
  createTransactionSchema,
  FREQUENCIES,
  INTERVAL_UNITS,
  INVESTMENT_CLASSES,
  PAYMENT_METHODS,
  RECURRING_TYPES,
  ruleViolation,
  type SearchTransactionsInput,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  updateAccountSchema,
  updateTransactionSchema,
} from '../../finance/finance.schemas.js';
import type { InstallmentsService } from '../../finance/installments.service.js';
import type { InvestmentsService } from '../../finance/investments.service.js';
import type { RecurringTransactionsService } from '../../finance/recurring-transactions.service.js';
import type {
  TransactionResponse,
  TransactionsService,
} from '../../finance/transactions.service.js';
import { userSettings } from '../../finance/user-settings.js';
import { accountId, categoryId, investmentId, onlyOne } from './resolvers.js';
import { defineTool, type ToolContext, type ToolSpec } from './tool.types.js';

export interface FinanceToolDeps {
  prisma: PrismaService;
  accounts: AccountsService;
  categories: CategoriesService;
  transactions: TransactionsService;
  queries: FinanceQueriesService;
  installments: InstallmentsService;
  recurring: RecurringTransactionsService;
  investments: InvestmentsService;
}

// ───────────────────────────── Shared fields ─────────────────────────────

const USER = ['USER'] as const;
const date = calendarDate.describe('Data no formato AAAA-MM-DD.');
const money = z
  .union([z.string().max(32), z.number()])
  .describe('Valor positivo com ponto decimal, de preferência como texto: "87.45".');
const id = z.uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const tags = z.array(z.string().trim().min(1).max(30)).max(10);
const accountRef = {
  accountId: id.nullable().optional().describe('Id da conta (de list_accounts).'),
  accountName: text(100).optional().describe('Ou o nome da conta, como o usuário disse.'),
};
const categoryRef = {
  categoryId: id.nullable().optional().describe('Id da categoria (de list_categories).'),
  categoryName: text(100)
    .optional()
    .describe('Ou o nome da categoria; subcategoria como "Transporte > Combustível".'),
};
const accountRefOk = onlyOne('accountId', 'accountName');
const categoryRefOk = onlyOne('categoryId', 'categoryName');
const BOTH = 'use the id or the name, not both';

const ctxOf = (ctx: ToolContext) =>
  ctx.conversationId ? { conversationId: ctx.conversationId } : {};

async function today(prisma: PrismaService, ctx: ToolContext): Promise<string> {
  return formatCalendarDate(todayIn((await userSettings(prisma, ctx.user.id)).timeZone));
}

/** Safe fields of a transaction to show in confirmations and candidate lists. */
function transactionSummary(row: TransactionResponse): Record<string, unknown> {
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    occurredOn: row.occurredOn,
    status: row.status,
    category: row.category?.name ?? null,
    account: row.account?.name ?? null,
  };
}

export function financeTools(deps: FinanceToolDeps): ToolSpec[] {
  const {
    prisma,
    accounts,
    categories,
    transactions,
    queries,
    installments,
    recurring,
    investments,
  } = deps;

  return [
    // ─────────────────────────────── Reads ───────────────────────────────
    defineTool({
      name: 'list_accounts',
      version: 1,
      description:
        'Lista as contas e cartões do usuário com saldo atual (concluídos) e pendente.',
      input: z.strictObject({ includeArchived: z.boolean().optional() }),
      roles: USER,
      risk: 'read',
      run: (ctx, input) => accounts.list(ctx.user, input.includeArchived ?? false),
    }),
    defineTool({
      name: 'list_categories',
      version: 1,
      description:
        'Lista as categorias disponíveis (padrão e do usuário) no idioma do usuário, com subcategorias (parentId).',
      input: z.strictObject({ kind: z.enum(CATEGORY_KINDS).optional() }),
      roles: USER,
      risk: 'read',
      run: (ctx, input) =>
        categories.list(ctx.user, {
          ...(input.kind ? { kind: input.kind } : {}),
          includeArchived: false,
        }),
    }),
    defineTool({
      name: 'search_transactions',
      version: 1,
      description:
        'Busca movimentações do usuário por período, tipo, status, conta, categoria (inclui subcategorias), texto e faixa de valor. Use para achar registros antes de alterar ou excluir.',
      input: z
        .strictObject({
          from: date.optional(),
          to: date.optional(),
          types: z.array(z.enum(TRANSACTION_TYPES)).min(1).optional(),
          statuses: z.array(z.enum(TRANSACTION_STATUSES)).min(1).optional(),
          ...accountRef,
          ...categoryRef,
          text: text(100).optional().describe('Trecho da descrição ou observação.'),
          minAmount: z
            .string()
            .regex(/^\d{1,15}(\.\d{1,4})?$/)
            .optional(),
          maxAmount: z
            .string()
            .regex(/^\d{1,15}(\.\d{1,4})?$/)
            .optional(),
          overdueOnly: z.boolean().optional(),
          sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).optional(),
          limit: z.number().int().min(1).max(20).optional(),
        })
        .refine(accountRefOk, BOTH)
        .refine(categoryRefOk, BOTH),
      roles: USER,
      risk: 'read',
      run: async (ctx, input) => {
        const filter: SearchTransactionsInput = defined({
          from: input.from,
          to: input.to,
          type: input.types,
          status: input.statuses,
          accountId:
            (await accountId(accounts, ctx, input.accountId, input.accountName)) ??
            undefined,
          categoryId:
            (await categoryId(categories, ctx, input.categoryId, input.categoryName)) ??
            undefined,
          q: input.text,
          minAmount: input.minAmount,
          maxAmount: input.maxAmount,
          overdue: input.overdueOnly ? 'true' : undefined,
          sort: input.sort,
          limit: input.limit ?? 10,
        }) as SearchTransactionsInput;
        return transactions.search(ctx.user, filter);
      },
    }),
    defineTool({
      name: 'get_financial_summary',
      version: 1,
      description:
        'Resumo exato do período por moeda: receitas, despesas, investimentos, saldo, gastos por categoria e maiores despesas. Use para qualquer pergunta de "quanto".',
      input: z
        .strictObject({ from: date, to: date })
        .refine((value) => value.from <= value.to, 'from must not be after to'),
      roles: USER,
      risk: 'read',
      run: (ctx, input) => queries.summary(ctx.user, input.from, input.to),
    }),
    ...(['EXPENSE', 'INCOME'] as const).map((type) =>
      defineTool({
        name: type === 'EXPENSE' ? 'get_expenses_by_period' : 'get_income_by_period',
        version: 1,
        description: `Série de ${type === 'EXPENSE' ? 'despesas' : 'receitas'} por dia ou mês, por moeda.`,
        input: z
          .strictObject({
            from: date,
            to: date,
            groupBy: z.enum(['day', 'month']).optional(),
          })
          .refine((value) => value.from <= value.to, 'from must not be after to'),
        roles: USER,
        risk: 'read',
        run: (ctx, input) =>
          queries.byPeriod(ctx.user, type, input.from, input.to, input.groupBy),
      }),
    ),
    defineTool({
      name: 'get_upcoming_bills',
      version: 1,
      description:
        'Despesas pendentes que vencem de hoje até hoje + days − 1 (padrão 7).',
      input: z.strictObject({ days: z.number().int().min(1).max(366).optional() }),
      roles: USER,
      risk: 'read',
      run: (ctx, input) => queries.upcomingBills(ctx.user, input.days),
    }),
    defineTool({
      name: 'get_overdue_bills',
      version: 1,
      description: 'Despesas pendentes já vencidas.',
      input: z.strictObject({}),
      roles: USER,
      risk: 'read',
      run: (ctx) => queries.overdueBills(ctx.user),
    }),
    defineTool({
      name: 'list_installment_purchases',
      version: 1,
      description:
        'Compras parceladas com parcelas pagas, restantes e próximo vencimento.',
      input: z.strictObject({}),
      roles: USER,
      risk: 'read',
      run: (ctx) => installments.list(ctx.user),
    }),
    defineTool({
      name: 'list_recurring_transactions',
      version: 1,
      description: 'Recorrências (aluguel, salário, assinaturas) com as próximas datas.',
      input: z.strictObject({ includeInactive: z.boolean().optional() }),
      roles: USER,
      risk: 'read',
      run: (ctx, input) => recurring.list(ctx.user, input.includeInactive ?? false),
    }),
    defineTool({
      name: 'list_investments',
      version: 1,
      description: 'Posições de investimento com valor investido (custo, sem cotação).',
      input: z.strictObject({ assetClass: z.enum(INVESTMENT_CLASSES).optional() }),
      roles: USER,
      risk: 'read',
      run: (ctx, input) => investments.list(ctx.user, input.assetClass),
    }),
    defineTool({
      name: 'get_investments_summary',
      version: 1,
      description: 'Total investido por moeda e por classe, com participação percentual.',
      input: z.strictObject({}),
      roles: USER,
      risk: 'read',
      run: (ctx) => investments.summary(ctx.user),
    }),

    // ─────────────────────────────── Writes ───────────────────────────────
    defineTool({
      name: 'create_transaction',
      version: 1,
      description:
        'Registra receita, despesa, investimento ou transferência. Sem vencimento fica paga na data; com vencimento fica pendente. Data padrão: hoje no fuso do usuário.',
      input: z
        .strictObject({
          type: z.enum(TRANSACTION_TYPES),
          description: text(255),
          amount: money,
          currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .optional(),
          occurredOn: date.optional(),
          dueOn: date.nullable().optional(),
          paidOn: date.nullable().optional(),
          status: z.enum(TRANSACTION_STATUSES).optional(),
          paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
          ...accountRef,
          transferAccountId: id.nullable().optional(),
          transferAccountName: text(100).optional(),
          ...categoryRef,
          notes: optionalText(1000),
          tags: tags.optional(),
        })
        .refine(accountRefOk, BOTH)
        .refine(onlyOne('transferAccountId', 'transferAccountName'), BOTH)
        .refine(categoryRefOk, BOTH),
      roles: USER,
      risk: 'write',
      run: async (ctx, input) => {
        const parsed = createTransactionSchema.parse(
          defined({
            type: input.type,
            description: input.description,
            amount: input.amount,
            currency: input.currency,
            occurredOn: input.occurredOn ?? (await today(prisma, ctx)),
            dueOn: input.dueOn,
            paidOn: input.paidOn,
            status: input.status,
            paymentMethod: input.paymentMethod,
            accountId: await accountId(accounts, ctx, input.accountId, input.accountName),
            transferAccountId: await accountId(
              accounts,
              ctx,
              input.transferAccountId,
              input.transferAccountName,
              'transfer_account',
            ),
            categoryId: await categoryId(
              categories,
              ctx,
              input.categoryId,
              input.categoryName,
            ),
            notes: input.notes,
            tags: input.tags,
          }),
        );
        return transactions.create(ctx.user, parsed, ctxOf(ctx));
      },
    }),
    defineTool({
      name: 'update_transaction',
      version: 1,
      description:
        'Altera campos de uma movimentação (por id de search_transactions). Devolve como era antes e como ficou.',
      input: z
        .strictObject({
          transactionId: id,
          version: z.number().int().min(1).optional(),
          type: z.enum(TRANSACTION_TYPES).optional(),
          description: text(255).optional(),
          amount: money.optional(),
          currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .optional(),
          occurredOn: date.optional(),
          dueOn: date.nullable().optional(),
          paidOn: date.nullable().optional(),
          status: z.enum(TRANSACTION_STATUSES).optional(),
          paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
          ...accountRef,
          transferAccountId: id.nullable().optional(),
          transferAccountName: text(100).optional(),
          ...categoryRef,
          notes: optionalText(1000),
          tags: tags.optional(),
        })
        .refine(accountRefOk, BOTH)
        .refine(onlyOne('transferAccountId', 'transferAccountName'), BOTH)
        .refine(categoryRefOk, BOTH),
      roles: USER,
      risk: 'write',
      run: async (ctx, input) => {
        const before = await transactions.get(ctx.user, input.transactionId);
        const parsed = updateTransactionSchema.parse(
          defined({
            version: input.version,
            type: input.type,
            description: input.description,
            amount: input.amount,
            currency: input.currency,
            occurredOn: input.occurredOn,
            dueOn: input.dueOn,
            paidOn: input.paidOn,
            status: input.status,
            paymentMethod: input.paymentMethod,
            accountId: await accountId(accounts, ctx, input.accountId, input.accountName),
            transferAccountId: await accountId(
              accounts,
              ctx,
              input.transferAccountId,
              input.transferAccountName,
              'transfer_account',
            ),
            categoryId: await categoryId(
              categories,
              ctx,
              input.categoryId,
              input.categoryName,
            ),
            notes: input.notes,
            tags: input.tags,
          }),
        );
        const after = await transactions.update(
          ctx.user,
          input.transactionId,
          parsed,
          ctxOf(ctx),
        );
        return { before, after };
      },
    }),
    defineTool({
      name: 'create_account',
      version: 1,
      description:
        'Cria conta, carteira ou cartão de crédito (com limite, fechamento e vencimento).',
      input: z.strictObject({
        type: z.enum(ACCOUNT_TYPES),
        name: text(100),
        institution: optionalText(100),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .optional(),
        initialBalance: money.optional(),
        creditLimit: money.nullable().optional(),
        closingDay: z.number().int().min(1).max(31).nullable().optional(),
        dueDay: z.number().int().min(1).max(31).nullable().optional(),
        lastFourDigits: z
          .string()
          .regex(/^\d{4}$/)
          .nullable()
          .optional(),
      }),
      roles: USER,
      risk: 'write',
      run: (ctx, input) =>
        accounts.create(ctx.user, createAccountSchema.parse(defined(input)), ctxOf(ctx)),
    }),
    defineTool({
      name: 'update_account',
      version: 1,
      description:
        'Altera nome, instituição, saldo inicial, dados de cartão ou arquiva uma conta.',
      input: z
        .strictObject({
          ...accountRef,
          name: text(100).optional(),
          institution: optionalText(100),
          initialBalance: money.optional(),
          creditLimit: money.nullable().optional(),
          closingDay: z.number().int().min(1).max(31).nullable().optional(),
          dueDay: z.number().int().min(1).max(31).nullable().optional(),
          isArchived: z.boolean().optional(),
          version: z.number().int().min(1).optional(),
        })
        .refine(accountRefOk, BOTH)
        .refine((value) => value.accountId || value.accountName, 'account is required'),
      roles: USER,
      risk: 'write',
      run: async (ctx, input) => {
        const target = (await accountId(
          accounts,
          ctx,
          input.accountId,
          input.accountName,
        )) as string;
        const { accountId: _id, accountName: _name, ...fields } = input;
        void _id;
        void _name;
        return accounts.update(
          ctx.user,
          target,
          updateAccountSchema.parse(defined(fields)),
          ctxOf(ctx),
        );
      },
    }),
    defineTool({
      name: 'create_category',
      version: 1,
      description:
        'Cria categoria própria ou subcategoria (um nível) do mesmo tipo da categoria pai.',
      input: z
        .strictObject({
          name: text(100),
          kind: z.enum(CATEGORY_KINDS),
          parentId: id.nullable().optional(),
          parentName: text(100).optional(),
        })
        .refine(onlyOne('parentId', 'parentName'), BOTH),
      roles: USER,
      risk: 'write',
      run: async (ctx, input) =>
        categories.create(
          ctx.user,
          createCategorySchema.parse(
            defined({
              name: input.name,
              kind: input.kind,
              parentId: await categoryId(
                categories,
                ctx,
                input.parentId,
                input.parentName,
              ),
            }),
          ),
          ctxOf(ctx),
        ),
    }),
    defineTool({
      name: 'create_installment_purchase',
      version: 1,
      description:
        'Registra compra parcelada ("TV de R$ 3.600 em 12x no cartão"): cria as parcelas pendentes com vencimentos mensais, pela fatura do cartão quando houver.',
      input: z
        .strictObject({
          description: text(255),
          totalAmount: money,
          installmentCount: z.number().int().min(2).max(420),
          purchasedOn: date.optional(),
          firstDueOn: date.optional(),
          ...accountRef,
          ...categoryRef,
          paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
          notes: optionalText(1000),
        })
        .refine(accountRefOk, BOTH)
        .refine(categoryRefOk, BOTH),
      roles: USER,
      risk: 'write',
      run: async (ctx, input) =>
        installments.create(
          ctx.user,
          createInstallmentSchema.parse(
            defined({
              description: input.description,
              totalAmount: input.totalAmount,
              installmentCount: input.installmentCount,
              purchasedOn: input.purchasedOn ?? (await today(prisma, ctx)),
              firstDueOn: input.firstDueOn,
              accountId: await accountId(
                accounts,
                ctx,
                input.accountId,
                input.accountName,
              ),
              categoryId: await categoryId(
                categories,
                ctx,
                input.categoryId,
                input.categoryName,
              ),
              paymentMethod: input.paymentMethod,
              notes: input.notes,
            }),
          ),
          ctxOf(ctx),
        ),
    }),
    defineTool({
      name: 'create_recurring_transaction',
      version: 1,
      description:
        'Cria recorrência ("aluguel de R$ 2.500 todo dia 5"): semanal, quinzenal (14 dias), mensal (dayOfMonth), anual ou personalizada (intervalCount + intervalUnit).',
      input: z
        .strictObject({
          type: z.enum(RECURRING_TYPES),
          description: text(255),
          amount: money,
          frequency: z.enum(FREQUENCIES),
          intervalCount: z.number().int().min(1).max(366).optional(),
          intervalUnit: z.enum(INTERVAL_UNITS).optional(),
          dayOfMonth: z.number().int().min(1).max(31).optional(),
          startOn: date.optional(),
          endOn: date.nullable().optional(),
          ...accountRef,
          ...categoryRef,
          paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
        })
        .refine(accountRefOk, BOTH)
        .refine(categoryRefOk, BOTH),
      roles: USER,
      risk: 'write',
      run: async (ctx, input) =>
        recurring.create(
          ctx.user,
          createRecurringSchema.parse(
            defined({
              type: input.type,
              description: input.description,
              amount: input.amount,
              frequency: input.frequency,
              intervalCount: input.intervalCount,
              intervalUnit: input.intervalUnit,
              dayOfMonth: input.dayOfMonth,
              startOn: input.startOn,
              endOn: input.endOn,
              accountId: await accountId(
                accounts,
                ctx,
                input.accountId,
                input.accountName,
              ),
              categoryId: await categoryId(
                categories,
                ctx,
                input.categoryId,
                input.categoryName,
              ),
              paymentMethod: input.paymentMethod,
            }),
          ),
          ctxOf(ctx),
        ),
    }),
    defineTool({
      name: 'create_investment',
      version: 1,
      description:
        'Cria posição de investimento (ações, FIIs, ETFs, cripto, Tesouro, CDB, LCI/LCA, fundos, previdência, outros).',
      input: z
        .strictObject({
          assetClass: z.enum(INVESTMENT_CLASSES),
          name: text(150),
          symbol: z.string().trim().min(1).max(30).nullable().optional(),
          ...accountRef,
          currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .optional(),
          quantity: z
            .string()
            .regex(/^\d{1,18}(\.\d{1,10})?$/)
            .optional(),
          totalCost: money.optional(),
          notes: optionalText(1000),
        })
        .refine(accountRefOk, BOTH),
      roles: USER,
      risk: 'write',
      run: async (ctx, input) =>
        investments.create(
          ctx.user,
          createInvestmentSchema.parse(
            defined({
              assetClass: input.assetClass,
              name: input.name,
              symbol: input.symbol,
              accountId: await accountId(
                accounts,
                ctx,
                input.accountId,
                input.accountName,
              ),
              currency: input.currency,
              quantity: input.quantity,
              totalCost: input.totalCost,
              notes: input.notes,
            }),
          ),
          ctxOf(ctx),
        ),
    }),
    defineTool({
      name: 'add_investment_contribution',
      version: 1,
      description:
        'Registra aporte ("investi R$ 1.000 em Bitcoin hoje"): movimentação de investimento vinculada à posição; quantity soma unidades.',
      input: z
        .strictObject({
          investmentId: id.optional(),
          investmentName: text(150).optional(),
          amount: money,
          quantity: z
            .string()
            .regex(/^\d{1,18}(\.\d{1,10})?$/)
            .optional(),
          occurredOn: date.optional(),
          ...accountRef,
          status: z.enum(['PENDING', 'COMPLETED']).optional(),
          description: text(255).optional(),
        })
        .refine(onlyOne('investmentId', 'investmentName'), BOTH)
        .refine(
          (value) => value.investmentId || value.investmentName,
          'investment is required',
        )
        .refine(accountRefOk, BOTH),
      roles: USER,
      risk: 'write',
      run: async (ctx, input) =>
        investments.contribute(
          ctx.user,
          await investmentId(investments, ctx, input.investmentId, input.investmentName),
          contributionSchema.parse(
            defined({
              amount: input.amount,
              quantity: input.quantity,
              occurredOn: input.occurredOn,
              accountId: await accountId(
                accounts,
                ctx,
                input.accountId,
                input.accountName,
              ),
              status: input.status,
              description: input.description,
            }),
          ),
          ctxOf(ctx),
        ),
    }),

    // ──────────────────────────── Destructive ────────────────────────────
    defineTool({
      name: 'delete_transaction',
      version: 1,
      description:
        'Exclui uma movimentação. Informe transactionId ou um filtro (match). Se mais de uma combinar, nada é excluído e os candidatos voltam para o usuário escolher. Sempre exige confirmação explícita do usuário.',
      input: z
        .strictObject({
          transactionId: id.optional(),
          match: z
            .strictObject({
              text: text(100).optional(),
              amount: z
                .string()
                .regex(/^\d{1,15}(\.\d{1,4})?$/)
                .optional(),
              on: date.optional(),
              from: date.optional(),
              to: date.optional(),
              type: z.enum(TRANSACTION_TYPES).optional(),
            })
            .refine((value) => Object.keys(value).length > 0, 'match needs a criterion')
            .optional(),
        })
        .refine(
          (value) => (value.transactionId === undefined) !== (value.match === undefined),
          'use transactionId or match',
        ),
      roles: USER,
      risk: 'destructive',
      prepare: async (ctx, input) => {
        let target: TransactionResponse;
        if (input.transactionId) {
          target = await transactions.get(ctx.user, input.transactionId);
        } else {
          const match = input.match ?? {};
          const found = await transactions.search(
            ctx.user,
            defined({
              q: match.text,
              minAmount: match.amount,
              maxAmount: match.amount,
              from: match.on ?? match.from,
              to: match.on ?? match.to,
              type: match.type ? [match.type] : undefined,
              sort: 'date_desc' as const,
              limit: 6,
            }) as SearchTransactionsInput,
          );
          if (found.items.length === 0) throw new ResourceNotFoundException();
          if (found.items.length > 1) {
            return {
              kind: 'ambiguous',
              candidates: found.items.slice(0, 5).map(transactionSummary),
            };
          }
          target = found.items[0] as TransactionResponse;
        }
        if (target.installment) {
          throw ruleViolation(
            'installment_parcel_locked',
            'Uma parcela não pode ser excluída sozinha: exclua a compra parcelada inteira.',
          );
        }
        return {
          kind: 'ready',
          input: { transactionId: target.id },
          summary: transactionSummary(target),
          state: { id: target.id, version: target.version },
        };
      },
      run: async (ctx, input) => {
        const target = await transactions.get(ctx.user, input.transactionId as string);
        await transactions.delete(ctx.user, target.id, ctxOf(ctx));
        return { deleted: transactionSummary(target) };
      },
    }),
    defineTool({
      name: 'delete_account',
      version: 1,
      description:
        'Exclui uma conta sem movimentações (com movimentações, sugira arquivar). Sempre exige confirmação.',
      input: z
        .strictObject(accountRef)
        .refine(accountRefOk, BOTH)
        .refine((value) => value.accountId || value.accountName, 'account is required'),
      roles: USER,
      risk: 'destructive',
      prepare: async (ctx, input) => {
        const target = await accounts.get(
          ctx.user,
          (await accountId(accounts, ctx, input.accountId, input.accountName)) as string,
        );
        return {
          kind: 'ready',
          input: { accountId: target.id },
          summary: {
            id: target.id,
            name: target.name,
            type: target.type,
            balance: target.balance,
            currency: target.currency,
          },
          state: { id: target.id, version: target.version },
        };
      },
      run: async (ctx, input) => {
        const target = await accounts.get(ctx.user, input.accountId as string);
        await accounts.delete(ctx.user, target.id, ctxOf(ctx));
        return { deleted: { id: target.id, name: target.name } };
      },
    }),
    defineTool({
      name: 'delete_investment',
      version: 1,
      description:
        'Exclui uma posição de investimento sem aportes. Sempre exige confirmação.',
      input: z
        .strictObject({
          investmentId: id.optional(),
          investmentName: text(150).optional(),
        })
        .refine(onlyOne('investmentId', 'investmentName'), BOTH)
        .refine(
          (value) => value.investmentId || value.investmentName,
          'investment is required',
        ),
      roles: USER,
      risk: 'destructive',
      prepare: async (ctx, input) => {
        const target = await investments.get(
          ctx.user,
          await investmentId(investments, ctx, input.investmentId, input.investmentName),
        );
        return {
          kind: 'ready',
          input: { investmentId: target.id },
          summary: {
            id: target.id,
            name: target.name,
            assetClass: target.assetClass,
            invested: target.invested,
            currency: target.currency,
          },
          state: { id: target.id, version: target.version },
        };
      },
      run: async (ctx, input) => {
        const target = await investments.get(ctx.user, input.investmentId as string);
        await investments.delete(ctx.user, target.id, ctxOf(ctx));
        return { deleted: { id: target.id, name: target.name } };
      },
    }),
    defineTool({
      name: 'delete_recurring_transaction',
      version: 1,
      description:
        'Encerra uma recorrência e remove as ocorrências futuras não editadas. Sempre exige confirmação.',
      input: z.strictObject({ recurringTransactionId: id }),
      roles: USER,
      risk: 'destructive',
      prepare: async (ctx, input) => {
        const target = await recurring.get(ctx.user, input.recurringTransactionId);
        return {
          kind: 'ready',
          input,
          summary: {
            id: target.id,
            description: target.description,
            amount: target.amount,
            currency: target.currency,
            frequency: target.frequency,
          },
          state: { id: target.id, version: target.version },
        };
      },
      run: async (ctx, input) => {
        const target = await recurring.get(ctx.user, input.recurringTransactionId);
        await recurring.delete(ctx.user, target.id, ctxOf(ctx));
        return { deleted: { id: target.id, description: target.description } };
      },
    }),
    defineTool({
      name: 'delete_installment_purchase',
      version: 1,
      description:
        'Exclui uma compra parcelada inteira, com todas as parcelas (inclusive pagas). Sempre exige confirmação.',
      input: z.strictObject({ installmentId: id }),
      roles: USER,
      risk: 'destructive',
      prepare: async (ctx, input) => {
        const target = await installments.get(ctx.user, input.installmentId);
        return {
          kind: 'ready',
          input,
          summary: {
            id: target.id,
            description: target.description,
            totalAmount: target.totalAmount,
            currency: target.currency,
            installmentCount: target.installmentCount,
            paidCount: target.paidCount,
          },
          state: {
            id: target.id,
            parcels: target.parcels.map((parcel) => [parcel.id, parcel.version]),
          },
        };
      },
      run: async (ctx, input) => {
        const target = await installments.get(ctx.user, input.installmentId);
        await installments.delete(ctx.user, target.id, ctxOf(ctx));
        return { deleted: { id: target.id, description: target.description } };
      },
    }),
  ] as unknown as ToolSpec[];
}
