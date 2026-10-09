import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminOverviewService } from './admin-overview.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminController } from './admin.controller.js';
import { AiProvidersController } from './ai-providers.controller.js';
import { AiProvidersService } from './ai-providers.service.js';

/** Administration routes under /admin (ADMIN role). */
@Module({
  imports: [AiModule, AuthModule],
  controllers: [AiProvidersController, AdminController],
  providers: [AiProvidersService, AdminOverviewService, AdminUsersService],
})
export class AdminModule {}
