import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('Health endpoints', () => {
  let app: INestApplication;
  let databaseUp = true;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ isReachable: async () => databaseUp })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responds with a healthy liveness status', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200).expect({
      status: 'ok',
      service: 'leccor-finance-flow-api',
    });
  });

  it('responds ready when the database is reachable', async () => {
    databaseUp = true;

    await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200)
      .expect({
        status: 'ok',
        service: 'leccor-finance-flow-api',
        checks: { database: 'up' },
      });
  });

  it('responds 503 when the database is unreachable', async () => {
    databaseUp = false;

    await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(503)
      .expect({
        status: 'error',
        service: 'leccor-finance-flow-api',
        checks: { database: 'down' },
      });
  });
});
