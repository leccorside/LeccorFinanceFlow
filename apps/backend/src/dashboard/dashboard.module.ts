import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

/** Financial dashboard and deterministic insights (PASSO 18). */
@Module({
  imports: [FinanceModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
