import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
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

  /** Readiness: the API can serve requests that need PostgreSQL. */
  @Get('ready')
  async getReadiness(): Promise<ReadinessResponse> {
    const databaseUp = await this.database.isReachable();
    const response: ReadinessResponse = {
      status: databaseUp ? 'ok' : 'error',
      service: 'leccor-finance-flow-api',
      checks: { database: databaseUp ? 'up' : 'down' },
    };

    if (!databaseUp) {
      throw new ServiceUnavailableException(response);
    }

    return response;
  }
}
