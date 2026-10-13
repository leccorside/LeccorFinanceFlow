import {
  type AiErrorKind,
  type AiProviderClient,
  type AiProviderClients,
  AiProviderError,
  type ChatRequest,
  type ChatResult,
} from '../../src/ai/ai.types.js';
import type { AIProviderType } from '../../src/generated/prisma/enums.js';

/** What the fake answers next: success, a classified failure, or hang until the timeout. */
export type FakeBehavior = 'ok' | 'hang' | AiErrorKind;

/**
 * Programmable provider: records every call (key included) and answers per `behavior`, or per
 * model through `behaviorOf` (fallback between Gemini models).
 */
export class FakeAiClient implements AiProviderClient {
  calls: { apiKey: string; request: ChatRequest }[] = [];
  behavior: FakeBehavior = 'ok';
  /** Model → behavior; models not listed use `behavior`. */
  behaviorOf: Record<string, FakeBehavior> = {};
  /** Scripted "model": decides tool calls and answers from the request (used when ok). */
  handler: ((request: ChatRequest) => Partial<ChatResult>) | null = null;

  constructor(readonly type: AIProviderType) {}

  async chat(
    apiKey: string,
    request: ChatRequest,
    signal: AbortSignal,
  ): Promise<ChatResult> {
    // A copy, like a real adapter that serializes the request at call time.
    this.calls.push({ apiKey, request: structuredClone(request) });
    const behavior = this.behaviorOf[request.model] ?? this.behavior;
    if (behavior === 'hang') {
      // Like a real adapter whose fetch is aborted by the timeout signal.
      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new AiProviderError('timeout')));
      });
    }
    if (behavior !== 'ok') throw new AiProviderError(behavior as AiErrorKind);
    if (this.handler) {
      const scripted = this.handler(request);
      const toolCalls = scripted.toolCalls ?? [];
      return {
        text: scripted.text ?? null,
        toolCalls,
        finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
        usage: null,
      };
    }
    return {
      text: `resposta de ${this.type} (${request.model})`,
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}

export class FakeAiClients implements AiProviderClients {
  GEMINI = new FakeAiClient('GEMINI');

  reset(): void {
    this.GEMINI.calls = [];
    this.GEMINI.behavior = 'ok';
    this.GEMINI.behaviorOf = {};
    this.GEMINI.handler = null;
  }
}
