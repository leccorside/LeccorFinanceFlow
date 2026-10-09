import {
  type AiErrorKind,
  type AiProviderClient,
  AiProviderError,
  type ChatRequest,
  isRecoverable,
} from '../ai.types.js';
import { ANTHROPIC_URL, ANTHROPIC_VERSION, AnthropicClient } from './anthropic.client.js';
import { GEMINI_URL, GeminiClient, geminiSchema } from './gemini.client.js';
import type { Fetch } from './http.js';
import { OPENAI_URL, OpenAiClient } from './openai.client.js';

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

describe('OpenAiClient', () => {
  it('maps messages, tools and tool results; the key goes only in the header', async () => {
    const { fetchImpl, calls } = fakeFetch(200, {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call-2',
                type: 'function',
                function: { name: 'get_summary', arguments: '{"from":"2026-04-01"}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const result = await new OpenAiClient(fetchImpl).chat(KEY, conversation, signal());

    expect(result).toEqual({
      text: null,
      toolCalls: [
        { id: 'call-2', name: 'get_summary', arguments: { from: '2026-04-01' } },
      ],
      finishReason: 'tool_calls',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const call = calls[0] as Captured;
    expect(call.url).toBe(OPENAI_URL);
    expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(call.body)).not.toContain(KEY);
    expect(call.body).toMatchObject({
      model: 'model-x',
      max_completion_tokens: 200,
      temperature: 0,
      tools: [{ type: 'function', function: { name: 'get_summary' } }],
      messages: [
        { role: 'system', content: 'Você é um assistente financeiro.' },
        { role: 'user', content: 'Quanto gastei?' },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call-1',
              function: { name: 'get_summary', arguments: '{"from":"2026-03-01"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call-1', content: '{"expenses":"87.45"}' },
      ],
    });
  });

  it('classifies refusals, content filters and malformed answers', async () => {
    const run = (body: unknown) =>
      new OpenAiClient(fakeFetch(200, body).fetchImpl).chat(KEY, conversation, signal());
    await expect(
      run({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }),
    ).rejects.toMatchObject({ kind: 'content_blocked' });
    await expect(
      run({ choices: [{ message: { content: null, refusal: 'no' } }] }),
    ).rejects.toMatchObject({ kind: 'content_blocked' });
    await expect(run({ choices: [] })).rejects.toMatchObject({
      kind: 'invalid_response',
    });
    await expect(
      run({
        choices: [
          {
            message: {
              tool_calls: [{ id: 'x', function: { name: 'f', arguments: '{not json' } }],
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
    await expect(
      run({
        choices: [
          {
            message: {
              tool_calls: [{ id: 'x', function: { name: 'f', arguments: '[1]' } }],
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});

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

describe('AnthropicClient', () => {
  it('maps system, tool_use and tool_result blocks with the API version header', async () => {
    const { fetchImpl, calls } = fakeFetch(200, {
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Vou consultar.' },
        { type: 'tool_use', id: 'toolu_1', name: 'get_summary', input: { from: 'y' } },
      ],
      usage: { input_tokens: 4, output_tokens: 2 },
    });
    const result = await new AnthropicClient(fetchImpl).chat(KEY, conversation, signal());
    expect(result).toEqual({
      text: 'Vou consultar.',
      toolCalls: [{ id: 'toolu_1', name: 'get_summary', arguments: { from: 'y' } }],
      finishReason: 'tool_calls',
      usage: { inputTokens: 4, outputTokens: 2 },
    });
    const call = calls[0] as Captured;
    expect(call.url).toBe(ANTHROPIC_URL);
    expect(call.headers['x-api-key']).toBe(KEY);
    expect(call.headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
    expect(call.body).toMatchObject({
      model: 'model-x',
      max_tokens: 200,
      system: 'Você é um assistente financeiro.',
      tools: [{ name: 'get_summary', input_schema: { type: 'object' } }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Quanto gastei?' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'get_summary',
              input: { from: '2026-03-01' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call-1',
              content: '{"expenses":"87.45"}',
            },
          ],
        },
      ],
    });
  });

  it('always sends max_tokens and classifies refusals', async () => {
    const { fetchImpl, calls } = fakeFetch(200, {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
    });
    await new AnthropicClient(fetchImpl).chat(
      KEY,
      { model: 'm', messages: [{ role: 'user', content: 'oi' }] },
      signal(),
    );
    expect(calls[0]?.body.max_tokens).toBe(1024);
    await expect(
      new AnthropicClient(
        fakeFetch(200, { stop_reason: 'refusal', content: [] }).fetchImpl,
      ).chat(KEY, conversation, signal()),
    ).rejects.toMatchObject({ kind: 'content_blocked' });
  });
});

describe('error classification (every adapter)', () => {
  const clients: [string, (fetchImpl: Fetch) => AiProviderClient][] = [
    ['openai', (fetchImpl) => new OpenAiClient(fetchImpl)],
    ['gemini', (fetchImpl) => new GeminiClient(fetchImpl)],
    ['anthropic', (fetchImpl) => new AnthropicClient(fetchImpl)],
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
      new OpenAiClient(hanging).chat(KEY, conversation, AbortSignal.timeout(20)),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});
