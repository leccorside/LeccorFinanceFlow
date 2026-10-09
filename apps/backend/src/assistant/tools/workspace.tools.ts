import { z } from 'zod';
import { ownedBy } from '../../common/security/ownership.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { ruleViolation } from '../../finance/finance.schemas.js';
import { updateProfileSchema } from '../../profile/profile.schemas.js';
import type { ProfileService } from '../../profile/profile.service.js';
import type { SpreadsheetsService } from '../../spreadsheets/spreadsheets.service.js';
import type { SheetSyncService } from '../../spreadsheets/sync/sheet-sync.service.js';
import { defineTool, type ToolContext, type ToolSpec } from './tool.types.js';

export interface WorkspaceToolDeps {
  prisma: PrismaService;
  spreadsheets: SpreadsheetsService;
  sheetSync: SheetSyncService;
  profiles: ProfileService;
}

const USER = ['USER'] as const;

async function activeSpreadsheetId(
  prisma: PrismaService,
  ctx: ToolContext,
): Promise<string | null> {
  const row = await prisma.spreadsheet.findFirst({
    where: { ...ownedBy(ctx.user), isActive: true, status: 'ACTIVE' },
    select: { id: true },
  });
  return row?.id ?? null;
}

/** Spreadsheet and voice tools. Reports join here in PASSO 19 (no report generation yet). */
export function workspaceTools(deps: WorkspaceToolDeps): ToolSpec[] {
  const { prisma, spreadsheets, sheetSync, profiles } = deps;
  return [
    defineTool({
      name: 'get_spreadsheet_status',
      version: 1,
      description:
        'Planilha ativa do usuário (nome, link) e estado da sincronização: pendentes, conflitos e última sincronização.',
      input: z.strictObject({}),
      roles: USER,
      risk: 'read',
      run: async (ctx) => {
        const all = await spreadsheets.list(ctx.user);
        const active = all.find((sheet) => sheet.isActive) ?? null;
        if (!active) return { spreadsheet: null, sync: null };
        const status = await sheetSync.status(ctx.user, active.id);
        return {
          spreadsheet: {
            id: active.id,
            name: active.name,
            status: active.status,
            url: active.url,
          },
          sync: {
            lastSyncedAt: status.lastSyncedAt,
            lastErrorCode: status.lastErrorCode,
            pending: status.pending,
            conflicts: status.conflicts.length,
          },
        };
      },
    }),
    defineTool({
      name: 'create_spreadsheet',
      version: 1,
      description:
        'Cria (ou repara) a planilha financeira no Google Drive do usuário. Exige a conta Google conectada.',
      input: z.strictObject({ name: z.string().trim().min(1).max(150).optional() }),
      roles: USER,
      risk: 'write',
      syncAfter: false,
      run: (ctx, input) => spreadsheets.ensure(ctx.user, input.name),
    }),
    defineTool({
      name: 'sync_spreadsheet',
      version: 1,
      description:
        'Sincroniza agora a planilha ativa com o aplicativo e devolve o relatório (status SYNCED, PENDING_SYNC ou CONFLICT).',
      input: z.strictObject({}),
      roles: USER,
      risk: 'write',
      syncAfter: false,
      run: async (ctx) => {
        const id = await activeSpreadsheetId(prisma, ctx);
        if (!id) {
          throw ruleViolation(
            'no_active_spreadsheet',
            'O usuário ainda não tem uma planilha ativa.',
          );
        }
        return sheetSync.sync(ctx.user, id);
      },
    }),
    defineTool({
      name: 'change_voice_preference',
      version: 1,
      description:
        'Muda a voz do assistente (feminina ou masculina), a leitura automática das respostas e a velocidade da fala (0.5 a 2.0, passos de 0.05).',
      input: z
        .strictObject({
          gender: z.enum(['FEMALE', 'MALE']).optional(),
          autoSpeak: z.boolean().optional(),
          speakingRate: z.number().min(0.5).max(2).optional(),
        })
        .refine(
          (value) => Object.keys(value).length > 0,
          'at least one field is required',
        ),
      roles: USER,
      risk: 'write',
      syncAfter: false,
      run: async (ctx, input) =>
        (await profiles.update(ctx.user, updateProfileSchema.parse({ voice: input })))
          .voice,
    }),
  ] as unknown as ToolSpec[];
}

export { activeSpreadsheetId };
