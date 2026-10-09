import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ZodError } from 'zod';
import {
  ApiException,
  ResourceNotFoundException,
} from '../../common/errors/api-error.js';
import { ownedBy } from '../../common/security/ownership.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { SheetSyncService } from '../../spreadsheets/sync/sheet-sync.service.js';
import { ToolRegistry } from './tool-registry.js';
import {
  type ArgumentIssue,
  fingerprintOf,
  type SyncState,
  type ToolContext,
  type ToolOutcome,
  type ToolSpec,
} from './tool.types.js';
import { activeSpreadsheetId } from './workspace.tools.js';

/** How long the user has to confirm a destructive action. */
export const CONFIRMATION_TTL_MS = 5 * 60_000;

export interface ToolCallRequest {
  name: string;
  /** As proposed by the model: untrusted until validated. */
  arguments: unknown;
}

export interface PendingConfirmation {
  id: string;
  tool: string;
  summary: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
}

/**
 * Runs tool calls proposed by a model, in this order: allowlist → role → conversation
 * ownership → strict arguments → (destructive: resolve target, ambiguity, confirmation) →
 * domain service (ownership and rules) → spreadsheet sync → structured outcome.
 *
 * The user and their permissions always come from the session (`ToolContext`); no argument
 * can name another user, grant a permission or confirm an action. Confirmations are created
 * here and accepted only through `confirm`, called by the user (API + CSRF), never by a model.
 */
@Injectable()
export class ToolExecutor {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ToolRegistry) private readonly registry: ToolRegistry,
    @Inject(SheetSyncService) private readonly sheetSync: SheetSyncService,
  ) {}

  async execute(ctx: ToolContext, call: ToolCallRequest): Promise<ToolOutcome> {
    const name = typeof call.name === 'string' ? call.name.slice(0, 100) : '';
    const spec = this.registry.get(name);
    if (!spec) return { status: 'rejected', tool: name, error: 'unknown_tool' };
    if (!this.allowed(ctx, spec))
      return { status: 'rejected', tool: name, error: 'forbidden' };
    if (!(await this.conversationOk(ctx))) {
      return { status: 'rejected', tool: name, error: 'invalid_context' };
    }

    const parsed = spec.input.safeParse(call.arguments ?? {});
    if (!parsed.success) {
      return {
        status: 'rejected',
        tool: name,
        error: 'invalid_arguments',
        issues: issuesOf(parsed.error),
      };
    }

    try {
      if (spec.risk === 'destructive')
        return await this.askConfirmation(ctx, spec, parsed.data);
      return await this.run(ctx, spec, parsed.data);
    } catch (error) {
      return outcomeOfError(name, error);
    }
  }

  /** The user's explicit "yes": single use, unexpired, same tool version, same target state. */
  async confirm(ctx: ToolContext, confirmationId: string): Promise<ToolOutcome> {
    const row = await this.prisma.assistantConfirmation.findFirst({
      where: { id: confirmationId, ...ownedBy(ctx.user) },
    });
    if (!row) throw new ResourceNotFoundException();
    const { count } = await this.prisma.assistantConfirmation.updateMany({
      where: {
        id: row.id,
        ...ownedBy(ctx.user),
        usedAt: null,
        canceledAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw unusable(row);

    const spec = this.registry.get(row.toolName);
    if (!spec || spec.version !== row.toolVersion || !spec.prepare) throw stale();
    if (!this.allowed(ctx, spec))
      throw new ApiException(HttpStatus.FORBIDDEN, 'forbidden');
    const parsed = spec.input.safeParse(row.arguments);
    if (!parsed.success) throw stale();

    const runCtx: ToolContext = { user: ctx.user, conversationId: row.conversationId };
    try {
      const prepared = await spec.prepare(runCtx, parsed.data);
      if (
        prepared.kind !== 'ready' ||
        fingerprintOf(prepared.state) !== row.targetFingerprint
      ) {
        throw stale();
      }
      return await this.run(runCtx, spec, prepared.input);
    } catch (error) {
      if (error instanceof ApiException && codeOf(error) === 'confirmation_stale')
        throw error;
      if (error instanceof ResourceNotFoundException) throw stale(); // target gone meanwhile
      return outcomeOfError(spec.name, error);
    }
  }

  async cancel(ctx: ToolContext, confirmationId: string): Promise<void> {
    const row = await this.prisma.assistantConfirmation.findFirst({
      where: { id: confirmationId, ...ownedBy(ctx.user) },
    });
    if (!row) throw new ResourceNotFoundException();
    const { count } = await this.prisma.assistantConfirmation.updateMany({
      where: { id: row.id, ...ownedBy(ctx.user), usedAt: null, canceledAt: null },
      data: { canceledAt: new Date() },
    });
    if (count === 0) throw unusable(row);
  }

  async pending(ctx: ToolContext): Promise<PendingConfirmation[]> {
    const rows = await this.prisma.assistantConfirmation.findMany({
      where: {
        ...ownedBy(ctx.user),
        usedAt: null,
        canceledAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((row) => ({
      id: row.id,
      tool: row.toolName,
      summary: row.summary as Record<string, unknown>,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // ─────────────────────────────── Internals ───────────────────────────────

  private allowed(ctx: ToolContext, spec: ToolSpec): boolean {
    return spec.roles.some((role) => ctx.user.roles.includes(role));
  }

  /** A conversation id must be one of the user's conversations. */
  private async conversationOk(ctx: ToolContext): Promise<boolean> {
    if (!ctx.conversationId) return true;
    return (
      (await this.prisma.conversation.count({
        where: { id: ctx.conversationId, ...ownedBy(ctx.user) },
      })) === 1
    );
  }

  private async askConfirmation(
    ctx: ToolContext,
    spec: ToolSpec,
    input: unknown,
  ): Promise<ToolOutcome> {
    const prepared = await (spec.prepare as NonNullable<ToolSpec['prepare']>)(ctx, input);
    if (prepared.kind === 'ambiguous') {
      return {
        status: 'ambiguous',
        tool: spec.name,
        version: spec.version,
        candidates: prepared.candidates,
      };
    }
    const row = await this.prisma.assistantConfirmation.create({
      data: {
        ownerId: ctx.user.id,
        conversationId: ctx.conversationId,
        toolName: spec.name,
        toolVersion: spec.version,
        arguments: prepared.input as Prisma.InputJsonValue,
        targetFingerprint: fingerprintOf(prepared.state),
        summary: prepared.summary as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + CONFIRMATION_TTL_MS),
      },
    });
    return {
      status: 'confirmation_required',
      tool: spec.name,
      version: spec.version,
      confirmation: {
        id: row.id,
        expiresAt: row.expiresAt.toISOString(),
        summary: prepared.summary,
      },
    };
  }

  private async run(
    ctx: ToolContext,
    spec: ToolSpec,
    input: unknown,
  ): Promise<ToolOutcome> {
    const data = await spec.run(ctx, input);
    const outcome: ToolOutcome = {
      status: 'ok',
      tool: spec.name,
      version: spec.version,
      data,
    };
    if (spec.risk !== 'read' && spec.syncAfter !== false) {
      outcome.sync = await this.syncAfterWrite(ctx);
    }
    return outcome;
  }

  /** Database first, sheet right after; a sheet failure never undoes the write. */
  private async syncAfterWrite(ctx: ToolContext): Promise<SyncState> {
    const id = await activeSpreadsheetId(this.prisma, ctx);
    if (!id) return 'NO_SPREADSHEET';
    try {
      return (await this.sheetSync.sync(ctx.user, id)).status;
    } catch {
      return 'PENDING_SYNC';
    }
  }
}

function issuesOf(error: ZodError): ArgumentIssue[] {
  // Path and rule only: never echo the values the model sent.
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.join('.') || '(root)',
    code:
      issue.code === 'unrecognized_keys'
        ? `unrecognized_keys:${(issue as { keys: string[] }).keys.join(',')}`.slice(
            0,
            120,
          )
        : issue.code,
  }));
}

function codeOf(error: HttpException): string {
  const body = error.getResponse();
  return typeof body === 'object' && body !== null && 'code' in body
    ? String((body as { code: unknown }).code)
    : 'error';
}

/** Domain/API errors become structured outcomes; unexpected ones never leak details. */
function outcomeOfError(tool: string, error: unknown): ToolOutcome {
  if (error instanceof ZodError) {
    return {
      status: 'rejected',
      tool,
      error: 'invalid_arguments',
      issues: issuesOf(error),
    };
  }
  if (error instanceof HttpException) {
    const body = error.getResponse() as {
      code?: string;
      message?: string;
      details?: unknown;
    };
    return {
      status: 'error',
      tool,
      error: body.code ?? 'error',
      message: body.message ?? 'Não foi possível concluir a ação.',
      ...(body.details !== undefined && body.details !== null
        ? { details: body.details }
        : {}),
    };
  }
  return {
    status: 'error',
    tool,
    error: 'internal_error',
    message: 'Não foi possível concluir a ação.',
  };
}

function stale(): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    'confirmation_stale',
    'O registro mudou desde o pedido de confirmação. Peça a ação de novo.',
  );
}

function unusable(row: { usedAt: Date | null; canceledAt: Date | null }): ApiException {
  if (row.usedAt) {
    return new ApiException(
      HttpStatus.CONFLICT,
      'confirmation_used',
      'Essa confirmação já foi usada.',
    );
  }
  if (row.canceledAt) {
    return new ApiException(
      HttpStatus.CONFLICT,
      'confirmation_canceled',
      'Essa ação foi cancelada.',
    );
  }
  return new ApiException(
    HttpStatus.GONE,
    'confirmation_expired',
    'A confirmação expirou. Peça a ação de novo.',
  );
}
