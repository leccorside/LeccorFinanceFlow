import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module.js';
import { ReportBuilder } from './report-builder.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** PDF and XLSX reports (PASSO 19). */
@Module({
  imports: [FinanceModule],
  controllers: [ReportsController],
  providers: [ReportBuilder, ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
