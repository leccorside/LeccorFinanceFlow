import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service.js';
import { HealthController } from './health.controller.js';

async function createController(databaseUp: boolean): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      {
        provide: PrismaService,
        useValue: { isReachable: async () => databaseUp },
      },
    ],
  }).compile();

  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('returns the API liveness state', async () => {
    const controller = await createController(false);

    expect(controller.getHealth()).toEqual({
      status: 'ok',
      service: 'leccor-finance-flow-api',
    });
  });

  it('reports ready when the database is reachable', async () => {
    const controller = await createController(true);

    await expect(controller.getReadiness()).resolves.toEqual({
      status: 'ok',
      service: 'leccor-finance-flow-api',
      checks: { database: 'up' },
    });
  });

  it('throws 503 when the database is unreachable', async () => {
    const controller = await createController(false);

    await expect(controller.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
