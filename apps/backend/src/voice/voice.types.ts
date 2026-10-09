import type { VoiceProviderName } from '../config/env.js';
import type { VoiceGender } from '../generated/prisma/enums.js';

/**
 * Provider-neutral voice contract. Failures are `AiProviderError`s with the same classes as
 * chat (recoverable ones allow the next provider), so the fallback rules are identical.
 */

export interface TranscriptionRequest {
  audio: Buffer;
  /** Validated MIME type without parameters ("audio/webm"). */
  mimeType: string;
  /** ISO 639-1 hint ("pt"). */
  language: string;
  model: string;
}

export interface SpeechRequest {
  text: string;
  gender: VoiceGender;
  /** BCP 47 of the user ("pt-BR"). */
  locale: string;
  model: string;
}

export interface SpeechAudio {
  audio: Buffer;
  mimeType: string;
}

export interface VoiceProviderClient {
  readonly name: VoiceProviderName;
  readonly defaultModels: { transcription: string; speech: string };
  /** Plain text of what was said ('' when nothing was understood). */
  transcribe(
    apiKey: string,
    request: TranscriptionRequest,
    signal: AbortSignal,
  ): Promise<string>;
  synthesize(
    apiKey: string,
    request: SpeechRequest,
    signal: AbortSignal,
  ): Promise<SpeechAudio>;
}

/** Adapters by provider (overridable in tests). */
export const VOICE_CLIENTS = Symbol('VOICE_CLIENTS');
export type VoiceClients = Record<VoiceProviderName, VoiceProviderClient>;
