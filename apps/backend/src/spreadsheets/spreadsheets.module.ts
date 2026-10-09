import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module.js';
import { GoogleModule } from '../google/google.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import {
  GOOGLE_WORKSPACE_CLIENT,
  HttpGoogleWorkspaceClient,
} from './google-workspace.client.js';
import { SpreadsheetsController } from './spreadsheets.controller.js';
import { SpreadsheetsService } from './spreadsheets.service.js';
import { SheetSyncService } from './sync/sheet-sync.service.js';

@Module({
  imports: [GoogleModule, ProfileModule, FinanceModule],
  controllers: [SpreadsheetsController],
  providers: [
    SpreadsheetsService,
    SheetSyncService,
    {
      provide: GOOGLE_WORKSPACE_CLIENT,
      useFactory: () => new HttpGoogleWorkspaceClient(),
    },
  ],
  exports: [SpreadsheetsService, SheetSyncService, GOOGLE_WORKSPACE_CLIENT],
})
export class SpreadsheetsModule {}
