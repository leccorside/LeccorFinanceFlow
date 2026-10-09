import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import type { HttpResponse } from '../auth/http.js';
import { CurrentUser } from '../auth/session-auth.guard.js';
import { RateLimit } from '../common/security/decorators.js';
import { dto, uuidParam, validate } from '../common/validation/zod-validation.pipe.js';
import { calendarDate } from '../finance/finance.schemas.js';
import { REPORT_FORMATS, REPORT_TYPES } from './report.types.js';
import { type ReportResponse, ReportsService } from './reports.service.js';

/** The period is given exactly one way: from/to, a month or a year. */
export const reportRequest = dto({
  type: z.enum(REPORT_TYPES),
  format: z.enum(REPORT_FORMATS),
  from: calendarDate.optional(),
  to: calendarDate.optional(),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must look like 2026-09')
    .optional(),
  year: z.number().int().min(1900).max(2100).optional(),
}).refine(
  (body) =>
    [
      body.from !== undefined || body.to !== undefined,
      body.month !== undefined,
      body.year !== undefined,
    ].filter(Boolean).length === 1,
  { message: 'give the period as from/to, month or year (only one)', path: ['from'] },
);

/** ASCII fallback + RFC 5987 UTF-8 name, so any browser saves it with the right name. */
function disposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Post()
  @HttpCode(201)
  @RateLimit({ policy: 'reports' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(validate(reportRequest)) body: z.infer<typeof reportRequest>,
  ): Promise<ReportResponse> {
    return this.reports.create(user, body);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<ReportResponse[]> {
    return this.reports.list(user);
  }

  @Get(':id/download')
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<StreamableFile> {
    const { file, fileName, contentType } = await this.reports.download(user, id);
    response.setHeader('Content-Disposition', disposition(fileName));
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file, { type: contentType, length: file.length });
  }
}
