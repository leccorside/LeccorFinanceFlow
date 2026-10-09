import { Module } from '@nestjs/common';
import { GeminiVoiceClient } from './providers/gemini-voice.client.js';
import { OpenAiVoiceClient } from './providers/openai-voice.client.js';
import { VoiceController } from './voice.controller.js';
import { VoiceService } from './voice.service.js';
import { VOICE_CLIENTS, type VoiceClients } from './voice.types.js';

/** Speech-to-text and text-to-speech with ordered providers (PASSO 17). */
@Module({
  controllers: [VoiceController],
  providers: [
    VoiceService,
    {
      provide: VOICE_CLIENTS,
      useFactory: (): VoiceClients => ({
        openai: new OpenAiVoiceClient(),
        gemini: new GeminiVoiceClient(),
      }),
    },
  ],
})
export class VoiceModule {}
