import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { TABS } from '../../src/spreadsheets/spreadsheet-template.js';
import {
  createDisposableDatabase,
  type DisposableDatabase,
} from './disposable-database.js';
import { FakeWorkspace } from './fake-workspace.js';
import {
  connectGoogle,
  createTestApp,
  defaultGrant,
  FakeGoogle,
  FakeGoogleOAuth,
  loginAs,
  type Session,
  testEnv,
} from './support.js';

let db: DisposableDatabase;
let app: NestExpressApplication;
let google: FakeGoogle;
let oauth: FakeGoogleOAuth;
let workspace: FakeWorkspace;

let sequence = 0;
async function newUser(options: { connect?: boolean; givenName?: string } = {}) {
  sequence += 1;
  const email = `planilha${sequence}@example.com`;
  oauth.grant = {
    ...defaultGrant(),
    subject: `g-${sequence}`,
    accessToken: `access-${sequence}`,
  };
  const session = await loginAs(app, google, {
    subject: `sub-${sequence}`,
    email,
    givenName: options.givenName ?? `Pessoa${sequence}`,
  });
  if (options.connect ?? true) await connectGoogle(app, session);
  const user = await db.client.user.findUniqueOrThrow({ where: { email } });
  return { ...session, id: user.id, email, accessToken: `access-${sequence}` };
}

beforeAll(async () => {
  db = await createDisposableDatabase();
  testEnv(db.url);
  google = new FakeGoogle();
  oauth = new FakeGoogleOAuth();
  workspace = new FakeWorkspace();
  app = await createTestApp(google, [], oauth, workspace);
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

beforeEach(() => {
  oauth.refreshBehavior = 'ok';
  workspace.failOnce = {};
  workspace.rejectedTokens.clear();
});

const http = () => request(app.getHttpServer());
const create = (session: Session, body: object = {}) =>
  http()
    .post('/api/v1/spreadsheets')
    .set('Cookie', session.cookie)
    .set('X-CSRF-Token', session.csrf)
    .send(body);

function fileOf(googleSpreadsheetId: string) {
  const file = workspace.files.get(googleSpreadsheetId);
  if (!file) throw new Error('file not found in fake workspace');
  return file;
}

describe('creation', () => {
  it('creates a complete spreadsheet in the user Drive with their token', async () => {
    const user = await newUser({ givenName: 'Ana' });

    const response = await create(user).expect(200);
    const body = response.body as {
      id: string;
      googleSpreadsheetId: string;
      url: string;
    };

    expect(response.body).toMatchObject({
      name: 'Controle Financeiro — Ana',
      status: 'ACTIVE',
      isActive: true,
      locale: 'pt-BR',
      lastErrorCode: null,
    });
    expect(body.url).toBe(
      `https://docs.google.com/spreadsheets/d/${body.googleSpreadsheetId}/edit`,
    );

    const file = fileOf(body.googleSpreadsheetId);
    expect(file.createdWith).toBe(user.accessToken); // created in this user's Drive
    expect(file.appProperties).toEqual({ lffSpreadsheetId: body.id });
    expect(file.locale).toBe('pt_BR');
    expect(file.timeZone).toBe('America/Sao_Paulo');
    expect(file.sheets.map((sheet) => sheet.title)).toEqual([
      'Dashboard',
      'Movimentações',
      'Receitas',
      'Despesas',
      'Contas',
      'Investimentos',
      'Categorias',
      'Orçamento',
      'Metas',
      'Resumo Mensal',
    ]);
    expect(file.sheets.map((sheet) => sheet.tabKey)).toEqual(TABS.map((tab) => tab.key));

    const transactions = file.sheets.find((sheet) => sheet.tabKey === 'transactions');
    expect(transactions?.headers.slice(0, 3)).toEqual(['Tipo', 'Descrição', 'Categoria']);
    expect(transactions?.columnKeys.slice(-3)).toEqual([
      'record_id',
      'record_version',
      'synced_at',
    ]);
    expect(transactions?.protectedRanges).toContain('lff:technical:transactions');
    expect(
      file.sheets.find((sheet) => sheet.tabKey === 'dashboard')?.charts,
    ).toHaveLength(1);
    expect(file.metadataKeys).toEqual(
      expect.arrayContaining(['lff.spreadsheet_id', 'lff.template_version']),
    );
  });

  it('uses the profile language, currency and time zone', async () => {
    const user = await newUser({ givenName: 'Lucía' });
    await http()
      .patch('/api/v1/profile')
      .set('Cookie', user.cookie)
      .set('X-CSRF-Token', user.csrf)
      .send({ locale: 'es-ES', currency: 'EUR', timeZone: 'Europe/Madrid' })
      .expect(200);

    const body = (await create(user).expect(200)).body as {
      name: string;
      locale: string;
      googleSpreadsheetId: string;
    };

    expect(body).toMatchObject({ name: 'Control Financiero — Lucía', locale: 'es-ES' });
    const file = fileOf(body.googleSpreadsheetId);
    expect(file.locale).toBe('es_ES');
    expect(file.timeZone).toBe('Europe/Madrid');
    expect(file.sheets.map((sheet) => sheet.title)).toContain('Movimientos');
    const batch = JSON.stringify(workspace.batches.at(-1));
    expect(batch).toContain('\\"€\\"');
    expect(batch).toContain('"Ingreso"');
  });

  it('accepts a custom name and keeps the first spreadsheet as the active one', async () => {
    const user = await newUser();
    await create(user).expect(200);

    const second = await create(user, { name: 'Viagem Europa' }).expect(200);

    expect(second.body).toMatchObject({
      name: 'Viagem Europa',
      status: 'ACTIVE',
      isActive: false,
    });
    const list = (
      await http().get('/api/v1/spreadsheets').set('Cookie', user.cookie).expect(200)
    ).body as {
      isActive: boolean;
    }[];
    expect(list).toHaveLength(2);
    expect(list.filter((item) => item.isActive)).toHaveLength(1);
  });
});

describe('idempotency', () => {
  it('repeating the request reuses the file and converges to the same state', async () => {
    const user = await newUser();
    const first = (await create(user).expect(200)).body as {
      id: string;
      googleSpreadsheetId: string;
    };
    const before = structuredClone(fileOf(first.googleSpreadsheetId));
    const filesBefore = workspace.liveFiles().length;

    const second = (await create(user).expect(200)).body as {
      id: string;
      googleSpreadsheetId: string;
    };
    await create(user).expect(200);

    expect(second.id).toBe(first.id);
    expect(second.googleSpreadsheetId).toBe(first.googleSpreadsheetId);
    expect(workspace.liveFiles()).toHaveLength(filesBefore);
    const after = fileOf(first.googleSpreadsheetId);
    expect(after.sheets.map((sheet) => sheet.title)).toEqual(
      before.sheets.map((sheet) => sheet.title),
    );
    expect(after.metadataKeys).toEqual(before.metadataKeys);
    for (const sheet of after.sheets) {
      const previous = before.sheets.find((item) => item.sheetId === sheet.sheetId);
      expect(sheet.protectedRanges).toEqual(previous?.protectedRanges);
      expect(sheet.conditionalFormats).toBe(previous?.conditionalFormats);
      expect(sheet.charts).toEqual(previous?.charts);
      expect(sheet.tabKey).toBe(previous?.tabKey);
    }
  });

  it('recovers a file created before a crash instead of creating another one', async () => {
    const user = await newUser();
    const first = (await create(user).expect(200)).body as {
      id: string;
      googleSpreadsheetId: string;
    };
    // Simulate a crash right after Drive created the file, before the id was saved.
    await db.client.spreadsheet.update({
      where: { id: first.id },
      data: { googleSpreadsheetId: null, status: 'PENDING_CREATION', isActive: false },
    });
    const filesBefore = workspace.liveFiles().length;

    const again = (await create(user).expect(200)).body as {
      googleSpreadsheetId: string;
    };

    expect(again.googleSpreadsheetId).toBe(first.googleSpreadsheetId);
    expect(workspace.liveFiles()).toHaveLength(filesBefore);
  });

  it('creates a new file when the user deleted the old one in Drive', async () => {
    const user = await newUser();
    const first = (await create(user).expect(200)).body as {
      id: string;
      googleSpreadsheetId: string;
    };
    fileOf(first.googleSpreadsheetId).deleted = true;

    const again = (await create(user).expect(200)).body as {
      id: string;
      googleSpreadsheetId: string;
    };

    expect(again.id).toBe(first.id);
    expect(again.googleSpreadsheetId).not.toBe(first.googleSpreadsheetId);
    expect(fileOf(again.googleSpreadsheetId).sheets).toHaveLength(TABS.length);
  });

  it('refuses a concurrent setup of the same spreadsheet but recovers from a stale claim', async () => {
    const user = await newUser();
    const first = (await create(user).expect(200)).body as { id: string };

    await db.client.spreadsheet.update({
      where: { id: first.id },
      data: { setupStartedAt: new Date() },
    });
    const busy = await create(user).expect(409);
    expect(busy.body).toMatchObject({ code: 'spreadsheet_setup_in_progress' });

    await db.client.spreadsheet.update({
      where: { id: first.id },
      data: { setupStartedAt: new Date(Date.now() - 3 * 60_000) },
    });
    await create(user).expect(200);
  });
});

describe('tokens and failures', () => {
  it('requires a Google connection', async () => {
    const user = await newUser({ connect: false });

    const response = await create(user).expect(409);

    expect(response.body).toMatchObject({ code: 'google_not_connected' });
    const rows = await db.client.spreadsheet.findMany({ where: { ownerId: user.id } });
    expect(rows).toMatchObject([
      { status: 'ERROR', lastErrorCode: 'google_not_connected', setupStartedAt: null },
    ]);
  });

  it('refreshes an expired access token before calling Google', async () => {
    const user = await newUser();
    await db.client.googleConnection.update({
      where: { userId: user.id },
      data: { accessTokenExpiresAt: new Date(Date.now() - 1000) },
    });
    const refreshesBefore = oauth.refreshCalls.length;

    await create(user).expect(200);

    expect(oauth.refreshCalls.length).toBe(refreshesBefore + 1);
    expect(workspace.tokensUsed.at(-1)).toMatch(/^refreshed-access-/);
  });

  it('retries once with a fresh token when Google answers 401 for a token that looked valid', async () => {
    const user = await newUser();
    workspace.rejectedTokens.add(user.accessToken);

    await create(user).expect(200);

    expect(workspace.tokensUsed).toContain(user.accessToken);
    expect(workspace.tokensUsed.at(-1)).toMatch(/^refreshed-access-/);
  });

  it('asks to reconnect when Google revoked the access', async () => {
    const user = await newUser();
    workspace.rejectedTokens.add(user.accessToken);
    oauth.refreshBehavior = 'revoked';

    const response = await create(user).expect(409);

    expect(response.body).toMatchObject({ code: 'google_reauth_required' });
    expect(
      (await db.client.googleConnection.findUniqueOrThrow({ where: { userId: user.id } }))
        .status,
    ).toBe('NEEDS_REAUTH');
  });

  it('reports Google outages as retryable and succeeds on the next attempt', async () => {
    const user = await newUser();
    workspace.failOnce.batchUpdate = 'unavailable';

    const failed = await create(user).expect(503);
    expect(failed.body).toMatchObject({ code: 'google_unavailable' });
    const row = await db.client.spreadsheet.findFirstOrThrow({
      where: { ownerId: user.id },
    });
    expect(row).toMatchObject({
      status: 'ERROR',
      lastErrorCode: 'google_unavailable',
      setupStartedAt: null,
    });
    expect(row.googleSpreadsheetId).not.toBeNull(); // the file id was kept: no duplicate later

    const filesBefore = workspace.liveFiles().length;
    await create(user).expect(200);
    expect(workspace.liveFiles()).toHaveLength(filesBefore);
  });

  it('maps a permission error to a clear code without exposing Google details', async () => {
    const user = await newUser();
    workspace.failOnce.create = 'forbidden';

    const response = await create(user).expect(409);
    expect(response.body).toMatchObject({ code: 'google_permission_denied' });
    expect(JSON.stringify(response.body)).not.toMatch(/googleapis|access-/);
  });

  it('keeps a working spreadsheet ACTIVE when a repair fails', async () => {
    const user = await newUser();
    await create(user).expect(200);
    workspace.failOnce.get = 'unavailable';

    await create(user).expect(503);

    const row = await db.client.spreadsheet.findFirstOrThrow({
      where: { ownerId: user.id },
    });
    expect(row).toMatchObject({
      status: 'ACTIVE',
      isActive: true,
      lastErrorCode: 'google_unavailable',
    });
  });
});

describe('ownership and input', () => {
  it('lists and reads only the caller spreadsheets', async () => {
    const owner = await newUser();
    const other = await newUser();
    const created = (await create(owner).expect(200)).body as { id: string };

    const otherList = (
      await http().get('/api/v1/spreadsheets').set('Cookie', other.cookie).expect(200)
    ).body as unknown[];
    expect(otherList).toEqual([]);
    await http()
      .get(`/api/v1/spreadsheets/${created.id}`)
      .set('Cookie', other.cookie)
      .expect(404);
    await http()
      .get(`/api/v1/spreadsheets/${created.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);
  });

  it('requires CSRF and validates the payload', async () => {
    const user = await newUser();
    await http()
      .post('/api/v1/spreadsheets')
      .set('Cookie', user.cookie)
      .send({})
      .expect(403);
    for (const body of [
      { name: '' },
      { name: 'x'.repeat(151) },
      { name: 'a\u0000b' },
      { ownerId: user.id },
    ]) {
      const response = await create(user, body).expect(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
    }
    await http().get('/api/v1/spreadsheets').expect(401);
  });
});

describe('without configuration', () => {
  it('answers 503 google_connection_unavailable when no encryption key is set', async () => {
    testEnv(db.url, { DATA_ENCRYPTION_KEY_V1: '' });
    const unconfigured = await createTestApp(
      google,
      [],
      new FakeGoogleOAuth(),
      new FakeWorkspace(),
    );
    try {
      const user = await loginAs(unconfigured, google, {
        subject: 'sub-sheets-nokey',
        email: 'sheets-nokey@example.com',
      });
      const response = await request(unconfigured.getHttpServer())
        .post('/api/v1/spreadsheets')
        .set('Cookie', user.cookie)
        .set('X-CSRF-Token', user.csrf)
        .send({})
        .expect(503);
      expect(response.body).toMatchObject({ code: 'google_connection_unavailable' });
    } finally {
      await unconfigured.close();
      testEnv(db.url);
    }
  });
});
