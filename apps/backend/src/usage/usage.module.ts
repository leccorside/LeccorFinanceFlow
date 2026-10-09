import { Global, Module } from '@nestjs/common';
import { UsageService } from './usage.service.js';

/** Anonymous usage events of AI and voice providers (PASSO 20). */
@Global()
@Module({
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
