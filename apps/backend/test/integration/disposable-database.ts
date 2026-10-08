import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPrismaClientOptions } from '../../src/database/prisma-options.js';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

export const MIGRATIONS_DIR = resolve(backendRoot, 'prisma/migrations');

function adminUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is required for integration tests (a PostgreSQL URL whose user can CREATE DATABASE).',
    );
  }
  return url;
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

async function admin<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Runs the Prisma CLI against `databaseUrl`, throwing with its output on failure. */
export function prisma(args: string[], databaseUrl: string): string {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    encoding: 'utf8',
  });

  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(' ')} failed:\n${output}`);
  }
  return output;
}

export interface DisposableDatabase {
  name: string;
  url: string;
  client: PrismaClient;
  /** Plain SQL access for catalog inspection. */
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(sql: string): Promise<R[]>;
  drop(): Promise<void>;
}

/**
 * Creates a uniquely named database, optionally applies all migrations,
 * and returns a client bound to it. Always call `drop()` in afterAll.
 */
export async function createDisposableDatabase(
  options: { migrate?: boolean } = {},
): Promise<DisposableDatabase> {
  const name = `leccor_test_${Date.now()}_${randomBytes(3).toString('hex')}`;
  await admin((client) => client.query(`CREATE DATABASE "${name}"`));

  const url = withDatabase(adminUrl(), name);
  if (options.migrate ?? true) {
    prisma(['migrate', 'deploy'], url);
  }

  const client = new PrismaClient(createPrismaClientOptions(url));

  return {
    name,
    url,
    client,
    async query(sql) {
      const direct = new pg.Client({ connectionString: url });
      await direct.connect();
      try {
        return (await direct.query(sql)).rows;
      } finally {
        await direct.end();
      }
    },
    async drop() {
      await client.$disconnect();
      await admin((server) =>
        server.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
      );
    },
  };
}
