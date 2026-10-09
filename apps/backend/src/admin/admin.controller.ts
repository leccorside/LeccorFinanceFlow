import { Body, Controller, Get, Inject, Param, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/session-auth.guard.js';
import { Roles } from '../common/security/decorators.js';
import { dto, uuidParam, validate } from '../common/validation/zod-validation.pipe.js';
import {
  SETTING_KEYS,
  SETTINGS,
  type SettingValues,
  SettingsService,
  settingsUpdate,
} from '../settings/settings.service.js';
import { type AdminOverview, AdminOverviewService } from './admin-overview.service.js';
import { type AdminUserView, AdminUsersService } from './admin-users.service.js';

const userQuery = dto({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'BLOCKED']).optional(),
  role: z.enum(['ADMIN', 'USER']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const statusBody = dto({ status: z.enum(['ACTIVE', 'BLOCKED']) });
const adminBody = dto({ admin: z.boolean() });

/**
 * Administration console: overview, users and global settings. ADMIN only (RolesGuard);
 * session + CSRF on writes. Responses never contain secrets.
 */
@Controller('admin')
@Roles('ADMIN')
export class AdminController {
  constructor(
    @Inject(AdminOverviewService) private readonly overviewService: AdminOverviewService,
    @Inject(AdminUsersService) private readonly users: AdminUsersService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  @Get('overview')
  overview(): Promise<AdminOverview> {
    return this.overviewService.overview();
  }

  @Get('users')
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(validate(userQuery)) query: z.infer<typeof userQuery>,
  ): Promise<{ items: AdminUserView[]; total: number }> {
    return this.users.list(actor, query);
  }

  @Patch('users/:id/status')
  setStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(validate(statusBody)) body: z.infer<typeof statusBody>,
  ): Promise<AdminUserView> {
    return this.users.setStatus(actor, id, body.status);
  }

  @Patch('users/:id/admin')
  setAdmin(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(validate(adminBody)) body: z.infer<typeof adminBody>,
  ): Promise<AdminUserView> {
    return this.users.setAdmin(actor, id, body.admin);
  }

  @Get('settings')
  async getSettings() {
    this.settings.invalidate();
    return this.describe(await this.settings.all());
  }

  @Patch('settings')
  async updateSettings(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(validate(settingsUpdate)) body: Partial<SettingValues>,
  ) {
    return this.describe(await this.settings.update(body, actor.id));
  }

  private describe(values: SettingValues) {
    return {
      values,
      definitions: SETTING_KEYS.map((key) => ({
        key,
        description: SETTINGS[key].description,
        default: SETTINGS[key].default,
      })),
    };
  }
}
