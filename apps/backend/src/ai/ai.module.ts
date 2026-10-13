import { Module } from '@nestjs/common';
import { AiService } from './ai.service.js';
import { AI_PROVIDER_CLIENTS, type AiProviderClients } from './ai.types.js';
import { GeminiClient } from './providers/gemini.client.js';

/**
 * AI access through Google Gemini only, with prioritized, classified fallback between the
 * configured Gemini models. The client map keeps the provider abstraction (one entry today).
 */
@Module({
  providers: [
    AiService,
    {
      provide: AI_PROVIDER_CLIENTS,
      useFactory: (): AiProviderClients => ({
        GEMINI: new GeminiClient(),
      }),
    },
  ],
  exports: [AiService],
})
export class AiModule {}
