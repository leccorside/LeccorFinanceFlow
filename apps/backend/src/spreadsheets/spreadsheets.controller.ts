import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/session-auth.guard.js';
import { RateLimit } from '../common/security/decorators.js';
import { dto, uuidParam, validate } from '../common/validation/zod-validation.pipe.js';
import { type SpreadsheetResponse, SpreadsheetsService } from './spreadsheets.service.js';

const createSpreadsheet = dto({
  name: z
    .string()
    .trim()
    .min(1)
    .max(150)
    .refine((value) => !/\p{Cc}/u.test(value), 'must not contain control characters'),
}).partial();

@Controller('spreadsheets')
export class SpreadsheetsController {
  constructor(
    @Inject(SpreadsheetsService) private readonly spreadsheets: SpreadsheetsService,
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
}
