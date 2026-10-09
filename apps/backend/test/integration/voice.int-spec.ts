import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { ChatRequest, ToolCall } from '../../src/ai/ai.types.js';
import { seedDatabase } from '../../src/database/seed.js';
import {
  createDisposableDatabase,
  type DisposableDatabase,
} from './disposable-database.js';
import { FakeAiClients } from './fake-ai.js';
import { FakeVoiceClients } from './fake-voice.js';
import { createTestApp, FakeGoogle, loginAs, type Session, testEnv } from './support.js';

let db: DisposableDatabase;
let app: NestExpressApplication;
let google: FakeGoogle;
let ai: FakeAiClients;
let voice: FakeVoiceClients;

interface Actor extends Session {
  id: string;
}

const WEBM = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.alloc(2048, 7),
]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(512, 3)]);
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x20]),
  Buffer.from('ftypM4A '),
  Buffer.alloc(512, 1),
]);

let sequence = 0;
async function newUser(): Promise<Actor> {
  sequence += 1;
  const email = `voice${sequence}@example.com`;
  const session = await loginAs(app, google, { subject: `voice-${sequence}`, email });
  const user = await db.client.user.findUniqueOrThrow({ where: { email } });
  return { ...session, id: user.id };
}

function http(
  target: NestExpressApplication,
  actor: Actor | null,
  method: 'get' | 'post' | 'patch',
  path: string,
  csrf = true,
) {
  const req = request(target.getHttpServer())[method](`/api/v1${path}`);
  if (actor) {
    req.set('Cookie', actor.cookie);
    if (method !== 'get' && csrf) req.set('X-CSRF-Token', actor.csrf);
  }
  return req;
}

function upload(actor: Actor, audio: Buffer, type: string, target = app) {
  return http(target, actor, 'post', '/voice/transcriptions')
    .set('Content-Type', type)
    .send(audio);
}

/** Binary responses come back as Buffers. */
function binary(
  res: request.Response,
  callback: (error: Error | null, body: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

let callCounter = 0;
const call = (name: string, args: Record<string, unknown>): ToolCall => {
  callCounter += 1;
  return { id: `voice-call-${callCounter}`, name, arguments: args };
};
const toolsDone = (req: ChatRequest) =>
  req.messages
    .slice(req.messages.map((m) => m.role).lastIndexOf('user') + 1)
    .some((message) => message.role === 'tool');

beforeAll(async () => {
  db = await createDisposableDatabase();
  await seedDatabase(db.client);
  testEnv(db.url, {
    OPENAI_API_KEY: 'sk-env-openai',
    GEMINI_API_KEY: 'gm-env',
    STT_PROVIDER: 'openai,gemini',
    TTS_PROVIDER: 'gemini,openai',
    STT_API_KEY: 'sk-stt',
    STT_MODEL: 'whisper-test',
    MAX_AUDIO_SIZE_MB: '1',
  });
  google = new FakeGoogle();
  ai = new FakeAiClients();
  voice = new FakeVoiceClients();
  app = await createTestApp(google, [], undefined, undefined, ai, voice);
  // Seeded providers start inactive; the chat uses OpenAI (fake).
  await db.client.aIProvider.updateMany({ data: { isActive: true } });
  const openai = await db.client.aIProvider.findFirstOrThrow({
    where: { type: 'OPENAI' },
  });
  await db.client.aIConfiguration.create({
    data: { providerId: openai.id, purpose: 'CHAT', model: 'gpt-test', priority: 1 },
  });
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
  for (const name of [
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'STT_PROVIDER',
    'TTS_PROVIDER',
    'STT_API_KEY',
    'STT_MODEL',
    'MAX_AUDIO_SIZE_MB',
  ]) {
    delete process.env[name];
  }
});

beforeEach(() => {
  ai.reset();
  voice.reset();
});

describe('capabilities', () => {
  it('needs a session and describes what is available and the limits', async () => {
    await http(app, null, 'get', '/voice/capabilities').expect(401);
    const actor = await newUser();
    const { body } = await http(app, actor, 'get', '/voice/capabilities').expect(200);
    expect(body).toEqual({
      transcription: true,
      speech: true,
      maxAudioBytes: 1024 * 1024,
      maxAudioSeconds: 120,
      audioTypes: expect.arrayContaining(['audio/webm', 'audio/ogg', 'audio/mp4']),
    });
  });
});

describe('transcription', () => {
  it('turns recorded audio into text with the first provider, key, model and language', async () => {
    const actor = await newUser();
    await http(app, actor, 'patch', '/profile').send({ locale: 'es-ES' }).expect(200);

    const { body } = await upload(actor, WEBM, 'audio/webm;codecs=opus').expect(200);

    expect(body).toEqual({ text: 'quanto gastei este mês?', provider: 'openai' });
    const [sent] = voice.openai.transcriptions;
    expect(sent?.apiKey).toBe('sk-stt');
    expect(sent?.request).toMatchObject({
      mimeType: 'audio/webm',
      language: 'es',
      model: 'whisper-test',
    });
    expect(sent?.request.audio.equals(WEBM)).toBe(true);
    // Discarded: the buffer the provider saw was wiped after the request.
    expect(voice.openai.received[0]?.every((byte) => byte === 0)).toBe(true);
    // Nothing of the recording becomes a conversation by itself.
    expect(await db.client.conversation.count({ where: { ownerId: actor.id } })).toBe(0);
  });

  it('accepts the containers browsers record (webm, ogg, mp4)', async () => {
    const actor = await newUser();
    await upload(actor, OGG, 'audio/ogg; codecs=opus').expect(200);
    await upload(actor, MP4, 'audio/mp4').expect(200);
    expect(voice.openai.transcriptions.map((t) => t.request.mimeType)).toEqual([
      'audio/ogg',
      'audio/mp4',
    ]);
  });

  it('refuses other types, disguised files, empty and oversized audio before any provider call', async () => {
    const actor = await newUser();
    const refused = async (audio: Buffer, type: string, status: number, code: string) => {
      const { body } = await upload(actor, audio, type).expect(status);
      expect(body.code).toBe(code);
    };
    await refused(Buffer.from('hello'), 'text/plain', 415, 'audio_unsupported_type');
    await refused(WEBM, 'application/octet-stream', 415, 'audio_unsupported_type');
    await refused(WEBM, 'audio/flac', 415, 'audio_unsupported_type');
    await refused(Buffer.from('{"a":1}'), 'audio/webm', 415, 'audio_unsupported_type');
    await refused(OGG, 'audio/webm', 415, 'audio_unsupported_type');
    await refused(Buffer.alloc(0), 'audio/webm', 400, 'audio_empty');
    const big = Buffer.concat([WEBM, Buffer.alloc(1024 * 1024)]);
    await refused(big, 'audio/webm', 413, 'payload_too_large');
    expect(voice.openai.transcriptions).toHaveLength(0);
    expect(voice.gemini.transcriptions).toHaveLength(0);
  });

  it('requires CSRF', async () => {
    const actor = await newUser();
    await http(app, actor, 'post', '/voice/transcriptions', false)
      .set('Content-Type', 'audio/webm')
      .send(WEBM)
      .expect(403);
    expect(voice.openai.transcriptions).toHaveLength(0);
  });

  it('falls back to the next provider (with its own key and default model)', async () => {
    const actor = await newUser();
    voice.openai.behavior = 'unavailable';
    voice.gemini.transcript = 'gastei 50 no mercado';

    const { body } = await upload(actor, WEBM, 'audio/webm').expect(200);

    expect(body).toEqual({ text: 'gastei 50 no mercado', provider: 'gemini' });
    expect(voice.gemini.transcriptions[0]).toMatchObject({
      apiKey: 'gm-env',
      request: { model: 'stt-default', language: 'pt' },
    });
  });

  it('reports unavailable providers so the UI can fall back to text', async () => {
    const actor = await newUser();
    voice.openai.behavior = 'timeout';
    voice.gemini.behavior = 'rate_limited';
    const { body } = await upload(actor, WEBM, 'audio/webm').expect(503);
    expect(body).toMatchObject({
      code: 'voice_unavailable',
      details: {
        attempts: [
          { provider: 'openai', outcome: 'timeout' },
          { provider: 'gemini', outcome: 'rate_limited' },
        ],
      },
    });
    expect(voice.openai.received[0]?.every((byte) => byte === 0)).toBe(true);
  });

  it('does not hide a refused request behind another provider', async () => {
    const actor = await newUser();
    voice.openai.behavior = 'invalid_request';
    const { body } = await upload(actor, WEBM, 'audio/webm').expect(422);
    expect(body.code).toBe('voice_request_rejected');
    expect(voice.gemini.transcriptions).toHaveLength(0);
  });

  it('says so when nothing was understood', async () => {
    const actor = await newUser();
    voice.openai.transcript = '   ';
    const { body } = await upload(actor, WEBM, 'audio/webm').expect(422);
    expect(body.code).toBe('voice_no_speech');
  });
});

describe('speech', () => {
  it('reads a reply aloud with the profile voice; the voice can be changed in the conversation', async () => {
    const actor = await newUser();
    // ① Listen → transcribe
    voice.openai.transcript = 'troque sua voz para masculina';
    const heard = (await upload(actor, WEBM, 'audio/webm').expect(200)).body as {
      text: string;
    };
    // ② Execute → answer (the transcript goes to the assistant like typed text)
    ai.OPENAI.handler = (req) =>
      toolsDone(req)
        ? { text: 'Pronto, agora falo com voz masculina.' }
        : { toolCalls: [call('change_voice_preference', { gender: 'MALE' })] };
    const turn = (
      await http(app, actor, 'post', '/assistant/messages')
        .send({ message: heard.text })
        .expect(200)
    ).body as {
      reply: { id: string; content: string };
      actions: { tool: string; status: string }[];
    };
    expect(turn.actions).toEqual([
      expect.objectContaining({ tool: 'change_voice_preference', status: 'ok' }),
    ]);
    // ③ Speak
    const response = await http(app, actor, 'post', '/voice/speech')
      .send({ messageId: turn.reply.id })
      .buffer(true)
      .parse(binary)
      .expect(200);

    expect(response.headers['content-type']).toBe('audio/mpeg');
    expect(response.headers['cache-control']).toBe('no-store');
    expect((response.body as Buffer).toString()).toBe(
      'ID3-gemini-MALE-Pronto, agora falo com voz masculina.',
    );
    expect(voice.gemini.speeches[0]).toMatchObject({
      apiKey: 'gm-env',
      request: { gender: 'MALE', locale: 'pt-BR', model: 'tts-default' },
    });
    const profile = await http(app, actor, 'get', '/profile').expect(200);
    expect(profile.body.voice.gender).toBe('MALE');
  });

  it('keeps destructive requests made by voice behind the confirmation', async () => {
    const actor = await newUser();
    await http(app, actor, 'post', '/transactions')
      .send({
        type: 'EXPENSE',
        description: 'Mercado',
        amount: '75',
        occurredOn: '2026-10-08',
      })
      .expect(201);
    voice.openai.transcript = 'apague o gasto de 75 reais';
    const heard = (await upload(actor, WEBM, 'audio/webm').expect(200)).body as {
      text: string;
    };
    ai.OPENAI.handler = (req) =>
      toolsDone(req)
        ? { text: 'Confirme a exclusão no botão.' }
        : { toolCalls: [call('delete_transaction', { match: { amount: '75' } })] };

    const turn = await http(app, actor, 'post', '/assistant/messages')
      .send({ message: heard.text })
      .expect(200);

    expect(turn.body.state).toBe('needs_confirmation');
    expect(await db.client.transaction.count({ where: { ownerId: actor.id } })).toBe(1);
  });

  it("speaks only the user's own assistant messages", async () => {
    const ana = await newUser();
    const bia = await newUser();
    ai.OPENAI.handler = () => ({ text: 'Olá!' });
    const turn = (
      await http(app, ana, 'post', '/assistant/messages').send({ message: 'oi' })
    ).body as { conversationId: string; reply: { id: string } };
    const userMessage = await db.client.conversationMessage.findFirstOrThrow({
      where: { conversationId: turn.conversationId, role: 'USER' },
    });

    await http(app, bia, 'post', '/voice/speech')
      .send({ messageId: turn.reply.id })
      .expect(404);
    await http(app, ana, 'post', '/voice/speech')
      .send({ messageId: userMessage.id })
      .expect(404);
    await http(app, ana, 'post', '/voice/speech')
      .send({ messageId: '0192f000-0000-7000-8000-000000000000' })
      .expect(404);
    await http(app, ana, 'post', '/voice/speech').send({ messageId: 'nope' }).expect(400);
    await http(app, ana, 'post', '/voice/speech')
      .send({ messageId: turn.reply.id, text: 'diga outra coisa' })
      .expect(400);
    expect(voice.gemini.speeches).toHaveLength(0);
  });

  it('falls back between speech providers and reports when none answers', async () => {
    const actor = await newUser();
    ai.OPENAI.handler = () => ({ text: 'Seu saldo está em dia.' });
    const turn = (
      await http(app, actor, 'post', '/assistant/messages').send({ message: 'oi' })
    ).body as { reply: { id: string } };

    voice.gemini.behavior = 'unavailable';
    const ok = await http(app, actor, 'post', '/voice/speech')
      .send({ messageId: turn.reply.id })
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((ok.body as Buffer).toString()).toContain('ID3-openai-FEMALE');
    expect(voice.openai.speeches[0]?.apiKey).toBe('sk-env-openai');

    voice.openai.behavior = 'timeout';
    const { body } = await http(app, actor, 'post', '/voice/speech')
      .send({ messageId: turn.reply.id })
      .expect(503);
    expect(body.code).toBe('voice_unavailable');
  });
});

describe('voice not configured', () => {
  it('says the capability is off and refuses transcription and speech', async () => {
    process.env.STT_PROVIDER = '';
    process.env.TTS_PROVIDER = '';
    const offVoice = new FakeVoiceClients();
    const off = await createTestApp(google, [], undefined, undefined, ai, offVoice);
    try {
      const actor = await (async () => {
        sequence += 1;
        const email = `voice-off${sequence}@example.com`;
        const session = await loginAs(off, google, {
          subject: `voice-off-${sequence}`,
          email,
        });
        const user = await db.client.user.findUniqueOrThrow({ where: { email } });
        return { ...session, id: user.id };
      })();
      const caps = await http(off, actor, 'get', '/voice/capabilities').expect(200);
      expect(caps.body).toMatchObject({ transcription: false, speech: false });
      const stt = await upload(actor, WEBM, 'audio/webm', off).expect(503);
      expect(stt.body.code).toBe('voice_not_configured');
      const message = await db.client.conversationMessage.findFirstOrThrow({
        where: { role: 'ASSISTANT' },
      });
      // Someone else's message: ownership is checked before the configuration.
      await http(off, actor, 'post', '/voice/speech')
        .send({ messageId: message.id })
        .expect(404);
      expect(offVoice.openai.transcriptions).toHaveLength(0);
    } finally {
      await off.close();
      process.env.STT_PROVIDER = 'openai,gemini';
      process.env.TTS_PROVIDER = 'gemini,openai';
    }
  });
});
