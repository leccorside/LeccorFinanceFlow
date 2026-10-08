import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { SecurityModule } from './common/security/security.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    SecurityModule,
    HealthModule,
    UsersModule,
    AuthModule,
    ProfileModule,
  ],
})
export class AppModule {}
