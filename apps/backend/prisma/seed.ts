import { loadEnv } from '../src/config/env.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { createPrismaClientOptions } from '../src/database/prisma-options.js';
import { seedDatabase } from '../src/database/seed.js';

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  const prisma = new PrismaClient(createPrismaClientOptions(env.DATABASE_URL));

  try {
    const result = await seedDatabase(prisma);
    console.info(
      `Seed applied: ${result.roles} roles, ${result.categories} system categories, ${result.aiProviders} AI providers.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
