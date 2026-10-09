import { Inject, Injectable } from '@nestjs/common';
import type { ChatMessage, ToolCall } from '../ai/ai.types.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ResourceNotFoundException } from '../common/errors/api-error.js';
import { ownedBy } from '../common/security/ownership.js';
import { PrismaService } from '../database/prisma.service.js';
import { displayName } from '../finance/categories.service.js';
import type {
  AIProviderType,
  AppLocale,
  Conversation,
  ConversationMessage,
  Prisma,
} from '../generated/prisma/client.js';
import { numbersIn } from './grounding.js';
import { fold } from './tools/resolvers.js';
import { toModelContent, type ToolOutcome } from './tools/tool.types.js';

type User = Pick<AuthenticatedUser, 'id'>;

/** How many stored messages are sent back to the model. */
export const HISTORY_LIMIT = 30;
/** Tool results bigger than this are summarized in the history (keeps requests bounded). */
const MAX_TOOL_CONTENT = 12_000;

/**
 * Structured, safe memory of a conversation: references the user can follow up on ("e no mês
 * passado?", "qual delas é a maior?"). Built only from validated tool calls, never from free
 * text, and revalidated against the database before each use.
 */
export interface ConversationContext {
  period?: { from: string; to: string };
  categoryId?: string;
  categoryName?: string;
  accountId?: string;
  lastTool?: string;
  /** Ids returned by the last listing/search (max 10). */
  lastResultIds?: string[];
}

export interface StoredHistory {
  messages: ChatMessage[];
  /** Numbers from the tool results in the window (grounding of follow-up answers). */
  numbers: number[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ConversationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(
    user: User,
    locale: AppLocale,
    firstMessage: string,
  ): Promise<Conversation> {
    const spreadsheet = await this.prisma.spreadsheet.findFirst({
      where: { ...ownedBy(user), isActive: true, status: 'ACTIVE' },
      select: { id: true },
    });
    return this.prisma.conversation.create({
      data: {
        ownerId: user.id,
        spreadsheetId: spreadsheet?.id ?? null,
        locale,
        title: firstMessage.replace(/\s+/g, ' ').trim().slice(0, 80) || null,
        contextSummary: {},
      },
    });
  }

  async findOwned(user: User, id: string): Promise<Conversation> {
    const row = await this.prisma.conversation.findFirst({
      where: { id, ...ownedBy(user) },
    });
    if (!row) throw new ResourceNotFoundException();
    return row;
  }

  list(user: User) {
    return this.prisma.conversation.findMany({
      where: ownedBy(user),
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  async messages(user: User, id: string, limit = 100): Promise<ConversationMessage[]> {
    await this.findOwned(user, id);
    const rows = await this.prisma.conversationMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.reverse();
  }

  addUser(conversationId: string, content: string): Promise<ConversationMessage> {
    return this.add(conversationId, { role: 'USER', content });
  }

  addAssistant(
    conversationId: string,
    content: string | null,
    provider: AIProviderType | null,
    extra: { toolCalls?: ToolCall[]; payload?: Record<string, unknown> } = {},
  ): Promise<ConversationMessage> {
    return this.add(conversationId, {
      role: 'ASSISTANT',
      content: content ?? '',
      provider,
      ...(extra.toolCalls?.length || extra.payload
        ? {
            toolPayload: {
              ...(extra.payload ?? {}),
              ...(extra.toolCalls?.length ? { toolCalls: extra.toolCalls } : {}),
            } as Prisma.InputJsonValue,
          }
        : {}),
    });
  }

  addTool(
    conversationId: string,
    toolCallId: string,
    toolName: string,
    outcome: ToolOutcome,
  ): Promise<ConversationMessage> {
    let content = toModelContent(outcome);
    if (content.length > MAX_TOOL_CONTENT) {
      content = toModelContent({
        status: 'error',
        tool: outcome.tool,
        error: 'result_too_large',
        message:
          'Resultado grande demais; refine a consulta (período menor, filtros ou limite).',
      });
    }
    return this.add(conversationId, {
      role: 'TOOL',
      content,
      toolName: toolName.slice(0, 100),
      toolPayload: { toolCallId, outcome } as unknown as Prisma.InputJsonValue,
    });
  }

  /**
   * The latest messages as model input. The window starts at a user message so a tool result
   * is never sent without the assistant call that produced it (providers reject that).
   */
  async history(conversationId: string): Promise<StoredHistory> {
    const rows = (
      await this.prisma.conversationMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
      })
    ).reverse();
    const start = rows.findIndex((row) => row.role === 'USER');
    const window = start < 0 ? [] : rows.slice(start);
    const messages: ChatMessage[] = [];
    const numbers: number[] = [];
    for (const row of window) {
      const payload = (row.toolPayload ?? {}) as {
        toolCalls?: ToolCall[];
        toolCallId?: string;
        outcome?: ToolOutcome;
      };
      if (row.role === 'USER') {
        messages.push({ role: 'user', content: row.content });
      } else if (row.role === 'ASSISTANT') {
        messages.push({
          role: 'assistant',
          content: row.content || null,
          ...(payload.toolCalls?.length ? { toolCalls: payload.toolCalls } : {}),
        });
      } else if (payload.toolCallId) {
        messages.push({
          role: 'tool',
          toolCallId: payload.toolCallId,
          name: row.toolName ?? '',
          content: row.content,
        });
        numbersIn(payload.outcome, numbers);
      }
    }
    return { messages, numbers };
  }

  /** Records what a successful tool call referred to (period, category, results). */
  async remember(
    conversation: Pick<Conversation, 'id' | 'contextSummary'>,
    call: ToolCall,
    outcome: ToolOutcome,
  ): Promise<ConversationContext> {
    const context = { ...((conversation.contextSummary ?? {}) as ConversationContext) };
    if (outcome.status !== 'ok') return context;
    const args = call.arguments;
    const from = args.from ?? (args.match as Record<string, unknown> | undefined)?.from;
    const to = args.to ?? (args.match as Record<string, unknown> | undefined)?.to;
    if (
      typeof from === 'string' &&
      typeof to === 'string' &&
      DATE.test(from) &&
      DATE.test(to)
    ) {
      context.period = { from, to };
    }
    if (typeof args.categoryId === 'string' && UUID.test(args.categoryId)) {
      context.categoryId = args.categoryId;
      delete context.categoryName;
    } else if (typeof args.categoryName === 'string') {
      context.categoryName = args.categoryName.slice(0, 100);
      delete context.categoryId;
    }
    if (typeof args.accountId === 'string' && UUID.test(args.accountId)) {
      context.accountId = args.accountId;
    }
    context.lastTool = outcome.tool;
    const ids = resultIds(outcome.data);
    if (ids.length > 0) context.lastResultIds = ids;
    conversation.contextSummary = context as Prisma.JsonValue;
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { contextSummary: context as Prisma.InputJsonValue },
    });
    return context;
  }

  /** The stored context with every reference re-checked against the user's own data. */
  async revalidated(
    user: User,
    conversation: Pick<Conversation, 'contextSummary'>,
    locale: AppLocale,
  ): Promise<ConversationContext> {
    const stored = (conversation.contextSummary ?? {}) as ConversationContext;
    const context: ConversationContext = {};
    if (stored.period && DATE.test(stored.period.from) && DATE.test(stored.period.to)) {
      context.period = { from: stored.period.from, to: stored.period.to };
    }
    const categories = await this.prisma.category.findMany({
      where: { OR: [{ ownerId: null }, ownedBy(user)], isArchived: false },
      select: { id: true, name: true, systemKey: true },
    });
    const category = stored.categoryId
      ? categories.find((item) => item.id === stored.categoryId)
      : stored.categoryName
        ? categories.find(
            (item) => fold(displayName(item, locale)) === fold(stored.categoryName ?? ''),
          )
        : undefined;
    if (category) {
      context.categoryId = category.id;
      context.categoryName = displayName(category, locale);
    }
    if (
      stored.accountId &&
      (await this.prisma.financialAccount.count({
        where: { id: stored.accountId, ...ownedBy(user) },
      }))
    ) {
      context.accountId = stored.accountId;
    }
    if (stored.lastTool) context.lastTool = stored.lastTool;
    const ids = (stored.lastResultIds ?? []).filter((id) => UUID.test(id)).slice(0, 10);
    if (ids.length > 0) {
      const where = { id: { in: ids }, ...ownedBy(user) };
      const found = await Promise.all([
        this.prisma.transaction.findMany({ where, select: { id: true } }),
        this.prisma.financialAccount.findMany({ where, select: { id: true } }),
        this.prisma.investment.findMany({ where, select: { id: true } }),
        this.prisma.installment.findMany({ where, select: { id: true } }),
        this.prisma.recurringTransaction.findMany({ where, select: { id: true } }),
      ]);
      const owned = new Set(found.flat().map((row) => row.id));
      const kept = ids.filter((id) => owned.has(id));
      if (kept.length > 0) context.lastResultIds = kept;
    }
    return context;
  }

  private async add(
    conversationId: string,
    data: Omit<Prisma.ConversationMessageUncheckedCreateInput, 'conversationId'>,
  ): Promise<ConversationMessage> {
    return this.prisma.$transaction(async (tx) => {
      // Strictly increasing timestamps per conversation: a tool call and its result written
      // in the same millisecond must still be read back in order.
      const last = await tx.conversationMessage.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const now = Date.now();
      const createdAt = new Date(
        last && last.createdAt.getTime() >= now ? last.createdAt.getTime() + 1 : now,
      );
      const message = await tx.conversationMessage.create({
        data: { ...data, conversationId, createdAt },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      return message;
    });
  }
}

/** Ids from a listing/search result: `items[].id`, an array of `{ id }`, or `parcels`. */
function resultIds(data: unknown): string[] {
  const list = Array.isArray(data)
    ? data
    : data &&
        typeof data === 'object' &&
        Array.isArray((data as { items?: unknown }).items)
      ? (data as { items: unknown[] }).items
      : [];
  return list
    .map((item) =>
      item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined,
    )
    .filter((id): id is string => typeof id === 'string' && UUID.test(id))
    .slice(0, 10);
}
