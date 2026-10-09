import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/session-auth.guard.js';
import { RateLimit } from '../common/security/decorators.js';
import { dto, uuidParam, validate } from '../common/validation/zod-validation.pipe.js';
import { type SpreadsheetResponse, SpreadsheetsService } from './spreadsheets.service.js';
import {
  SheetSyncService,
  type SyncReport,
  type SyncStatusResponse,
} from './sync/sheet-sync.service.js';

const createSpreadsheet = dto({
  name: z
    .string()
    .trim()
    .min(1)
    .max(150)
    .refine((value) => !/\p{Cc}/u.test(value), 'must not contain control characters'),
}).partial();

const resolveConflict = dto({ keep: z.enum(['app', 'sheet']) });

@Controller('spreadsheets')
export class SpreadsheetsController {
  constructor(
    @Inject(SpreadsheetsService) private readonly spreadsheets: SpreadsheetsService,
    @Inject(SheetSyncService) private readonly sync: SheetSyncService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<SpreadsheetResponse[]> {
    return this.spreadsheets.list(user);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<SpreadsheetResponse> {
    return this.spreadsheets.get(user, id);
  }

  /**
   * Creates the spreadsheet in the user's Google Drive, or finishes/repairs it when called
   * again with the same name (idempotent). Several Google calls: rate limited per client.
   */
  @Post()
  @HttpCode(200)
  @RateLimit({ policy: 'spreadsheets' })
  ensure(
    @CurrentUser() user: AuthenticatedUser,
    @Body(validate(createSpreadsheet)) body: z.infer<typeof createSpreadsheet>,
  ): Promise<SpreadsheetResponse> {
    return this.spreadsheets.ensure(user, body.name);
  }

  /** Pending counts, open conflicts and the last sync report (no Google call). */
  @Get(':id/sync')
  syncStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<SyncStatusResponse> {
    return this.sync.status(user, id);
  }

  /** Two-way sync with the Google spreadsheet, now (no queue). */
  @Post(':id/sync')
  @HttpCode(200)
  @RateLimit({ policy: 'spreadsheets' })
  runSync(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ): Promise<SyncReport> {
    return this.sync.sync(user, id);
  }

  /** Keeps the app's or the sheet's version of a conflicting record, then syncs. */
  @Post(':id/sync/conflicts/:recordId')
  @HttpCode(200)
  @RateLimit({ policy: 'spreadsheets' })
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Param('recordId', uuidParam) recordId: string,
    @Body(validate(resolveConflict)) body: z.infer<typeof resolveConflict>,
  ): Promise<SyncReport> {
    return this.sync.resolve(user, id, recordId, body.keep);
  }
}
