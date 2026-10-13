import {
  type AiErrorKind,
  type AiProviderClient,
  AiProviderError,
  type ChatRequest,
  isRecoverable,
} from '../ai.types.js';
import { GEMINI_URL, GeminiClient, geminiSchema } from './gemini.client.js';
import type { Fetch } from './http.js';

const KEY = 'sk-test-SECRET-key-123';

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(status: number, response: unknown, raw = false) {
  const calls: Captured[] = [];
  const fetchImpl: Fetch = async (url, init) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    return new Response(raw ? String(response) : JSON.stringify(response), { status });
  };
  return { fetchImpl, calls };
}

const signal = () => new AbortController().signal;

/** A conversation with a tool round-trip, as the assistant will send it. */
const conversation: ChatRequest = {
  model: 'model-x',
  system: 'Você é um assistente financeiro.',
  maxOutputTokens: 200,
  temperature: 0,
  tools: [
    {
      name: 'get_summary',
      description: 'Resumo do período',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string' } },
        required: ['from'],
        additionalProperties: false,
      },
    },
  ],
  messages: [
    { role: 'user', content: 'Quanto gastei?' },
    {
      role: 'assistant',
      content: null,
      toolCalls: [
        { id: 'call-1', name: 'get_summary', arguments: { from: '2026-03-01' } },
      ],
    },
    {
      role: 'tool',
      toolCallId: 'call-1',
      name: 'get_summary',
      content: '{"expenses":"87.45"}',
    },
  ],
};

describe('GeminiClient', () => {
  it('maps contents, function declarations and function responses', async () => {
    const { fetchImpl, calls } = fakeFetch(200, {
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: 'Você gastou ' }, { text: 'R$ 87,45.' }] },
        },
      ],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
    });
    const result = await new GeminiClient(fetchImpl).chat(KEY, conversation, signal());
    expect(result).toEqual({
      text: 'Você gastou R$ 87,45.',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 7, outputTokens: 3 },
    });
    const call = calls[0] as Captured;
    expect(call.url).toBe(`${GEMINI_URL}/model-x:generateContent`);
    expect(call.url).not.toContain(KEY); // never in the query string
    expect(call.headers['x-goog-api-key']).toBe(KEY);
    expect(call.body).toMatchObject({
      systemInstruction: { parts: [{ text: 'Você é um assistente financeiro.' }] },
      generationConfig: { maxOutputTokens: 200, temperature: 0 },
      contents: [
        { role: 'user', parts: [{ text: 'Quanto gastei?' }] },
        {
          role: 'model',
          parts: [
            { functionCall: { name: 'get_summary', args: { from: '2026-03-01' } } },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: { name: 'get_summary', response: { expenses: '87.45' } },
            },
          ],
        },
      ],
    });
    const declaration = (
      call.body.tools as { functionDeclarations: { parameters: object }[] }[]
    )[0]?.functionDeclarations[0];
    expect(declaration?.parameters).not.toHaveProperty('additionalProperties');
  });

  it('returns function calls with synthetic ids and classifies safety blocks', async () => {
    const calls = await new GeminiClient(
      fakeFetch(200, {
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [{ functionCall: { name: 'get_summary', args: { from: 'x' } } }],
            },
          },
        ],
      }).fetchImpl,
    ).chat(KEY, conversation, signal());
    expect(calls.toolCalls).toEqual([
      { id: 'gemini-0', name: 'get_summary', arguments: { from: 'x' } },
    ]);
    expect(calls.finishReason).toBe('tool_calls');

    const run = (body: unknown) =>
      new GeminiClient(fakeFetch(200, body).fetchImpl).chat(KEY, conversation, signal());
    await expect(
      run({ promptFeedback: { blockReason: 'SAFETY' } }),
    ).rejects.toMatchObject({
      kind: 'content_blocked',
    });
    await expect(
      run({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }),
    ).rejects.toMatchObject({ kind: 'content_blocked' });
    await expect(run({})).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('strips JSON Schema keywords Gemini refuses, recursively', () => {
    expect(
      geminiSchema({
        $schema: 'x',
        type: 'object',
        additionalProperties: false,
        properties: { a: { type: 'object', additionalProperties: false } },
      }),
    ).toEqual({ type: 'object', properties: { a: { type: 'object' } } });
  });
});

describe('error classification', () => {
  const clients: [string, (fetchImpl: Fetch) => AiProviderClient][] = [
    ['gemini', (fetchImpl) => new GeminiClient(fetchImpl)],
  ];
  const matrix: [number, AiErrorKind, boolean][] = [
    [400, 'invalid_request', false],
    [401, 'credential_rejected', true],
    [403, 'credential_rejected', true],
    [404, 'model_not_found', true],
    [408, 'timeout', true],
    [413, 'invalid_request', false],
    [422, 'invalid_request', false],
    [429, 'rate_limited', true],
    [500, 'unavailable', true],
    [503, 'unavailable', true],
    [529, 'unavailable', true],
  ];

  it.each(
    clients.flatMap(([name, make]) =>
      matrix.map(
        ([status, kind, recoverable]) => [name, status, kind, recoverable, make] as const,
      ),
    ),
  )(
    '%s: HTTP %i → %s (recoverable: %s), without leaking',
    async (_, status, kind, recoverable, make) => {
      const body = { error: { message: `echo ${KEY} and the prompt "Quanto gastei?"` } };
      const failure = make(fakeFetch(status, body).fetchImpl).chat(
        KEY,
        conversation,
        signal(),
      );
      await expect(failure).rejects.toBeInstanceOf(AiProviderError);
      const error = (await failure.catch((caught: unknown) => caught)) as AiProviderError;
      expect(error.kind).toBe(kind);
      expect(error.recoverable).toBe(recoverable);
      expect(isRecoverable(kind)).toBe(recoverable);
      expect(error.message).not.toContain(KEY);
      expect(error.message).not.toContain('Quanto');
      expect(JSON.stringify(error)).not.toContain(KEY);
    },
  );

  it.each(clients)('%s: network failure, timeout and non-JSON body', async (_, make) => {
    const offline = make(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(offline.chat(KEY, conversation, signal())).rejects.toMatchObject({
      kind: 'unavailable',
    });
    const slow = make(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    await expect(slow.chat(KEY, conversation, signal())).rejects.toMatchObject({
      kind: 'timeout',
    });
    const html = make(fakeFetch(200, '<html>oops</html>', true).fetchImpl);
    await expect(html.chat(KEY, conversation, signal())).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('really aborts a slow provider with the timeout signal', async () => {
    const hanging: Fetch = (_, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject((init.signal as AbortSignal).reason as Error),
        );
      });
    await expect(
      new GeminiClient(hanging).chat(KEY, conversation, AbortSignal.timeout(20)),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});
