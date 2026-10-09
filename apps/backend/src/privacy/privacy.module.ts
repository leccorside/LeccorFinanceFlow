import { Module } from '@nestjs/common';
import { PrivacyController } from './privacy.controller.js';
import { PrivacyService } from './privacy.service.js';

/** Privacy rights: data export (PASSO 21). */
@Module({
  controllers: [PrivacyController],
  providers: [PrivacyService],
})
export class PrivacyModule {}
