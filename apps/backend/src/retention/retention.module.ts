import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module.js';
import { RetentionService } from './retention.service.js';

/** Retention policy (PASSO 21). */
@Module({
  imports: [ReportsModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
