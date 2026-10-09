import {
  type AiProviderClient,
  AiProviderError,
  type ChatRequest,
  type ChatResult,
  type FinishReason,
} from '../ai.types.js';
import { argumentsObject, defaultFetch, type Fetch, postJson } from './http.js';

export const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

interface OpenAiResponse {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      refusal?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** OpenAI Chat Completions with function tools. */
export class OpenAiClient implements AiProviderClient {
  readonly type = 'OPENAI' as const;

  constructor(private readonly fetchImpl: Fetch = defaultFetch) {}

  async chat(
    apiKey: string,
    request: ChatRequest,
    signal: AbortSignal,
  ): Promise<ChatResult> {
    const messages: Record<string, unknown>[] = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    for (const message of request.messages) {
      if (message.role === 'tool') {
        messages.push({
          role: 'tool',
          tool_call_id: message.toolCallId,
          content: message.content,
        });
      } else if (message.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: message.content,
          ...(message.toolCalls?.length
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: 'function',
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.arguments),
                  },
                })),
              }
            : {}),
        });
      } else {
        messages.push({ role: 'user', content: message.content });
      }
    }

    const body = (await postJson(
      this.fetchImpl,
      OPENAI_URL,
      { authorization: `Bearer ${apiKey}` },
      {
        model: request.model,
        messages,
        ...(request.tools?.length
          ? {
              tools: request.tools.map((tool) => ({
                type: 'function',
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
            }
          : {}),
        ...(request.maxOutputTokens
          ? { max_completion_tokens: request.maxOutputTokens }
          : {}),
        ...(request.temperature !== undefined
          ? { temperature: request.temperature }
          : {}),
      },
      signal,
    )) as OpenAiResponse;

    const choice = body.choices?.[0];
    if (!choice?.message) throw new AiProviderError('invalid_response');
    if (choice.finish_reason === 'content_filter' || choice.message.refusal) {
      throw new AiProviderError('content_blocked');
    }
    const toolCalls = (choice.message.tool_calls ?? []).map((call, index) => {
      if (!call.function?.name) throw new AiProviderError('invalid_response');
      return {
        id: call.id ?? `openai-${index}`,
        name: call.function.name,
        arguments: argumentsObject(call.function.arguments),
      };
    });
    const finish: Record<string, FinishReason> = {
      stop: 'stop',
      tool_calls: 'tool_calls',
      length: 'length',
    };
    return {
      text: choice.message.content ?? null,
      toolCalls,
      finishReason: finish[choice.finish_reason ?? ''] ?? 'other',
      usage: body.usage
        ? {
            inputTokens: body.usage.prompt_tokens ?? 0,
            outputTokens: body.usage.completion_tokens ?? 0,
          }
        : null,
    };
  }
}
