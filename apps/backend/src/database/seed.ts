import type { PrismaClient } from '../generated/prisma/client.js';
import { DEFAULT_CATEGORIES, DEFAULT_ROLES } from './seed-data.js';

export interface SeedResult {
  roles: number;
  categories: number;
}

/**
 * Idempotent seed: upserts by natural keys (role name, category systemKey),
 * so running it any number of times converges to the same state.
 */
export async function seedDatabase(prisma: PrismaClient): Promise<SeedResult> {
  return prisma.$transaction(async (tx) => {
    for (const role of DEFAULT_ROLES) {
      await tx.role.upsert({
        where: { name: role.name },
        create: role,
        update: { description: role.description },
      });
    }

    for (const category of DEFAULT_CATEGORIES) {
      const data = {
        name: category.name,
        kind: category.kind,
        color: category.color,
        icon: category.icon,
      };

      await tx.category.upsert({
        where: { systemKey: category.systemKey },
        create: { ...data, systemKey: category.systemKey },
        update: data,
      });
    }

    return { roles: DEFAULT_ROLES.length, categories: DEFAULT_CATEGORIES.length };
  });
}
