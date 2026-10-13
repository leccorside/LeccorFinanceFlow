import { Module } from '@nestjs/common';
import { GeminiVoiceClient } from './providers/gemini-voice.client.js';
import { VoiceController } from './voice.controller.js';
import { VoiceService } from './voice.service.js';
import { VOICE_CLIENTS, type VoiceClients } from './voice.types.js';

/** Speech-to-text and text-to-speech with Google Gemini (PASSO 17; Gemini only since 2026-10-13). */
@Module({
  controllers: [VoiceController],
  providers: [
    VoiceService,
    {
      provide: VOICE_CLIENTS,
      useFactory: (): VoiceClients => ({
        gemini: new GeminiVoiceClient(),
      }),
    },
  ],
})
export class VoiceModule {}
