import { Module } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/env.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import {
  GOOGLE_IDENTITY_PROVIDER,
  OpenIdGoogleIdentityProvider,
} from './google-identity.provider.js';
import { SessionAuthGuard } from './session-auth.guard.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionAuthGuard,
    {
      provide: GOOGLE_IDENTITY_PROVIDER,
      inject: [APP_ENV],
      useFactory: (env: AppEnv) =>
        env.GOOGLE_OAUTH ? new OpenIdGoogleIdentityProvider(env.GOOGLE_OAUTH) : null,
    },
  ],
  exports: [AuthService, SessionAuthGuard],
})
export class AuthModule {}
