import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createDisposableDatabase,
  MIGRATIONS_DIR,
  prisma,
  type DisposableDatabase,
} from './disposable-database.js';

const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const EXPECTED_TABLES = 24;

let db: DisposableDatabase;

beforeAll(async () => {
  db = await createDisposableDatabase({ migrate: false });
});

afterAll(async () => {
  await db?.drop();
});

async function publicObjects() {
  const [row] = await db.query<{ tables: string; types: string; functions: string }>(`
    SELECT
      (SELECT count(*) FROM pg_tables
         WHERE schemaname = 'public' AND tablename <> '_prisma_migrations')::text AS tables,
      (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'public' AND t.typtype = 'e')::text AS types,
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public')::text AS functions
  `);
  return row;
}

describe('migrations', () => {
  it('apply on an empty database', async () => {
    prisma(['migrate', 'deploy'], db.url);

    const objects = await publicObjects();
    // 19 domain tables + user_roles + user_sessions + auth_login_attempts + spreadsheet_row_states + assistant_confirmations
    expect(Number(objects?.tables)).toBe(EXPECTED_TABLES);
    expect(Number(objects?.types)).toBeGreaterThan(0);
    expect(Number(objects?.functions)).toBeGreaterThan(0);
  });

  it('match schema.prisma (no drift)', () => {
    const output = prisma(
      [
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      db.url,
    );
    expect(output).toMatch(/No difference detected|empty migration/i);
  });

  it('revert with down.sql in reverse order and re-apply cleanly', async () => {
    for (const name of [...migrations].reverse()) {
      prisma(['db', 'execute', '--file', join(MIGRATIONS_DIR, name, 'down.sql')], db.url);
    }

    expect(await publicObjects()).toEqual({ tables: '0', types: '0', functions: '0' });
    const [history] = await db.query<{ applied: string }>(
      `SELECT count(*)::text AS applied FROM "_prisma_migrations"`,
    );
    expect(history?.applied).toBe('0');

    prisma(['migrate', 'deploy'], db.url);
    expect(Number((await publicObjects())?.tables)).toBe(EXPECTED_TABLES);
  });
});
