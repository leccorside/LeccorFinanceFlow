import { Controller, Get, Inject, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/session-auth.guard.js';
import { dto, validate } from '../common/validation/zod-validation.pipe.js';
import { parseCalendarDate } from '../finance/dates.js';
import { calendarDate } from '../finance/finance.schemas.js';
import { type DashboardResponse, DashboardService } from './dashboard.service.js';
import { PERIOD_KEYS } from './periods.js';

/** `from`/`to` only make sense (and are required) with `period=custom`. */
export const dashboardQuery = dto({
  period: z.enum(PERIOD_KEYS).default('month'),
  from: calendarDate.optional(),
  to: calendarDate.optional(),
})
  .refine((query) => query.period === 'custom' || (!query.from && !query.to), {
    message: 'from/to only apply to period=custom',
    path: ['period'],
  })
  .refine((query) => query.period !== 'custom' || (query.from && query.to), {
    message: 'custom periods need from and to',
    path: ['from'],
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'from must not be after to',
    path: ['to'],
  });

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get()
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Query(validate(dashboardQuery)) query: z.infer<typeof dashboardQuery>,
  ): Promise<DashboardResponse> {
    return this.dashboard.overview(user, {
      period: query.period,
      from: query.from ? (parseCalendarDate(query.from) ?? undefined) : undefined,
      to: query.to ? (parseCalendarDate(query.to) ?? undefined) : undefined,
    });
  }
}
