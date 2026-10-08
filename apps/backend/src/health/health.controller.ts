import { Controller, Get, Inject, Res } from '@nestjs/common';
import { Public } from '../common/security/decorators.js';
import { PrismaService } from '../database/prisma.service.js';

export interface HealthResponse {
  status: 'ok';
  service: 'leccor-finance-flow-api';
}

export interface ReadinessResponse {
  status: 'ok' | 'error';
  service: 'leccor-finance-flow-api';
  checks: {
    database: 'up' | 'down';
  };
}

interface StatusResponse {
  status(code: number): unknown;
}

@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly database: PrismaService) {}

  /** Liveness: the process answers HTTP. Does not touch dependencies. */
  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'leccor-finance-flow-api',
    };
  }

  /**
   * Readiness: the API can serve requests that need PostgreSQL. Sets 503 directly
   * (instead of throwing) so this body keeps its own shape, not the error contract.
   */
  @Get('ready')
  async getReadiness(
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<ReadinessResponse> {
    const databaseUp = await this.database.isReachable();
    if (!databaseUp) {
      response.status(503);
    }
    return {
      status: databaseUp ? 'ok' : 'error',
      service: 'leccor-finance-flow-api',
      checks: { database: databaseUp ? 'up' : 'down' },
    };
  }
}
