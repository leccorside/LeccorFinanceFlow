import { createHash, randomBytes } from 'node:crypto';
import {
  type APIRequestContext,
  type BrowserContext,
  test as base,
  expect,
  request,
} from '@playwright/test';
import pg from 'pg';

/**
 * Real Google sign-in cannot run unattended, so the tests create users and sessions straight
 * in the stack's database — the same rows a Google login produces (user, profile, roles,
 * session with hashed tokens and CSRF token). Nothing in the application changes for tests.
 */
const databaseUrl = process.env.E2E_DATABASE_URL;

let pool: pg.Pool | null = null;
function db(): pg.Pool {
  if (!databaseUrl) {
    throw new Error('E2E_DATABASE_URL is required (PostgreSQL of the stack under test).');
  }
  // Idle connections never keep the test worker alive.
  pool ??= new pg.Pool({ connectionString: databaseUrl, max: 2, allowExitOnIdle: true });
  return pool;
}

const token = () => randomBytes(32).toString('base64url');
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export interface Person {
  id: string;
  email: string;
  firstName: string;
  access: string;
  csrf: string;
}

export async function createPerson(
  options: {
    admin?: boolean;
    firstName?: string;
    locale?: 'pt_BR' | 'en_US' | 'es_ES';
  } = {},
): Promise<Person> {
  const email = `e2e-${randomBytes(5).toString('hex')}@example.com`;
  const firstName = options.firstName ?? 'Ana';
  const access = token();
  const csrf = token();
  const client = await db().connect();
  let id: string;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (id, email, google_subject, last_login_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, now(), now()) RETURNING id`,
      [email, `e2e-${email}`],
    );
    id = rows[0]!.id;
    await client.query(
      `INSERT INTO user_profiles (user_id, first_name, locale, updated_at)
       VALUES ($1, $2, $3, now())`,
      [id, firstName, options.locale ?? 'pt_BR'],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = ANY($2)`,
      [id, options.admin ? ['USER', 'ADMIN'] : ['USER']],
    );
    await client.query(
      `INSERT INTO user_sessions (id, user_id, access_token_hash, access_expires_at,
         refresh_token_hash, refresh_expires_at, csrf_token)
       VALUES (gen_random_uuid(), $1, $2, now() + interval '2 hours', $3,
         now() + interval '1 day', $4)`,
      [id, sha256(access), sha256(token()), csrf],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { id, email, firstName, access, csrf };
}

export async function signIn(context: BrowserContext, person: Person, baseURL: string) {
  const { hostname } = new URL(baseURL);
  await context.addCookies([
    {
      name: 'lff_session',
      value: person.access,
      domain: hostname,
      path: '/api',
      httpOnly: true,
      sameSite: 'Lax',
      secure: baseURL.startsWith('https:'),
    },
  ]);
}

/** API client acting as `person` (cookie + CSRF + same origin), for arranging data. */
export async function apiAs(person: Person, baseURL: string): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: `${baseURL}/api/v1/`,
    extraHTTPHeaders: {
      Cookie: `lff_session=${person.access}`,
      'X-CSRF-Token': person.csrf,
      Origin: baseURL,
    },
  });
}

/** Today in the users' time zone (America/Sao_Paulo), as YYYY-MM-DD. */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
}

/** Money as the UI shows it in pt-BR (any kind of space after R$). */
export const brl = (text: string) => new RegExp(`R\\$\\s${text.replace(/\./g, '\\.')}`);

type Fixtures = { person: Person; api: APIRequestContext };

/** A signed-in regular user per test, with an API client for arranging data. */
export const test = base.extend<Fixtures>({
  person: async ({ context, baseURL }, use) => {
    const person = await createPerson();
    await signIn(context, person, baseURL!);
    await use(person);
  },
  api: async ({ person, baseURL }, use) => {
    const api = await apiAs(person, baseURL!);
    await use(api);
    await api.dispose();
  },
});

export { expect };
