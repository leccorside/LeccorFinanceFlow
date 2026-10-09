import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AiProviderError } from '../ai/ai.types.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ApiException, ResourceNotFoundException } from '../common/errors/api-error.js';
import { APP_ENV, type AppEnv, type VoiceProviderConfig } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { UsageService } from '../usage/usage.service.js';
import type { VoiceGender } from '../generated/prisma/enums.js';
import { ACCEPTED_AUDIO_TYPES, acceptedType, matchesSignature } from './audio.js';
import {
  type SpeechAudio,
  VOICE_CLIENTS,
  type VoiceClients,
  type VoiceProviderClient,
} from './voice.types.js';

type User = Pick<AuthenticatedUser, 'id'>;

/** Longest reply read aloud (characters); longer answers are cut at a sentence end. */
export const MAX_SPEECH_CHARS = 3000;

export interface VoiceAttempt {
  provider: string;
  outcome: 'ok' | 'not_configured' | AiProviderError['kind'];
}

export interface VoiceCapabilities {
  transcription: boolean;
  speech: boolean;
  maxAudioBytes: number;
  maxAudioSeconds: number;
  audioTypes: string[];
}

/**
 * Speech-to-text and text-to-speech behind ordered providers with the chat's fallback rules.
 * Audio lives only in memory for the request: it is never stored nor logged, and the buffer
 * is wiped once the providers are done with it.
 */
@Injectable()
export class VoiceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(VOICE_CLIENTS) private readonly clients: VoiceClients,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(UsageService) private readonly usage: UsageService,
  ) {}

  /** Available = a provider is configured AND the admin has not turned it off. */
  async capabilities(): Promise<VoiceCapabilities> {
    const settings = await this.settings.all();
    return {
      transcription:
        this.env.VOICE.transcription.length > 0 &&
        settings['voice.transcription.enabled'],
      speech: this.env.VOICE.speech.length > 0 && settings['voice.speech.enabled'],
      maxAudioBytes: this.env.VOICE.maxAudioBytes,
      maxAudioSeconds: this.env.VOICE.maxAudioSeconds,
      audioTypes: ACCEPTED_AUDIO_TYPES,
    };
  }

  async transcribe(
    user: User,
    audio: unknown,
    contentType: string | undefined,
  ): Promise<{ text: string; provider: string }> {
    const mimeType = acceptedType(contentType);
    // An accepted type without a body reaches here as {} (the parser had nothing to read).
    if (mimeType && !Buffer.isBuffer(audio)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'audio_empty',
        'O áudio está vazio.',
      );
    }
    if (!mimeType || !Buffer.isBuffer(audio)) {
      throw new ApiException(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'audio_unsupported_type',
        'Formato de áudio não aceito.',
        { accepted: ACCEPTED_AUDIO_TYPES },
      );
    }
    try {
      if (audio.length === 0) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'audio_empty',
          'O áudio está vazio.',
        );
      }
      if (audio.length > this.env.VOICE.maxAudioBytes) {
        // The body parser already refuses larger bodies; this guards other callers.
        throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, 'payload_too_large');
      }
      if (!matchesSignature(audio, mimeType)) {
        throw new ApiException(
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
          'audio_unsupported_type',
          'O conteúdo não corresponde ao formato de áudio informado.',
          { accepted: ACCEPTED_AUDIO_TYPES },
        );
      }
      const locale = await this.localeOf(user);
      const { result, provider } = await this.withProviders(
        this.env.VOICE.transcription,
        (client, key, model, signal) =>
          client.transcribe(
            key,
            { audio, mimeType, language: locale.slice(0, 2), model },
            signal,
          ),
        'transcription',
        { input: audio.length, output: (text) => text.length },
      );
      const text = result.replace(/\s+/g, ' ').trim().slice(0, 2000);
      if (!text) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'voice_no_speech',
          'Não consegui entender o áudio. Tente falar de novo ou escreva.',
        );
      }
      return { text, provider };
    } finally {
      audio.fill(0); // discard: nothing of the recording survives the request
    }
  }

  /** Reads one of the user's assistant replies aloud, with the profile's voice. */
  async speak(user: User, messageId: string): Promise<SpeechAudio> {
    const message = await this.prisma.conversationMessage.findFirst({
      where: { id: messageId, role: 'ASSISTANT', conversation: { ownerId: user.id } },
      select: { content: true },
    });
    if (!message || !message.content.trim()) throw new ResourceNotFoundException();
    const [locale, gender] = await Promise.all([
      this.localeOf(user),
      this.genderOf(user),
    ]);
    const text = speakable(message.content);
    const { result } = await this.withProviders(
      this.env.VOICE.speech,
      (client, key, model, signal) =>
        client.synthesize(key, { text, gender, locale, model }, signal),
      'speech',
      { input: text.length, output: (speech) => speech.audio.length },
    );
    return result;
  }

  private async withProviders<T>(
    chain: VoiceProviderConfig[],
    run: (
      client: VoiceProviderClient,
      key: string,
      model: string,
      signal: AbortSignal,
    ) => Promise<T>,
    kind: 'transcription' | 'speech',
    units: { input: number; output: (result: T) => number },
  ): Promise<{ result: T; provider: string }> {
    const enabled = await this.settings.get(
      kind === 'transcription' ? 'voice.transcription.enabled' : 'voice.speech.enabled',
    );
    if (!enabled) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'voice_disabled',
        'A voz foi desativada pela administração. Use o texto.',
      );
    }
    const usageKind = kind === 'transcription' ? 'VOICE_TRANSCRIPTION' : 'VOICE_SPEECH';
    if (chain.length === 0) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'voice_not_configured',
        kind === 'transcription'
          ? 'A transcrição de voz não está configurada. Use o texto.'
          : 'A leitura em voz alta não está configurada.',
      );
    }
    const attempts: VoiceAttempt[] = [];
    for (const config of chain) {
      const client = this.clients[config.provider];
      if (!config.apiKey) {
        attempts.push({ provider: config.provider, outcome: 'not_configured' });
        continue;
      }
      const model = config.model ?? client.defaultModels[kind];
      try {
        const result = await run(
          client,
          config.apiKey,
          model,
          AbortSignal.timeout(this.env.VOICE.timeoutMs),
        );
        await this.usage.record({
          kind: usageKind,
          provider: config.provider,
          model,
          inputUnits: units.input,
          outputUnits: units.output(result),
          outcome: 'ok',
        });
        return { result, provider: config.provider };
      } catch (error) {
        if (!(error instanceof AiProviderError)) throw error;
        attempts.push({ provider: config.provider, outcome: error.kind });
        await this.usage.record({
          kind: usageKind,
          provider: config.provider,
          model,
          inputUnits: units.input,
          outcome: error.kind,
        });
        if (!error.recoverable) {
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'voice_request_rejected',
            'O provedor de voz recusou o áudio ou o texto.',
            { attempts },
          );
        }
      }
    }
    throw new ApiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'voice_unavailable',
      'O serviço de voz não respondeu. Continue por texto e tente de novo depois.',
      { attempts },
    );
  }

  private async localeOf(user: User): Promise<string> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId: user.id },
      select: { locale: true },
    });
    return (profile?.locale ?? 'pt_BR').replace('_', '-');
  }

  private async genderOf(user: User): Promise<VoiceGender> {
    const preference = await this.prisma.voicePreference.findUnique({
      where: { userId: user.id },
      select: { gender: true },
    });
    return preference?.gender ?? 'FEMALE';
  }
}

/** Plain text for the voice: no markdown marks, bounded length (cut at a sentence). */
export function speakable(content: string): string {
  const plain = content
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= MAX_SPEECH_CHARS) return plain;
  const cut = plain.slice(0, MAX_SPEECH_CHARS);
  const end = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
  );
  return end > MAX_SPEECH_CHARS / 2 ? cut.slice(0, end + 1) : `${cut}…`;
}
