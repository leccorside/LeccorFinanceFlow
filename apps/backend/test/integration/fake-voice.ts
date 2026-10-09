import { type AiErrorKind, AiProviderError } from '../../src/ai/ai.types.js';
import type { VoiceProviderName } from '../../src/config/env.js';
import type {
  SpeechAudio,
  SpeechRequest,
  TranscriptionRequest,
  VoiceClients,
  VoiceProviderClient,
} from '../../src/voice/voice.types.js';

export type FakeVoiceBehavior = 'ok' | AiErrorKind;

/** Programmable voice provider: records calls (audio copied) and answers per behavior. */
export class FakeVoiceClient implements VoiceProviderClient {
  readonly defaultModels = { transcription: 'stt-default', speech: 'tts-default' };
  transcriptions: { apiKey: string; request: TranscriptionRequest }[] = [];
  speeches: { apiKey: string; request: SpeechRequest }[] = [];
  behavior: FakeVoiceBehavior = 'ok';
  transcript = 'quanto gastei este mês?';
  /** The buffers the service handed over, to check they are wiped afterwards. */
  received: Buffer[] = [];

  constructor(readonly name: VoiceProviderName) {}

  async transcribe(apiKey: string, request: TranscriptionRequest): Promise<string> {
    this.received.push(request.audio);
    this.transcriptions.push({
      apiKey,
      request: { ...request, audio: Buffer.from(request.audio) },
    });
    if (this.behavior !== 'ok') throw new AiProviderError(this.behavior);
    return this.transcript;
  }

  async synthesize(apiKey: string, request: SpeechRequest): Promise<SpeechAudio> {
    this.speeches.push({ apiKey, request });
    if (this.behavior !== 'ok') throw new AiProviderError(this.behavior);
    return {
      audio: Buffer.from(`ID3-${this.name}-${request.gender}-${request.text}`),
      mimeType: 'audio/mpeg',
    };
  }

  reset(): void {
    this.transcriptions = [];
    this.speeches = [];
    this.received = [];
    this.behavior = 'ok';
    this.transcript = 'quanto gastei este mês?';
  }
}

export class FakeVoiceClients implements VoiceClients {
  openai = new FakeVoiceClient('openai');
  gemini = new FakeVoiceClient('gemini');

  reset(): void {
    this.openai.reset();
    this.gemini.reset();
  }
}
