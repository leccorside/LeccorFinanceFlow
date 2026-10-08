import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClientOptions } from './prisma-options.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_ENV) env: AppEnv) {
    // Lazy: no connection is opened until the first query.
    super(createPrismaClientOptions(env.DATABASE_URL));
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
