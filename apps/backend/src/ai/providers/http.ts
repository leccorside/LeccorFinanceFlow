import { AiProviderError, kindOfStatus } from '../ai.types.js';

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export const defaultFetch: Fetch = (url, init) => fetch(url, init);

/**
 * Sends one request and returns the successful response. Network failures, timeouts (the
 * caller's AbortSignal) and HTTP errors become a classified AiProviderError; the body of an
 * error response is discarded, never read into the error.
 */
export async function send(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, redirect: 'error', signal });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    throw new AiProviderError(
      name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unavailable',
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new AiProviderError(kindOfStatus(response.status), response.status);
  }
  return response;
}

/** POSTs JSON and returns the parsed body (non-JSON answers are `invalid_response`). */
export async function postJson(
  fetchImpl: Fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await send(
    fetchImpl,
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    },
    signal,
  );
  return readJson(response);
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AiProviderError('invalid_response', response.status);
  }
}

/** Tool arguments must be a JSON object; anything else is a malformed provider answer. */
export function argumentsObject(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = value.trim() === '' ? {} : JSON.parse(value);
    } catch {
      throw new AiProviderError('invalid_response');
    }
  }
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AiProviderError('invalid_response');
  }
  return parsed as Record<string, unknown>;
}

/** Parses a tool result (JSON text) for providers that want an object. */
export function resultObject(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { result: parsed };
  } catch {
    return { result: content };
  }
}
