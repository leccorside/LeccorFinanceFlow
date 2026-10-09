import type { AIProviderType } from '../generated/prisma/enums.js';

/**
 * Provider-neutral chat contract. Every adapter (OpenAI, Gemini, Anthropic) translates to and
 * from these shapes, so the assistant (PASSO 13/14) never depends on a vendor format.
 */

/** JSON Schema object describing a tool's arguments. */
export type JsonSchema = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolCall {
  /** Provider id of the call (synthetic for providers without ids). */
  id: string;
  name: string;
  /** Parsed JSON arguments; always an object. */
  arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  /** Result of a tool call, as JSON text. `name` is the tool's name (Gemini needs it). */
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ChatRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxOutputTokens?: number;
  temperature?: number;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'other';

export interface ChatResult {
  text: string | null;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export interface AiProviderClient {
  readonly type: AIProviderType;
  /** One request; throws `AiProviderError` with a classified kind on any failure. */
  chat(apiKey: string, request: ChatRequest, signal: AbortSignal): Promise<ChatResult>;
}

/** Adapters by provider type (overridable in tests). */
export const AI_PROVIDER_CLIENTS = Symbol('AI_PROVIDER_CLIENTS');
export type AiProviderClients = Record<AIProviderType, AiProviderClient>;

/**
 * Failure classes. Recoverable ones mean "this provider cannot serve this request now" and
 * allow the next provider; the others mean "the request itself is not acceptable" and would
 * fail the same way anywhere, so they are never hidden behind a provider switch.
 */
export type AiErrorKind =
  // recoverable (fallback)
  | 'timeout'
  | 'unavailable'
  | 'rate_limited'
  | 'credential_rejected'
  | 'model_not_found'
  | 'invalid_response'
  // not recoverable (no fallback)
  | 'invalid_request'
  | 'content_blocked';

const RECOVERABLE = new Set<AiErrorKind>([
  'timeout',
  'unavailable',
  'rate_limited',
  'credential_rejected',
  'model_not_found',
  'invalid_response',
]);

export function isRecoverable(kind: AiErrorKind): boolean {
  return RECOVERABLE.has(kind);
}

export class AiProviderError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    readonly status: number = 0,
  ) {
    // Never the response body nor the request: they may echo user data or keys.
    super(`ai provider ${kind}${status ? ` (${status})` : ''}`);
    this.name = 'AiProviderError';
  }

  get recoverable(): boolean {
    return isRecoverable(this.kind);
  }
}

/** HTTP status → failure class (shared by every adapter). */
export function kindOfStatus(status: number): AiErrorKind {
  if (status === 401 || status === 403) return 'credential_rejected';
  if (status === 404) return 'model_not_found';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable'; // includes Anthropic's 529 "overloaded"
  return 'invalid_request'; // 400, 413, 422…: our request was refused as such
}
