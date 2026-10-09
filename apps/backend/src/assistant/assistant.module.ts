import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { DashboardModule } from '../dashboard/dashboard.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { GoogleModule } from '../google/google.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { SpreadsheetsModule } from '../spreadsheets/spreadsheets.module.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { ConversationService } from './conversation.service.js';
import { IntentService } from './intent.service.js';
import { ToolExecutor } from './tools/tool-executor.js';
import { ToolRegistry } from './tools/tool-registry.js';

/** The conversational assistant: conversations, intent routing, model ↔ tool loop. */
@Module({
  imports: [
    AiModule,
    FinanceModule,
    SpreadsheetsModule,
    ProfileModule,
    GoogleModule,
    DashboardModule,
  ],
  controllers: [AssistantController],
  providers: [
    ToolRegistry,
    ToolExecutor,
    ConversationService,
    IntentService,
    AssistantService,
  ],
  exports: [ToolRegistry, ToolExecutor, AssistantService],
})
export class AssistantModule {}
