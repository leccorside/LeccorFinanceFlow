import {
  type AiProviderClient,
  AiProviderError,
  type ChatMessage,
  type ChatRequest,
  type ChatResult,
  type FinishReason,
} from '../ai.types.js';
import { argumentsObject, defaultFetch, type Fetch, postJson } from './http.js';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
/** The Messages API requires max_tokens. */
const DEFAULT_MAX_TOKENS = 1024;

interface AnthropicResponse {
  stop_reason?: string;
  content?: {
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

type Block = Record<string, unknown>;

/** Anthropic Messages API (Claude) with tools. */
export class AnthropicClient implements AiProviderClient {
  readonly type = 'ANTHROPIC' as const;

  constructor(private readonly fetchImpl: Fetch = defaultFetch) {}

  async chat(
    apiKey: string,
    request: ChatRequest,
    signal: AbortSignal,
  ): Promise<ChatResult> {
    const body = (await postJson(
      this.fetchImpl,
      ANTHROPIC_URL,
      { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      {
        model: request.model,
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
        ...(request.system ? { system: request.system } : {}),
        messages: toMessages(request.messages),
        ...(request.tools?.length
          ? {
              tools: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters,
              })),
            }
          : {}),
        ...(request.temperature !== undefined
          ? { temperature: request.temperature }
          : {}),
      },
      signal,
    )) as AnthropicResponse;

    if (!Array.isArray(body.content)) throw new AiProviderError('invalid_response');
    if (body.stop_reason === 'refusal') throw new AiProviderError('content_blocked');
    const text = body.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
      .trim();
    const toolCalls = body.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => {
        if (!block.id || !block.name) throw new AiProviderError('invalid_response');
        return {
          id: block.id,
          name: block.name,
          arguments: argumentsObject(block.input),
        };
      });
    const finish: Record<string, FinishReason> = {
      end_turn: 'stop',
      stop_sequence: 'stop',
      tool_use: 'tool_calls',
      max_tokens: 'length',
    };
    return {
      text: text === '' ? null : text,
      toolCalls,
      finishReason: finish[body.stop_reason ?? ''] ?? 'other',
      usage: body.usage
        ? {
            inputTokens: body.usage.input_tokens ?? 0,
            outputTokens: body.usage.output_tokens ?? 0,
          }
        : null,
    };
  }
}

/**
 * Anthropic alternates user/assistant turns; tool results are `tool_result` blocks of a user
 * turn, so consecutive tool messages are merged into one user turn.
 */
function toMessages(messages: ChatMessage[]): { role: string; content: Block[] }[] {
  const result: { role: string; content: Block[] }[] = [];
  const push = (role: 'user' | 'assistant', blocks: Block[]) => {
    const last = result.at(-1);
    if (last && last.role === role) last.content.push(...blocks);
    else result.push({ role, content: blocks });
  };
  for (const message of messages) {
    if (message.role === 'tool') {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: message.content,
        },
      ]);
    } else if (message.role === 'assistant') {
      push('assistant', [
        ...(message.content ? [{ type: 'text', text: message.content }] : []),
        ...(message.toolCalls ?? []).map((call) => ({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.arguments,
        })),
      ]);
    } else {
      push('user', [{ type: 'text', text: message.content }]);
    }
  }
  return result;
}
