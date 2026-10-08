import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import {
  GOOGLE_WORKSPACE_CLIENT,
  HttpGoogleWorkspaceClient,
} from './google-workspace.client.js';
import { SpreadsheetsController } from './spreadsheets.controller.js';
import { SpreadsheetsService } from './spreadsheets.service.js';

@Module({
  imports: [GoogleModule, ProfileModule],
  controllers: [SpreadsheetsController],
  providers: [
    SpreadsheetsService,
    {
      provide: GOOGLE_WORKSPACE_CLIENT,
      useFactory: () => new HttpGoogleWorkspaceClient(),
    },
  ],
  exports: [SpreadsheetsService],
})
export class SpreadsheetsModule {}
