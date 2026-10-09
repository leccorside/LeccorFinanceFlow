import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module.js';
import { AiModule } from './ai/ai.module.js';
import { AssistantModule } from './assistant/assistant.module.js';
import { VoiceModule } from './voice/voice.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CryptoModule } from './common/crypto/crypto.module.js';
import { SecurityModule } from './common/security/security.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { GoogleModule } from './google/google.module.js';
import { HealthModule } from './health/health.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { SpreadsheetsModule } from './spreadsheets/spreadsheets.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CryptoModule,
    SecurityModule,
    HealthModule,
    UsersModule,
    AuthModule,
    ProfileModule,
    GoogleModule,
    SpreadsheetsModule,
    FinanceModule,
    AiModule,
    AdminModule,
    AssistantModule,
    VoiceModule,
    DashboardModule,
    ReportsModule,
  ],
})
export class AppModule {}
