import { PrismaPg } from '@prisma/adapter-pg';
import type { Prisma } from '../generated/prisma/client.js';

/** Shared by the Nest service, the seed script and integration tests. */
export function createPrismaClientOptions(
  connectionString: string,
): Prisma.PrismaClientOptions {
  return {
    adapter: new PrismaPg({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
    }),
  };
}
