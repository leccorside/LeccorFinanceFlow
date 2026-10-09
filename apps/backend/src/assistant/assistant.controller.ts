import { Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/session-auth.guard.js';
import { uuidParam } from '../common/validation/zod-validation.pipe.js';
import { type PendingConfirmation, ToolExecutor } from './tools/tool-executor.js';
import { type ToolInfo, ToolRegistry } from './tools/tool-registry.js';
import type { ToolOutcome } from './tools/tool.types.js';

/**
 * The user's side of tool execution: which tools exist for them, and the explicit
 * confirmation (or cancellation) of destructive actions. Conversations arrive in PASSO 14.
 */
@Controller('assistant')
export class AssistantController {
  constructor(
    @Inject(ToolRegistry) private readonly registry: ToolRegistry,
    @Inject(ToolExecutor) private readonly executor: ToolExecutor,
  ) {}

  @Get('tools')
  tools(@CurrentUser() user: AuthenticatedUser): ToolInfo[] {
    return this.registry.infoFor({ user });
  }

  @Get('confirmations')
  pending(@CurrentUser() user: AuthenticatedUser): Promise<PendingConfirmation[]> {
    return this.executor.pending({ user, conversationId: null });
  }

  /** Runs the confirmed action (single use; 409/410 when used, canceled, stale or expired). */
  @Post('confirmations/:id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<ToolOutcome> {
    return this.executor.confirm({ user, conversationId: null }, id);
  }

  @Post('confirmations/:id/cancel')
  @HttpCode(204)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<void> {
    return this.executor.cancel({ user, conversationId: null }, id);
  }
}
