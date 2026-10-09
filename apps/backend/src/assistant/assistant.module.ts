import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { SpreadsheetsModule } from '../spreadsheets/spreadsheets.module.js';
import { AssistantController } from './assistant.controller.js';
import { ToolExecutor } from './tools/tool-executor.js';
import { ToolRegistry } from './tools/tool-registry.js';

/** Tool registry and safe executor: the only bridge between models and the domain. */
@Module({
  imports: [FinanceModule, SpreadsheetsModule, ProfileModule],
  controllers: [AssistantController],
  providers: [ToolRegistry, ToolExecutor],
  exports: [ToolRegistry, ToolExecutor],
})
export class AssistantModule {}
