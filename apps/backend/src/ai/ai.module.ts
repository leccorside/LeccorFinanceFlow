import { Module } from '@nestjs/common';
import { AiService } from './ai.service.js';
import { AI_PROVIDER_CLIENTS, type AiProviderClients } from './ai.types.js';
import { AnthropicClient } from './providers/anthropic.client.js';
import { GeminiClient } from './providers/gemini.client.js';
import { OpenAiClient } from './providers/openai.client.js';

/** Provider-neutral AI access with prioritized, classified fallback. */
@Module({
  providers: [
    AiService,
    {
      provide: AI_PROVIDER_CLIENTS,
      useFactory: (): AiProviderClients => ({
        OPENAI: new OpenAiClient(),
        GEMINI: new GeminiClient(),
        ANTHROPIC: new AnthropicClient(),
      }),
    },
  ],
  exports: [AiService],
})
export class AiModule {}
