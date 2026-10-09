import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type AiChatOutcome, AiService } from '../ai/ai.service.js';
import type { ChatMessage, ChatRequest } from '../ai/ai.types.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ApiException, ResourceNotFoundException } from '../common/errors/api-error.js';
import { ownedBy } from '../common/security/ownership.js';
import { PrismaService } from '../database/prisma.service.js';
import { formatCalendarDate, todayIn } from '../finance/dates.js';
import { userSettings } from '../finance/user-settings.js';
import type { AIProviderType, AIPurpose } from '../generated/prisma/enums.js';
import { type LocaleTag, toLocaleTag } from '../profile/profile.schemas.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  confirmedText,
  groundingCorrection,
  systemPrompt,
  texts,
} from './assistant.messages.js';
import { ConversationService } from './conversation.service.js';
import { groundedSet, numbersIn, numbersInText, ungroundedValues } from './grounding.js';
import { IntentService } from './intent.service.js';
import { ToolExecutor } from './tools/tool-executor.js';
import { ToolRegistry } from './tools/tool-registry.js';
import {
  type SyncState,
  type ToolContext,
  type ToolOutcome,
  toModelContent,
} from './tools/tool.types.js';
import type { ReportResponse } from '../reports/reports.service.js';

/** Model ↔ tools round trips per user message. */
export const MAX_STEPS = 6;
/** Tool calls executed per model step (extra calls are refused). */
export const MAX_CALLS_PER_STEP = 5;
const MAX_OUTPUT_TOKENS = 1024;

export type TurnState =
  'answered' | 'needs_confirmation' | 'needs_clarification' | 'error';

export interface TurnAction {
  tool: string;
  status: ToolOutcome['status'];
  error?: string;
  sync?: SyncState;
}

export interface AssistantTurn {
  conversationId: string;
  state: TurnState;
  reply: {
    id: string;
    content: string;
    provider: AIProviderType | null;
    createdAt: string;
  };
  actions: TurnAction[];
  /** Destructive actions waiting for the user (confirm through the API, never the model). */
  confirmations: {
    id: string;
    tool: string;
    summary: Record<string, unknown>;
    expiresAt: string;
  }[];
  /** Options when a request matched several records. */
  candidates: Record<string, unknown>[];
  suggestions: string[];
  /** Files produced in the turn (reports), with their download link. */
  attachments: TurnAttachment[];
  error?: { code: string };
}

export interface TurnAttachment {
  kind: 'report';
  id: string;
  fileName: string;
  format: string;
  url: string;
  expiresAt: string;
}

type User = Pick<AuthenticatedUser, 'id' | 'email' | 'roles'>;

/**
 * One turn of the conversation: the model interprets the message and calls registered tools
 * (through the executor, with the session user); the answer is accepted only when every
 * amount it states is backed by tool results. Provider or loop failures end in a fixed,
 * localized answer, never in an invented one.
 */
@Injectable()
export class AssistantService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiService) private readonly ai: AiService,
    @Inject(ToolRegistry) private readonly registry: ToolRegistry,
    @Inject(ToolExecutor) private readonly executor: ToolExecutor,
    @Inject(ConversationService) private readonly conversations: ConversationService,
    @Inject(IntentService) private readonly intents: IntentService,
    @Inject(SettingsService) private readonly settingsService: SettingsService,
  ) {}

  async send(
    user: User,
    input: { conversationId?: string | undefined; message: string },
  ): Promise<AssistantTurn> {
    if (!(await this.settingsService.get('assistant.enabled'))) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'assistant_disabled',
        'O assistente está em pausa pela administração. Tente mais tarde.',
      );
    }
    const settings = await userSettings(this.prisma, user.id);
    const profileLocale = toLocaleTag(settings.locale);
    const intent = this.intents.classify(input.message);
    const language = intent.language ?? profileLocale;
    const conversation = input.conversationId
      ? await this.conversations.findOwned(user, input.conversationId)
      : await this.conversations.create(user, settings.locale, input.message);
    await this.conversations.addUser(conversation.id, input.message);

    const ctx: ToolContext = { user, conversationId: conversation.id };
    const history = await this.conversations.history(conversation.id);
    const context = await this.conversations.revalidated(
      user,
      conversation,
      settings.locale,
    );
    const system = systemPrompt({
      today: formatCalendarDate(todayIn(settings.timeZone)),
      timeZone: settings.timeZone,
      currency: settings.currency,
      locale: profileLocale,
      context: JSON.stringify(context),
    });
    const tools = this.registry.definitionsFor({ user });
    const messages: ChatMessage[] = [...history.messages];
    const grounding = [...history.numbers, ...numbersInText(input.message)];

    const turn = new TurnBuilder(conversation.id, language);
    let corrected = false;

    for (let step = 0; step < MAX_STEPS; step += 1) {
      let outcome: AiChatOutcome;
      try {
        outcome = await this.callModel(intent.purpose, {
          system,
          messages,
          tools,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        });
      } catch (error) {
        return this.fail(turn, aiErrorCode(error));
      }
      const { result, provider } = outcome;

      if (result.toolCalls.length > 0) {
        const calls = result.toolCalls.slice(0, MAX_CALLS_PER_STEP);
        await this.conversations.addAssistant(conversation.id, result.text, provider, {
          toolCalls: calls,
        });
        messages.push({ role: 'assistant', content: result.text, toolCalls: calls });
        for (const call of calls) {
          const toolOutcome = await this.executor.execute(ctx, {
            name: call.name,
            arguments: call.arguments,
          });
          await this.conversations.addTool(
            conversation.id,
            call.id,
            call.name,
            toolOutcome,
          );
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: toModelContent(toolOutcome),
          });
          numbersIn(toolOutcome, grounding);
          turn.record(toolOutcome);
          await this.conversations.remember(conversation, call, toolOutcome);
        }
        continue;
      }

      const text = (result.text ?? '').trim();
      if (!text) return this.fail(turn, 'ai_request_rejected');
      const ungrounded = ungroundedValues(text, groundedSet(grounding));
      if (ungrounded.length > 0) {
        if (corrected) return this.fail(turn, 'ungrounded_numbers');
        corrected = true;
        // Transient correction: not stored, only sent back to the model once.
        messages.push({ role: 'assistant', content: text });
        messages.push({ role: 'user', content: groundingCorrection(ungrounded) });
        continue;
      }
      const reply = await this.conversations.addAssistant(
        conversation.id,
        text,
        provider,
      );
      return turn.build(reply, provider);
    }
    return this.fail(turn, 'too_many_steps');
  }

  /** The user's "yes" to a pending action of this conversation; the answer is deterministic. */
  async confirm(
    user: User,
    conversationId: string,
    confirmationId: string,
  ): Promise<AssistantTurn> {
    const { conversation, locale } = await this.pendingOf(
      user,
      conversationId,
      confirmationId,
    );
    const turn = new TurnBuilder(conversation.id, locale);
    let outcome: ToolOutcome;
    try {
      outcome = await this.executor.confirm(
        { user, conversationId: conversation.id },
        confirmationId,
      );
    } catch (error) {
      const code = error instanceof HttpException ? codeOf(error) : '';
      const message = texts(locale).confirmationProblem[code];
      if (!message) throw error;
      const reply = await this.conversations.addAssistant(conversation.id, message, null);
      return turn.fail(reply, code);
    }
    turn.record(outcome);
    const content =
      outcome.status === 'ok'
        ? confirmedText(
            locale,
            outcome.tool,
            (outcome.data ?? {}) as Record<string, unknown>,
          )
        : texts(locale).actionFailed(
            outcome.status === 'error' ? outcome.message : texts(locale).rejected,
          );
    // The confirmed action may have deleted this very conversation (or the whole account):
    // then the answer is returned but there is nowhere left to store it.
    const stillThere = await this.prisma.conversation.count({
      where: { id: conversation.id },
    });
    const reply = stillThere
      ? await this.conversations.addAssistant(conversation.id, content, null, {
          payload: { confirmation: { id: confirmationId, outcome } },
        })
      : { id: '', content, createdAt: new Date() };
    return outcome.status === 'ok'
      ? turn.build(reply, null)
      : turn.fail(reply, errorOf(outcome));
  }

  async cancel(
    user: User,
    conversationId: string,
    confirmationId: string,
  ): Promise<AssistantTurn> {
    const { conversation, locale } = await this.pendingOf(
      user,
      conversationId,
      confirmationId,
    );
    await this.executor.cancel({ user, conversationId: conversation.id }, confirmationId);
    const reply = await this.conversations.addAssistant(
      conversation.id,
      texts(locale).canceled,
      null,
    );
    return new TurnBuilder(conversation.id, locale).build(reply, null);
  }

  async suggestions(user: User): Promise<string[]> {
    const settings = await userSettings(this.prisma, user.id);
    return texts(toLocaleTag(settings.locale)).suggestions;
  }

  /** The chosen purpose, then CHAT when that purpose has no configured provider. */
  private async callModel(
    purpose: AIPurpose,
    request: Omit<ChatRequest, 'model'>,
  ): Promise<AiChatOutcome> {
    try {
      return await this.ai.chat(purpose, request);
    } catch (error) {
      if (purpose !== 'CHAT' && aiErrorCode(error) === 'ai_not_configured') {
        return this.ai.chat('CHAT', request);
      }
      throw error;
    }
  }

  private async fail(turn: TurnBuilder, code: string): Promise<AssistantTurn> {
    const words = texts(turn.locale);
    const content =
      {
        ai_unavailable: words.unavailable,
        ai_not_configured: words.notConfigured,
        ai_content_blocked: words.blocked,
        too_many_steps: words.tooManySteps,
        ungrounded_numbers: words.ungrounded,
      }[code] ?? words.rejected;
    const reply = await this.conversations.addAssistant(
      turn.conversationId,
      content,
      null,
      {
        payload: { error: code },
      },
    );
    return turn.fail(reply, code);
  }

  private async pendingOf(user: User, conversationId: string, confirmationId: string) {
    const conversation = await this.conversations.findOwned(user, conversationId);
    const pending = await this.prisma.assistantConfirmation.findFirst({
      where: { id: confirmationId, ...ownedBy(user), conversationId: conversation.id },
      select: { id: true },
    });
    if (!pending) throw new ResourceNotFoundException();
    const settings = await userSettings(this.prisma, user.id);
    return { conversation, locale: toLocaleTag(settings.locale) };
  }
}

/** Accumulates what happened in a turn and decides its state. */
class TurnBuilder {
  private readonly actions: TurnAction[] = [];
  private readonly confirmations: AssistantTurn['confirmations'] = [];
  private readonly candidates: Record<string, unknown>[] = [];
  private readonly attachments: TurnAttachment[] = [];
  private lastTool: string | null = null;

  constructor(
    readonly conversationId: string,
    readonly locale: LocaleTag,
  ) {}

  record(outcome: ToolOutcome): void {
    this.lastTool = outcome.tool;
    this.actions.push({
      tool: outcome.tool,
      status: outcome.status,
      ...(outcome.status === 'error' || outcome.status === 'rejected'
        ? { error: outcome.error }
        : {}),
      ...(outcome.status === 'ok' && outcome.sync ? { sync: outcome.sync } : {}),
    });
    if (outcome.status === 'confirmation_required') {
      this.confirmations.push({ tool: outcome.tool, ...outcome.confirmation });
    }
    if (outcome.status === 'ambiguous') this.candidates.push(...outcome.candidates);
    if (outcome.status === 'ok' && outcome.tool === 'generate_report') {
      const report = outcome.data as Partial<ReportResponse>;
      if (report.id && report.fileName && report.downloadUrl && report.expiresAt) {
        this.attachments.push({
          kind: 'report',
          id: report.id,
          fileName: report.fileName,
          format: String(report.format),
          url: report.downloadUrl,
          expiresAt: report.expiresAt,
        });
      }
    }
  }

  build(
    reply: { id: string; content: string; createdAt: Date },
    provider: AIProviderType | null,
  ): AssistantTurn {
    const state: TurnState =
      this.confirmations.length > 0
        ? 'needs_confirmation'
        : this.candidates.length > 0
          ? 'needs_clarification'
          : 'answered';
    return this.result(state, reply, provider);
  }

  fail(
    reply: { id: string; content: string; createdAt: Date },
    code: string,
  ): AssistantTurn {
    return { ...this.result('error', reply, null), error: { code } };
  }

  private result(
    state: TurnState,
    reply: { id: string; content: string; createdAt: Date },
    provider: AIProviderType | null,
  ): AssistantTurn {
    const words = texts(this.locale);
    return {
      conversationId: this.conversationId,
      state,
      reply: {
        id: reply.id,
        content: reply.content,
        provider,
        createdAt: reply.createdAt.toISOString(),
      },
      actions: this.actions,
      confirmations: this.confirmations,
      candidates: this.candidates,
      attachments: this.attachments,
      suggestions:
        (this.lastTool ? words.followUps[this.lastTool] : undefined) ?? words.suggestions,
    };
  }
}

function codeOf(error: HttpException): string {
  const body = error.getResponse();
  return typeof body === 'object' && body !== null && 'code' in body
    ? String((body as { code: unknown }).code)
    : '';
}

/** AI failures are answered in the conversation; anything else is a real error. */
function aiErrorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const code = codeOf(error);
    if (code.startsWith('ai_')) return code;
  }
  throw error;
}

function errorOf(outcome: ToolOutcome): string {
  return outcome.status === 'error' || outcome.status === 'rejected'
    ? outcome.error
    : 'error';
}
