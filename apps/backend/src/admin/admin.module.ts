import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AiProvidersController } from './ai-providers.controller.js';
import { AiProvidersService } from './ai-providers.service.js';

/** Administration routes under /admin (ADMIN role). */
@Module({
  imports: [AiModule],
  controllers: [AiProvidersController],
  providers: [AiProvidersService],
})
export class AdminModule {}
