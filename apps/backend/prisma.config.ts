import { defineConfig } from 'prisma/config';

// DATABASE_URL is optional here so `prisma generate` works without a database
// (e.g. during the Docker image build). Migrate/db commands require it.
const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  ...(url ? { datasource: { url } } : {}),
});
