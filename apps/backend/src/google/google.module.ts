import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { APP_ENV, type AppEnv } from '../config/env.js';
import { GoogleConnectionService } from './google-connection.service.js';
import { GoogleController } from './google.controller.js';
import { GOOGLE_OAUTH_CLIENT, OpenIdGoogleOAuthClient } from './google-oauth.client.js';

@Module({
  imports: [AuthModule],
  controllers: [GoogleController],
  providers: [
    GoogleConnectionService,
    {
      provide: GOOGLE_OAUTH_CLIENT,
      inject: [APP_ENV],
      useFactory: (env: AppEnv) =>
        env.GOOGLE_OAUTH
          ? new OpenIdGoogleOAuthClient({
              clientId: env.GOOGLE_OAUTH.clientId,
              clientSecret: env.GOOGLE_OAUTH.clientSecret,
              redirectUri: env.GOOGLE_OAUTH.connectionRedirectUri,
            })
          : null,
    },
  ],
  exports: [GoogleConnectionService],
})
export class GoogleModule {}
