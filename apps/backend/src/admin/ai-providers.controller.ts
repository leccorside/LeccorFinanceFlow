import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AiService, type ProbeResult } from '../ai/ai.service.js';
import { RateLimit, Roles } from '../common/security/decorators.js';
import { uuidParam, validate } from '../common/validation/zod-validation.pipe.js';
import {
  AiProvidersService,
  type CreateConfigurationInput,
  createConfigurationSchema,
  type ProviderView,
  reorderSchema,
  type ReorderInput,
  type UpdateConfigurationInput,
  updateConfigurationSchema,
  type UpdateProviderInput,
  updateProviderSchema,
} from './ai-providers.service.js';

/**
 * AI providers, models, priorities and keys. ADMIN only (RolesGuard), session + CSRF on
 * writes like every route. Keys are write-only: no response ever contains one.
 */
@Controller('admin')
@Roles('ADMIN')
export class AiProvidersController {
  constructor(
    @Inject(AiProvidersService) private readonly providers: AiProvidersService,
    @Inject(AiService) private readonly ai: AiService,
  ) {}

  @Get('ai-providers')
  list(): Promise<ProviderView[]> {
    return this.providers.list();
  }

  @Patch('ai-providers/:id')
  update(
    @Param('id', uuidParam) id: string,
    @Body(validate(updateProviderSchema)) body: UpdateProviderInput,
  ): Promise<ProviderView> {
    return this.providers.updateProvider(id, body);
  }

  @Post('ai-providers/:id/configurations')
  createConfiguration(
    @Param('id', uuidParam) id: string,
    @Body(validate(createConfigurationSchema)) body: CreateConfigurationInput,
  ): Promise<ProviderView> {
    return this.providers.createConfiguration(id, body);
  }

  @Patch('ai-configurations/:id')
  updateConfiguration(
    @Param('id', uuidParam) id: string,
    @Body(validate(updateConfigurationSchema)) body: UpdateConfigurationInput,
  ): Promise<ProviderView> {
    return this.providers.updateConfiguration(id, body);
  }

  @Delete('ai-configurations/:id')
  @HttpCode(204)
  deleteConfiguration(@Param('id', uuidParam) id: string): Promise<void> {
    return this.providers.deleteConfiguration(id);
  }

  @Post('ai-configurations/reorder')
  @HttpCode(200)
  reorder(@Body(validate(reorderSchema)) body: ReorderInput): Promise<ProviderView[]> {
    return this.providers.reorder(body);
  }

  /** Sends a tiny request with this configuration only (paid call: rate limited). */
  @Post('ai-configurations/:id/test')
  @HttpCode(200)
  @RateLimit({ name: 'ai-test', limit: 10, windowMs: 60_000 })
  test(@Param('id', uuidParam) id: string): Promise<ProbeResult> {
    return this.ai.probe(id);
  }
}
