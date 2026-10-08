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

function fakeResponse() {
  const response = {
    statusCode: 200,
    status: (code: number) => (response.statusCode = code),
  };
  return response;
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
    const response = fakeResponse();

    await expect(controller.getReadiness(response)).resolves.toEqual({
      status: 'ok',
      service: 'leccor-finance-flow-api',
      checks: { database: 'up' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('answers 503 with the readiness body when the database is unreachable', async () => {
    const controller = await createController(false);
    const response = fakeResponse();

    await expect(controller.getReadiness(response)).resolves.toMatchObject({
      status: 'error',
      checks: { database: 'down' },
    });
    expect(response.statusCode).toBe(503);
  });
});
