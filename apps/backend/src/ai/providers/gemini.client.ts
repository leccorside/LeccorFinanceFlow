import {
  type AiProviderClient,
  AiProviderError,
  type ChatRequest,
  type ChatResult,
  type JsonSchema,
} from '../ai.types.js';
import {
  argumentsObject,
  defaultFetch,
  type Fetch,
  postJson,
  resultObject,
} from './http.js';

export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiPart {
  text?: string;
  functionCall?: { id?: string; name?: string; args?: unknown };
}

interface GeminiResponse {
  candidates?: {
    finishReason?: string;
    content?: { parts?: GeminiPart[] };
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

const BLOCKED = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
]);

/** Gemini accepts an OpenAPI subset: drop JSON Schema keywords it refuses. */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (schema === null || typeof schema !== 'object') return schema;
  return Object.fromEntries(
    Object.entries(schema as JsonSchema)
      .filter(([key]) => !['additionalProperties', '$schema', '$id'].includes(key))
      .map(([key, value]) => [key, geminiSchema(value)]),
  );
}

/** Gemini `generateContent` with function declarations. */
export class GeminiClient implements AiProviderClient {
  readonly type = 'GEMINI' as const;

  constructor(private readonly fetchImpl: Fetch = defaultFetch) {}

  async chat(
    apiKey: string,
    request: ChatRequest,
    signal: AbortSignal,
  ): Promise<ChatResult> {
    const contents = request.messages.map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: message.name,
                response: resultObject(message.content),
              },
            },
          ],
        };
      }
      if (message.role === 'assistant') {
        return {
          role: 'model',
          parts: [
            ...(message.content ? [{ text: message.content }] : []),
            ...(message.toolCalls ?? []).map((call) => ({
              functionCall: { name: call.name, args: call.arguments },
            })),
          ],
        };
      }
      return { role: 'user', parts: [{ text: message.content }] };
    });

    const body = (await postJson(
      this.fetchImpl,
      `${GEMINI_URL}/${encodeURIComponent(request.model)}:generateContent`,
      { 'x-goog-api-key': apiKey },
      {
        contents,
        ...(request.system
          ? { systemInstruction: { parts: [{ text: request.system }] } }
          : {}),
        ...(request.tools?.length
          ? {
              tools: [
                {
                  functionDeclarations: request.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: geminiSchema(tool.parameters),
                  })),
                },
              ],
            }
          : {}),
        generationConfig: {
          ...(request.maxOutputTokens
            ? { maxOutputTokens: request.maxOutputTokens }
            : {}),
          ...(request.temperature !== undefined
            ? { temperature: request.temperature }
            : {}),
        },
      },
      signal,
    )) as GeminiResponse;

    if (body.promptFeedback?.blockReason) throw new AiProviderError('content_blocked');
    const candidate = body.candidates?.[0];
    if (!candidate) throw new AiProviderError('invalid_response');
    if (candidate.finishReason && BLOCKED.has(candidate.finishReason)) {
      throw new AiProviderError('content_blocked');
    }
    const parts = candidate.content?.parts ?? [];
    const text = parts
      .map((part) => part.text ?? '')
      .join('')
      .trim();
    const toolCalls = parts
      .filter((part) => part.functionCall)
      .map((part, index) => {
        const call = part.functionCall as NonNullable<GeminiPart['functionCall']>;
        if (!call.name) throw new AiProviderError('invalid_response');
        return {
          id: call.id ?? `gemini-${index}`,
          name: call.name,
          arguments: argumentsObject(call.args),
        };
      });
    return {
      text: text === '' ? null : text,
      toolCalls,
      finishReason:
        toolCalls.length > 0
          ? 'tool_calls'
          : candidate.finishReason === 'MAX_TOKENS'
            ? 'length'
            : candidate.finishReason === 'STOP' || !candidate.finishReason
              ? 'stop'
              : 'other',
      usage: body.usageMetadata
        ? {
            inputTokens: body.usageMetadata.promptTokenCount ?? 0,
            outputTokens: body.usageMetadata.candidatesTokenCount ?? 0,
          }
        : null,
    };
  }
}
