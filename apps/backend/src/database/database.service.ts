import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { APP_ENV, type AppEnv } from '../config/env.js';

/**
 * Minimal PostgreSQL connectivity used by readiness checks.
 * The domain persistence layer (Prisma) arrives in PASSO 03.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: pg.Pool;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    this.pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
    });
    // Idle client errors (e.g. Postgres restart) must not crash the process;
    // the pool discards the broken client and the next ping reports the state.
    this.pool.on('error', () => undefined);
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
