import { z } from 'zod';
import { ResourceNotFoundException } from '../../common/errors/api-error.js';
import { ownedBy } from '../../common/security/ownership.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { UndoService } from '../../finance/undo.service.js';
import type { GoogleConnectionService } from '../../google/google-connection.service.js';
import {
  GoogleApiError,
  type GoogleWorkspaceClient,
} from '../../spreadsheets/google-workspace.client.js';
import {
  type SpreadsheetsService,
  toApiException,
} from '../../spreadsheets/spreadsheets.service.js';
import type { ReportsService } from '../../reports/reports.service.js';
import { defineTool, type ToolContext, type ToolSpec } from './tool.types.js';

export interface DataToolDeps {
  prisma: PrismaService;
  undo: UndoService;
  spreadsheets: SpreadsheetsService;
  workspace: GoogleWorkspaceClient;
  google: GoogleConnectionService;
  reports: ReportsService;
}

const USER = ['USER'] as const;

/**
 * Undo and the high-impact deletions. Each deletion is its own tool with its own summary, so
 * the user always confirms exactly one kind of loss; all of them always ask, are bound to the
 * state they describe and expire like every confirmation.
 */
export function dataTools(deps: DataToolDeps): ToolSpec[] {
  const { prisma, undo, spreadsheets, workspace, google, reports } = deps;
  return [
    defineTool({
      name: 'undo_last_action',
      version: 1,
      description:
        'Desfaz a última alteração de dados do usuário ("desfaça o que acabei de fazer"): uma criação é removida, uma edição volta ao valor anterior e uma exclusão é restaurada. Se não for possível, devolve o motivo para explicar ao usuário.',
      input: z.strictObject({}),
      roles: USER,
      risk: 'write',
      run: (ctx) =>
        undo.undoLast(
          ctx.user,
          ctx.conversationId ? { conversationId: ctx.conversationId } : {},
        ),
    }),
    defineTool({
      name: 'delete_conversation_history',
      version: 1,
      description:
        'Apaga o histórico de conversas com o assistente: uma conversa (conversationId) ou todas. Não altera dados financeiros. Irreversível; sempre exige confirmação.',
      input: z.strictObject({ conversationId: z.uuid().optional() }),
      roles: USER,
      risk: 'destructive',
      prepare: async (ctx, input) => {
        const where = {
          ...ownedBy(ctx.user),
          ...(input.conversationId ? { id: input.conversationId } : {}),
        };
        const conversations = await prisma.conversation.findMany({
          where,
          select: { id: true, updatedAt: true },
          orderBy: { id: 'asc' },
        });
        if (input.conversationId && conversations.length === 0) {
          throw new ResourceNotFoundException();
        }
        const messages = await prisma.conversationMessage.count({
          where: { conversationId: { in: conversations.map((item) => item.id) } },
        });
        return {
          kind: 'ready',
          input,
          summary: {
            scope: input.conversationId ? 'conversation' : 'all_conversations',
            conversations: conversations.length,
            messages,
            irreversible: true,
          },
          state: conversations.map((item) => [item.id, item.updatedAt.toISOString()]),
        };
      },
      run: async (ctx, input) => {
        const { count } = await prisma.conversation.deleteMany({
          where: {
            ...ownedBy(ctx.user),
            ...(input.conversationId ? { id: input.conversationId } : {}),
          },
        });
        return { deleted: { conversations: count } };
      },
    }),
    defineTool({
      name: 'delete_financial_data',
      version: 1,
      description:
        'Apaga TODOS os dados financeiros do usuário no aplicativo: movimentações, parcelamentos, recorrências, investimentos, contas, categorias próprias e histórico de alterações. Não apaga a conta nem a planilha do Google. Irreversível; sempre exige confirmação.',
      input: z.strictObject({}),
      roles: USER,
      risk: 'destructive',
      prepare: async (ctx, input) => {
        const counts = await financialCounts(prisma, ctx);
        const latest = await prisma.actionHistory.findFirst({
          where: ownedBy(ctx.user),
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        return {
          kind: 'ready',
          input,
          summary: { ...counts, irreversible: true, spreadsheetUntouched: true },
          state: { counts, latestHistory: latest?.id ?? null },
        };
      },
      run: async (ctx) => {
        const owner = ownedBy(ctx.user);
        const deleted = await prisma.$transaction(async (tx) => {
          const transactions = await tx.transaction.deleteMany({ where: owner });
          const installments = await tx.installment.deleteMany({ where: owner });
          const recurring = await tx.recurringTransaction.deleteMany({ where: owner });
          const investments = await tx.investment.deleteMany({ where: owner });
          const accounts = await tx.financialAccount.deleteMany({ where: owner });
          // Subcategories first (they reference their parent).
          const children = await tx.category.deleteMany({
            where: { ...owner, parentId: { not: null } },
          });
          const roots = await tx.category.deleteMany({ where: owner });
          // The history holds snapshots of the deleted data: it goes too.
          await tx.actionHistory.deleteMany({ where: owner });
          await tx.spreadsheetRowState.deleteMany({ where: { spreadsheet: owner } });
          return {
            transactions: transactions.count,
            installments: installments.count,
            recurringTransactions: recurring.count,
            investments: investments.count,
            accounts: accounts.count,
            categories: children.count + roots.count,
          };
        });
        // Generated reports contain the deleted figures: they go too (rows and files).
        const purged = await reports.purgeOwner(ctx.user.id);
        return {
          deleted: { ...deleted, reports: purged.reports },
          reportFiles: purged.files,
        };
      },
    }),
    defineTool({
      name: 'delete_spreadsheet',
      version: 1,
      description:
        'Exclui uma planilha do usuário (a ativa, se não for informada): o arquivo vai para a lixeira do Google Drive e deixa de ser usado pelo aplicativo. Os dados financeiros no aplicativo continuam. Sempre exige confirmação.',
      input: z.strictObject({ spreadsheetId: z.uuid().optional() }),
      roles: USER,
      risk: 'destructive',
      syncAfter: false,
      prepare: async (ctx, input) => {
        const sheet = await prisma.spreadsheet.findFirst({
          where: {
            ...ownedBy(ctx.user),
            status: { not: 'ARCHIVED' },
            ...(input.spreadsheetId ? { id: input.spreadsheetId } : { isActive: true }),
          },
        });
        if (!sheet) throw new ResourceNotFoundException();
        return {
          kind: 'ready',
          input: { spreadsheetId: sheet.id },
          summary: {
            id: sheet.id,
            name: sheet.name,
            isActive: sheet.isActive,
            googleDriveTrash: sheet.googleSpreadsheetId !== null,
          },
          state: { id: sheet.id, updatedAt: sheet.updatedAt.toISOString() },
        };
      },
      run: async (ctx, input) => {
        const sheet = await prisma.spreadsheet.findFirst({
          where: { id: input.spreadsheetId as string, ...ownedBy(ctx.user) },
        });
        if (!sheet) throw new ResourceNotFoundException();
        let trashed = false;
        if (sheet.googleSpreadsheetId) {
          // Drive first: if Google refuses, nothing is deleted here either.
          try {
            await spreadsheets.withGoogleToken(ctx.user.id, (token) =>
              workspace.trashFile(token, sheet.googleSpreadsheetId as string),
            );
            trashed = true;
          } catch (error) {
            // Already gone from Drive: only the local record is left to remove. Any other
            // failure stops here, with the same sanitized codes as the setup.
            if (!(error instanceof GoogleApiError && error.kind === 'not_found')) {
              throw error instanceof GoogleApiError ? toApiException(error) : error;
            }
          }
        }
        await prisma.$transaction(async (tx) => {
          const link = { spreadsheetId: sheet.id };
          await tx.transaction.updateMany({ where: link, data: { spreadsheetId: null } });
          await tx.recurringTransaction.updateMany({
            where: link,
            data: { spreadsheetId: null },
          });
          await tx.installment.updateMany({ where: link, data: { spreadsheetId: null } });
          await tx.report.updateMany({ where: link, data: { spreadsheetId: null } });
          await tx.spreadsheet.delete({ where: { id: sheet.id } });
        });
        return { deleted: { name: sheet.name }, trashedInGoogleDrive: trashed };
      },
    }),
    defineTool({
      name: 'delete_my_account',
      version: 1,
      description:
        'Exclui a conta do usuário no aplicativo com todos os seus dados (perfil, dados financeiros, conversas, planilhas registradas e conexão com o Google, que é revogada). As planilhas continuam no Google Drive do usuário. Irreversível; sempre exige confirmação.',
      input: z.strictObject({}),
      roles: USER,
      risk: 'destructive',
      syncAfter: false,
      prepare: async (ctx, input) => {
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: ctx.user.id },
          select: { id: true, email: true, updatedAt: true },
        });
        return {
          kind: 'ready',
          input,
          summary: {
            email: user.email,
            ...(await financialCounts(prisma, ctx)),
            irreversible: true,
            spreadsheetsStayInGoogleDrive: true,
          },
          state: {
            id: user.id,
            email: user.email,
            updatedAt: user.updatedAt.toISOString(),
          },
        };
      },
      run: async (ctx) => {
        // Best effort: a Google failure must not keep the account alive.
        let googleRevocation: string;
        try {
          googleRevocation = (await google.disconnect(ctx.user)).remoteRevocation;
        } catch {
          googleRevocation = 'failed';
        }
        // Report files live outside the database: removed explicitly (rows go by cascade).
        const purged = await reports.purgeOwner(ctx.user.id);
        await prisma.user.delete({ where: { id: ctx.user.id } });
        return {
          deleted: { account: true },
          googleRevocation,
          reportFiles: purged.files,
        };
      },
    }),
  ] as unknown as ToolSpec[];
}

async function financialCounts(prisma: PrismaService, ctx: ToolContext) {
  const owner = ownedBy(ctx.user);
  const [transactions, accounts, investments, installments, recurringTransactions] =
    await Promise.all([
      prisma.transaction.count({ where: owner }),
      prisma.financialAccount.count({ where: owner }),
      prisma.investment.count({ where: owner }),
      prisma.installment.count({ where: owner }),
      prisma.recurringTransaction.count({ where: owner }),
    ]);
  return { transactions, accounts, investments, installments, recurringTransactions };
}
