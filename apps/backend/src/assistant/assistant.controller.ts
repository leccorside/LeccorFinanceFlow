import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/session-auth.guard.js';
import { RateLimit } from '../common/security/decorators.js';
import { dto, uuidParam, validate } from '../common/validation/zod-validation.pipe.js';
import { type AssistantTurn, AssistantService } from './assistant.service.js';
import { ConversationService } from './conversation.service.js';
import { type PendingConfirmation, ToolExecutor } from './tools/tool-executor.js';
import { type ToolInfo, ToolRegistry } from './tools/tool-registry.js';
import type { ToolOutcome } from './tools/tool.types.js';

const sendMessage = dto({
  conversationId: z.uuid().optional(),
  message: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    // Line breaks and tabs are fine in a chat message; other control characters are not.
    .refine((value) => !/\p{Cc}/u.test(value.replace(/[\n\r\t]/g, '')), {
      message: 'must not contain control characters',
    }),
});

/** Kinds of high-impact deletion, each with its own confirmation. */
const dataDeletion = dto({
  scope: z.enum(['conversations', 'financial_data', 'spreadsheet', 'account']),
  conversationId: z.uuid().optional(),
  spreadsheetId: z.uuid().optional(),
})
  .refine((body) => body.scope === 'conversations' || body.conversationId === undefined, {
    message: 'conversationId only applies to conversations',
    path: ['conversationId'],
  })
  .refine((body) => body.scope === 'spreadsheet' || body.spreadsheetId === undefined, {
    message: 'spreadsheetId only applies to spreadsheet',
    path: ['spreadsheetId'],
  });

const DELETION_TOOLS = {
  conversations: 'delete_conversation_history',
  financial_data: 'delete_financial_data',
  spreadsheet: 'delete_spreadsheet',
  account: 'delete_my_account',
} as const;

const listMessages = dto({ limit: z.coerce.number().int().min(1).max(200).optional() });

/**
 * The conversation API: messages to the assistant, conversation history, and the user's
 * explicit confirmation (or cancellation) of destructive actions. Every route needs the
 * session; writes need CSRF; message sending is rate limited (it calls AI providers).
 */
@Controller('assistant')
export class AssistantController {
  constructor(
    @Inject(AssistantService) private readonly assistant: AssistantService,
    @Inject(ConversationService) private readonly conversations: ConversationService,
    @Inject(ToolRegistry) private readonly registry: ToolRegistry,
    @Inject(ToolExecutor) private readonly executor: ToolExecutor,
  ) {}

  @Post('messages')
  @HttpCode(200)
  @RateLimit({ policy: 'assistant' })
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Body(validate(sendMessage)) body: z.infer<typeof sendMessage>,
  ): Promise<AssistantTurn> {
    return this.assistant.send(user, body);
  }

  @Get('suggestions')
  suggestions(@CurrentUser() user: AuthenticatedUser): Promise<string[]> {
    return this.assistant.suggestions(user);
  }

  @Get('conversations')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.conversations.list(user);
  }

  @Get('conversations/:id/messages')
  async messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Query(validate(listMessages)) query: z.infer<typeof listMessages>,
  ) {
    const rows = await this.conversations.messages(user, id, query.limit);
    return rows.map((row) => {
      const payload = (row.toolPayload ?? {}) as {
        toolCalls?: { name: string }[];
        outcome?: ToolOutcome;
      };
      return {
        id: row.id,
        role: row.role,
        content: row.role === 'TOOL' ? null : row.content,
        provider: row.provider,
        toolName: row.toolName,
        toolCalls: payload.toolCalls?.map((call) => call.name) ?? [],
        toolStatus: payload.outcome?.status ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  @Post('conversations/:id/confirmations/:confirmationId/confirm')
  @HttpCode(200)
  confirmInConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Param('confirmationId', uuidParam) confirmationId: string,
  ): Promise<AssistantTurn> {
    return this.assistant.confirm(user, id, confirmationId);
  }

  @Post('conversations/:id/confirmations/:confirmationId/cancel')
  @HttpCode(200)
  cancelInConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Param('confirmationId', uuidParam) confirmationId: string,
  ): Promise<AssistantTurn> {
    return this.assistant.cancel(user, id, confirmationId);
  }

  /** "Desfazer" outside a conversation (same rules as the assistant tool). */
  @Post('undo')
  @HttpCode(200)
  undo(@CurrentUser() user: AuthenticatedUser): Promise<ToolOutcome> {
    return this.executor.execute(
      { user, conversationId: null },
      { name: 'undo_last_action', arguments: {} },
    );
  }

  /**
   * Asks for a high-impact deletion. Never deletes by itself: it answers with the
   * confirmation (summary, expiry) that the user then confirms or cancels.
   */
  @Post('data-deletions')
  @HttpCode(200)
  requestDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Body(validate(dataDeletion)) body: z.infer<typeof dataDeletion>,
  ): Promise<ToolOutcome> {
    return this.executor.execute(
      { user, conversationId: null },
      {
        name: DELETION_TOOLS[body.scope],
        arguments: {
          ...(body.conversationId ? { conversationId: body.conversationId } : {}),
          ...(body.spreadsheetId ? { spreadsheetId: body.spreadsheetId } : {}),
        },
      },
    );
  }

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
