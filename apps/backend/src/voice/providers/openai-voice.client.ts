import { AiProviderError } from '../../ai/ai.types.js';
import { defaultFetch, type Fetch, readJson, send } from '../../ai/providers/http.js';
import type {
  SpeechAudio,
  SpeechRequest,
  TranscriptionRequest,
  VoiceProviderClient,
} from '../voice.types.js';
import { extensionOf } from '../audio.js';

export const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
export const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';

/** Semantic preference → OpenAI preset voice. */
const VOICES = { FEMALE: 'nova', MALE: 'onyx' } as const;

/** OpenAI Audio API: transcriptions (multipart) and speech (MP3). */
export class OpenAiVoiceClient implements VoiceProviderClient {
  readonly name = 'openai' as const;
  readonly defaultModels = {
    transcription: 'gpt-4o-mini-transcribe',
    speech: 'gpt-4o-mini-tts',
  };

  constructor(private readonly fetchImpl: Fetch = defaultFetch) {}

  async transcribe(
    apiKey: string,
    request: TranscriptionRequest,
    signal: AbortSignal,
  ): Promise<string> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(request.audio)], { type: request.mimeType }),
      `audio.${extensionOf(request.mimeType)}`,
    );
    form.append('model', request.model);
    form.append('language', request.language);
    form.append('response_format', 'json');
    const response = await send(
      this.fetchImpl,
      OPENAI_TRANSCRIPTIONS_URL,
      { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form },
      signal,
    );
    const body = (await readJson(response)) as { text?: unknown };
    if (typeof body.text !== 'string') throw new AiProviderError('invalid_response');
    return body.text.trim();
  }

  async synthesize(
    apiKey: string,
    request: SpeechRequest,
    signal: AbortSignal,
  ): Promise<SpeechAudio> {
    const response = await send(
      this.fetchImpl,
      OPENAI_SPEECH_URL,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          voice: VOICES[request.gender],
          input: request.text,
          response_format: 'mp3',
        }),
      },
      signal,
    );
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length === 0) throw new AiProviderError('invalid_response');
    return { audio, mimeType: 'audio/mpeg' };
  }
}
