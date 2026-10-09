import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { ToolDefinition } from '../../ai/ai.types.js';
import { DashboardService } from '../../dashboard/dashboard.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AccountsService } from '../../finance/accounts.service.js';
import { CategoriesService } from '../../finance/categories.service.js';
import { FinanceQueriesService } from '../../finance/finance-queries.service.js';
import { InstallmentsService } from '../../finance/installments.service.js';
import { InvestmentsService } from '../../finance/investments.service.js';
import { RecurringTransactionsService } from '../../finance/recurring-transactions.service.js';
import { TransactionsService } from '../../finance/transactions.service.js';
import { UndoService } from '../../finance/undo.service.js';
import { GoogleConnectionService } from '../../google/google-connection.service.js';
import { ProfileService } from '../../profile/profile.service.js';
import { ReportsService } from '../../reports/reports.service.js';
import {
  GOOGLE_WORKSPACE_CLIENT,
  type GoogleWorkspaceClient,
} from '../../spreadsheets/google-workspace.client.js';
import { SpreadsheetsService } from '../../spreadsheets/spreadsheets.service.js';
import { SheetSyncService } from '../../spreadsheets/sync/sheet-sync.service.js';
import { dataTools } from './data.tools.js';
import { financeTools } from './finance.tools.js';
import { insightTools } from './insight.tools.js';
import { reportTools } from './report.tools.js';
import type { ToolContext, ToolRisk, ToolSpec } from './tool.types.js';
import { workspaceTools } from './workspace.tools.js';

const NAME = /^[a-z][a-z0-9_]{2,63}$/;

export interface ToolInfo {
  name: string;
  version: number;
  description: string;
  risk: ToolRisk;
  parameters: Record<string, unknown>;
}

/**
 * The allowlist: tools exist only if registered here. Names are unique and snake_case,
 * every input schema is strict (unknown arguments rejected) and is turned into JSON Schema
 * for the models.
 */
@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec>();
  private readonly schemas = new Map<string, Record<string, unknown>>();

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(AccountsService) accounts: AccountsService,
    @Inject(CategoriesService) categories: CategoriesService,
    @Inject(TransactionsService) transactions: TransactionsService,
    @Inject(FinanceQueriesService) queries: FinanceQueriesService,
    @Inject(InstallmentsService) installments: InstallmentsService,
    @Inject(RecurringTransactionsService) recurring: RecurringTransactionsService,
    @Inject(InvestmentsService) investments: InvestmentsService,
    @Inject(SpreadsheetsService) spreadsheets: SpreadsheetsService,
    @Inject(SheetSyncService) sheetSync: SheetSyncService,
    @Inject(ProfileService) profiles: ProfileService,
    @Inject(UndoService) undo: UndoService,
    @Inject(GOOGLE_WORKSPACE_CLIENT) workspace: GoogleWorkspaceClient,
    @Inject(GoogleConnectionService) google: GoogleConnectionService,
    @Inject(DashboardService) dashboard: DashboardService,
    @Inject(ReportsService) reports: ReportsService,
  ) {
    const all = [
      ...financeTools({
        prisma,
        accounts,
        categories,
        transactions,
        queries,
        installments,
        recurring,
        investments,
      }),
      ...workspaceTools({ prisma, spreadsheets, sheetSync, profiles }),
      ...dataTools({ prisma, undo, spreadsheets, workspace, google, reports }),
      ...insightTools({ dashboard }),
      ...reportTools({ reports }),
    ];
    for (const tool of all) this.register(tool);
  }

  get(name: string): ToolSpec | undefined {
    return this.tools.get(name);
  }

  all(): ToolSpec[] {
    return [...this.tools.values()];
  }

  /** Tools this user may call, described for the UI/audit. */
  infoFor(ctx: Pick<ToolContext, 'user'>): ToolInfo[] {
    return this.allowed(ctx).map((tool) => ({
      name: tool.name,
      version: tool.version,
      description: tool.description,
      risk: tool.risk,
      parameters: this.schemas.get(tool.name) as Record<string, unknown>,
    }));
  }

  /** Definitions handed to the model: only tools this user may call. */
  definitionsFor(ctx: Pick<ToolContext, 'user'>): ToolDefinition[] {
    return this.allowed(ctx).map((tool) => ({
      name: tool.name,
      description:
        tool.risk === 'destructive'
          ? `${tool.description} [Ação destrutiva: o sistema pede confirmação ao usuário; não peça a confirmação você mesmo.]`
          : tool.description,
      parameters: this.schemas.get(tool.name) as Record<string, unknown>,
    }));
  }

  private allowed(ctx: Pick<ToolContext, 'user'>): ToolSpec[] {
    return this.all().filter((tool) =>
      tool.roles.some((role) => ctx.user.roles.includes(role)),
    );
  }

  private register(tool: ToolSpec): void {
    if (!NAME.test(tool.name)) throw new Error(`invalid tool name ${tool.name}`);
    if (this.tools.has(tool.name)) throw new Error(`duplicate tool ${tool.name}`);
    if (tool.risk === 'destructive' && !tool.prepare) {
      throw new Error(`destructive tool ${tool.name} needs prepare()`);
    }
    const schema = z.toJSONSchema(tool.input, {
      io: 'input',
      unrepresentable: 'any',
    }) as Record<string, unknown>;
    if (schema.type !== 'object' || schema.additionalProperties !== false) {
      throw new Error(`tool ${tool.name} must have a strict object schema`);
    }
    delete schema.$schema;
    this.tools.set(tool.name, tool);
    this.schemas.set(tool.name, schema);
  }
}
