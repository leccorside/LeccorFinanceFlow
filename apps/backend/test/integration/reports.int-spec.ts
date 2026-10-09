import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { ChatRequest } from '../../src/ai/ai.types.js';
import { seedDatabase } from '../../src/database/seed.js';
import { pdfText, readXlsx, type XlsxCell } from '../office-readers.js';
import {
  createDisposableDatabase,
  type DisposableDatabase,
} from './disposable-database.js';
import { FakeAiClients } from './fake-ai.js';
import { createTestApp, FakeGoogle, loginAs, type Session, testEnv } from './support.js';

let db: DisposableDatabase;
let app: NestExpressApplication;
let google: FakeGoogle;
let ai: FakeAiClients;
let category: Record<string, string>;
let tempDir: string;

type Json = Record<string, unknown>;
interface Report {
  id: string;
  type: string;
  format: string;
  status: string;
  fileName: string | null;
  downloadUrl: string | null;
  expiresAt: string;
  from: string;
  to: string;
}

const TYPES = [
  'MONTHLY',
  'ANNUAL',
  'INCOME',
  'EXPENSES',
  'CATEGORIES',
  'INVESTMENTS',
  'ACCOUNTS',
  'CASH_FLOW',
  'CONSOLIDATED',
] as const;

let sequence = 0;
async function newUser(target = app) {
  sequence += 1;
  const email = `rep${sequence}@example.com`;
  const session = await loginAs(target, google, { subject: `rep-${sequence}`, email });
  await call(
    session,
    'patch',
    '/profile',
    {
      firstName: 'Ana',
      lastName: 'Souza',
      timeZone: 'America/Sao_Paulo',
    },
    target,
  ).expect(200);
  return session;
}

function call(
  s: Session | null,
  method: 'get' | 'post' | 'patch',
  path: string,
  body?: object,
  target = app,
  csrf = true,
) {
  const server = request(target.getHttpServer());
  const req = server[method](`/api/v1${path}`);
  if (s) {
    req.set('Cookie', s.cookie);
    if (method !== 'get' && csrf) req.set('X-CSRF-Token', s.csrf);
  }
  return body ? req.send(body) : req;
}

async function post(s: Session, path: string, body: object, target = app) {
  const response = await call(s, 'post', path, body, target);
  if (response.status !== 201) {
    throw new Error(`POST ${path} → ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body as Json & { id: string };
}

const generate = (s: Session, body: object) =>
  post(s, '/reports', body) as Promise<Report & Json>;

function download(s: Session | null, url: string, target = app) {
  const server = request(target.getHttpServer());
  const req = server
    .get(url)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  if (s) req.set('Cookie', s.cookie);
  return req;
}

/** Value next to a label in the summary sheet, inside the block titled `block`. */
function besideLabel(
  cells: XlsxCell[],
  block: string,
  label: string,
): number | string | undefined {
  const rowOf = (cell: XlsxCell) => Number(cell.ref.replace(/[A-Z]+/, ''));
  const start = cells.find((cell) => cell.value === block);
  if (!start) return undefined;
  const row = cells
    .filter(
      (cell) =>
        cell.ref.startsWith('A') && cell.value === label && rowOf(cell) > rowOf(start),
    )
    .map(rowOf)
    .sort((a, b) => a - b)[0];
  return cells.find((cell) => cell.ref === `B${row}`)?.value;
}

/** Cell value in the totals row (the last row) of a sheet, at a column letter. */
function totalAt(cells: XlsxCell[], column: string): number | string | undefined {
  const last = Math.max(...cells.map((cell) => Number(cell.ref.replace(/[A-Z]+/, ''))));
  return cells.find((cell) => cell.ref === `${column}${last}`)?.value;
}

/** March 2026 with salary, food, transport, a transfer, an investment and a USD account. */
async function populated(target = app) {
  const user = await newUser(target);
  const checking = await post(
    user,
    '/accounts',
    { type: 'CHECKING', name: 'Corrente', initialBalance: '1000' },
    target,
  );
  const savings = await post(
    user,
    '/accounts',
    { type: 'SAVINGS', name: 'Poupança', initialBalance: '500' },
    target,
  );
  const tx = (body: Json) =>
    post(
      user,
      '/transactions',
      { type: 'EXPENSE', description: 'Gasto', ...body },
      target,
    );
  await tx({
    type: 'INCOME',
    description: 'Salário',
    amount: '5000',
    occurredOn: '2026-03-05',
    accountId: checking.id,
    categoryId: category.salary,
  });
  await tx({
    type: 'INCOME',
    description: 'Freela',
    amount: '800',
    occurredOn: '2026-03-20',
    accountId: checking.id,
    categoryId: category.freelance,
  });
  await tx({
    description: 'Mercado',
    amount: '1000',
    occurredOn: '2026-03-06',
    accountId: checking.id,
    categoryId: category.food,
  });
  await tx({
    description: 'Uber',
    amount: '250.50',
    occurredOn: '2026-03-07',
    categoryId: category.transport,
  });
  await tx({
    description: 'Internet',
    amount: '120',
    occurredOn: '2026-03-25',
    dueOn: '2026-03-25',
  });
  await tx({
    type: 'TRANSFER',
    description: 'Reserva',
    amount: '200',
    occurredOn: '2026-03-10',
    accountId: checking.id,
    transferAccountId: savings.id,
  });
  await tx({
    description: 'Mercado',
    amount: '700',
    occurredOn: '2026-02-06',
    accountId: checking.id,
    categoryId: category.food,
  });
  const fund = await post(
    user,
    '/investments',
    { assetClass: 'TREASURY', name: 'Tesouro', totalCost: '2000' },
    target,
  );
  await call(
    user,
    'post',
    `/investments/${fund.id}/contributions`,
    { amount: '500', occurredOn: '2026-03-15', accountId: checking.id },
    target,
  ).expect(201);
  const usd = await post(
    user,
    '/accounts',
    { type: 'CHECKING', name: 'USD', currency: 'USD', initialBalance: '100' },
    target,
  );
  await tx({
    amount: '10',
    currency: 'USD',
    occurredOn: '2026-03-08',
    accountId: usd.id,
  });
  return user;
}

beforeAll(async () => {
  db = await createDisposableDatabase();
  await seedDatabase(db.client);
  tempDir = mkdtempSync(join(tmpdir(), 'leccor-reports-'));
  testEnv(db.url, { OPENAI_API_KEY: 'sk-env-openai', REPORT_TEMP_DIRECTORY: tempDir });
  google = new FakeGoogle();
  ai = new FakeAiClients();
  app = await createTestApp(google, [], undefined, undefined, ai);
  const rows = await db.client.category.findMany({ where: { ownerId: null } });
  category = Object.fromEntries(rows.map((row) => [row.systemKey as string, row.id]));
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.OPENAI_API_KEY;
  delete process.env.REPORT_TEMP_DIRECTORY;
  delete process.env.MAX_REPORT_TRANSACTIONS;
});

describe('generation', () => {
  it('produces every report type as a readable PDF and XLSX for its owner', async () => {
    const user = await populated();
    for (const type of TYPES) {
      const period =
        type === 'MONTHLY'
          ? { month: '2026-03' }
          : type === 'ANNUAL'
            ? { year: 2026 }
            : { from: '2026-02-01', to: '2026-03-31' };
      for (const format of ['PDF', 'XLSX'] as const) {
        const report = await generate(user, { type, format, ...period });
        expect(report).toMatchObject({ type, format, status: 'READY' });
        expect(report.downloadUrl).toBe(`/api/v1/reports/${report.id}/download`);
        const response = await download(user, report.downloadUrl as string).expect(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['content-disposition']).toMatch(
          new RegExp(
            `^attachment; filename="[a-z0-9-]+_\\d{4}-\\d{2}-\\d{2}_\\d{4}-\\d{2}-\\d{2}\\.${format === 'PDF' ? 'pdf' : 'xlsx'}"`,
          ),
        );
        const body = response.body as Buffer;
        if (format === 'PDF') {
          expect(response.headers['content-type']).toBe('application/pdf');
          expect(body.subarray(0, 5).toString()).toBe('%PDF-');
          expect(pdfText(body)).toContain('Ana Souza');
        } else {
          expect(response.headers['content-type']).toBe(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          );
          expect(readXlsx(body).size).toBeGreaterThan(0);
        }
      }
    }
    const list = (await call(user, 'get', '/reports').expect(200)).body as Report[];
    expect(list).toHaveLength(18);
  });

  it('carries the same totals as the API', async () => {
    const user = await populated();
    const summary = (
      await call(user, 'get', '/finance/summary?from=2026-03-01&to=2026-03-31').expect(
        200,
      )
    ).body as { currencies: (Json & { currency: string })[] };
    const brl = summary.currencies.find((item) => item.currency === 'BRL') as unknown as {
      incomes: { total: string };
      expenses: { total: string };
      investments: { total: string };
    };

    const monthly = await generate(user, {
      type: 'MONTHLY',
      format: 'XLSX',
      month: '2026-03',
    });
    const sheets = readXlsx(
      (await download(user, monthly.downloadUrl as string).expect(200)).body as Buffer,
    );
    const names = [...sheets.keys()];
    expect(names).toEqual(
      expect.arrayContaining([
        'Resumo',
        'Despesas por categoria (BRL)',
        'Lançamentos (BRL)',
        'Lançamentos (USD)',
      ]),
    );
    const resumo = sheets.get('Resumo') ?? [];
    expect(besideLabel(resumo, 'Resumo (BRL)', 'Receitas')).toBe(
      Number(brl.incomes.total),
    );
    expect(besideLabel(resumo, 'Resumo (BRL)', 'Despesas')).toBe(
      Number(brl.expenses.total),
    );
    expect(besideLabel(resumo, 'Resumo (BRL)', 'Investimentos')).toBe(
      Number(brl.investments.total),
    );
    expect(totalAt(sheets.get('Despesas por categoria (BRL)') ?? [], 'B')).toBe(
      Number(brl.expenses.total),
    );
    // USD never mixes with BRL.
    expect(besideLabel(resumo, 'Resumo (USD)', 'Despesas')).toBe(10);

    const flow = await generate(user, {
      type: 'CASH_FLOW',
      format: 'XLSX',
      from: '2026-03-01',
      to: '2026-03-31',
    });
    const flowSheets = readXlsx(
      (await download(user, flow.downloadUrl as string).expect(200)).body as Buffer,
    );
    const cashFlow = flowSheets.get('Fluxo de caixa (BRL)') ?? [];
    expect(totalAt(cashFlow, 'B')).toBe(Number(brl.incomes.total));
    expect(totalAt(cashFlow, 'C')).toBe(Number(brl.expenses.total));
    expect(totalAt(cashFlow, 'D')).toBe(500);

    const accounts = (
      await call(user, 'get', '/accounts?includeArchived=true').expect(200)
    ).body as { currency: string; balance: string }[];
    const report = await generate(user, {
      type: 'ACCOUNTS',
      format: 'XLSX',
      from: '2026-03-01',
      to: '2026-03-31',
    });
    const accountSheets = readXlsx(
      (await download(user, report.downloadUrl as string).expect(200)).body as Buffer,
    );
    expect(totalAt(accountSheets.get('Contas (BRL)') ?? [], 'D')).toBe(
      accounts
        .filter((item) => item.currency === 'BRL')
        .reduce((sum, item) => sum + Number(item.balance), 0),
    );

    const expenses = await generate(user, {
      type: 'EXPENSES',
      format: 'PDF',
      from: '2026-03-01',
      to: '2026-03-31',
    });
    const text = pdfText(
      (await download(user, expenses.downloadUrl as string).expect(200)).body as Buffer,
    );
    expect(text).toContain('Relatório de despesas');
    expect(text).toContain('Mercado');
    expect(text).toContain('Uber');
    expect(text).toContain('R$ 1.370,50'); // 1000 + 250.50 + 120
  });

  it('writes the file only under the owner folder, private to the server', async () => {
    const user = await populated();
    const report = await generate(user, {
      type: 'MONTHLY',
      format: 'PDF',
      month: '2026-03',
    });
    const row = await db.client.report.findUniqueOrThrow({ where: { id: report.id } });
    const path = join(tempDir, row.storageKey as string);
    expect(row.storageKey).toMatch(new RegExp(`^${row.ownerId}/${report.id}\\.pdf$`));
    expect(existsSync(path)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('access', () => {
  it("never serves another user's report and needs a session", async () => {
    const owner = await populated();
    const stranger = await newUser();
    const report = await generate(owner, {
      type: 'MONTHLY',
      format: 'PDF',
      month: '2026-03',
    });

    await download(stranger, report.downloadUrl as string).expect(404);
    await download(null, report.downloadUrl as string).expect(401);
    expect((await call(stranger, 'get', '/reports').expect(200)).body).toEqual([]);
    await call(stranger, 'get', '/reports/not-a-uuid/download').expect(400);
    await download(owner, report.downloadUrl as string).expect(200);
  });

  it('requires CSRF to generate', async () => {
    const user = await newUser();
    await call(
      user,
      'post',
      '/reports',
      { type: 'MONTHLY', format: 'PDF', month: '2026-03' },
      app,
      false,
    ).expect(403);
  });
});

describe('expiration', () => {
  it('deletes the file when it expires and answers 410', async () => {
    const user = await populated();
    const report = await generate(user, {
      type: 'INCOME',
      format: 'XLSX',
      from: '2026-03-01',
      to: '2026-03-31',
    });
    const row = await db.client.report.findUniqueOrThrow({ where: { id: report.id } });
    const path = join(tempDir, row.storageKey as string);
    expect(new Date(report.expiresAt).getTime() - Date.now()).toBeGreaterThan(
      25 * 60_000,
    );

    await db.client.report.update({
      where: { id: report.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const gone = await call(user, 'get', `/reports/${report.id}/download`).expect(410);
    expect(gone.body.code).toBe('report_expired');
    expect(existsSync(path)).toBe(false);
    const list = (await call(user, 'get', '/reports').expect(200)).body as Report[];
    expect(list.find((item) => item.id === report.id)).toMatchObject({
      status: 'EXPIRED',
      downloadUrl: null,
    });
  });

  it('sweeps expired files of everyone when reports are listed or generated', async () => {
    const ana = await populated();
    const bia = await populated();
    const old = await generate(ana, { type: 'MONTHLY', format: 'PDF', month: '2026-03' });
    const row = await db.client.report.findUniqueOrThrow({ where: { id: old.id } });
    await db.client.report.update({
      where: { id: old.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await call(bia, 'get', '/reports').expect(200);

    expect(existsSync(join(tempDir, row.storageKey as string))).toBe(false);
    expect(
      (await db.client.report.findUniqueOrThrow({ where: { id: old.id } })).status,
    ).toBe('EXPIRED');
  });

  it('answers 410 when the temporary file is gone', async () => {
    const user = await populated();
    const report = await generate(user, {
      type: 'MONTHLY',
      format: 'PDF',
      month: '2026-03',
    });
    const row = await db.client.report.findUniqueOrThrow({ where: { id: report.id } });
    rmSync(join(tempDir, row.storageKey as string));
    await call(user, 'get', `/reports/${report.id}/download`).expect(410);
  });
});

describe('limits and validation', () => {
  it('refuses wrong periods and ambiguous requests', async () => {
    const user = await newUser();
    const refused = async (body: object, status: number, code?: string) => {
      const response = await call(user, 'post', '/reports', body).expect(status);
      if (code) expect(response.body.code).toBe(code);
    };
    await refused(
      { type: 'MONTHLY', format: 'PDF', from: '2026-03-02', to: '2026-03-31' },
      422,
      'report_period_invalid',
    );
    await refused(
      { type: 'ANNUAL', format: 'PDF', month: '2026-03' },
      422,
      'report_period_invalid',
    );
    await refused(
      { type: 'INCOME', format: 'PDF', from: '2010-01-01', to: '2026-03-31' },
      422,
      'report_period_too_long',
    );
    await refused({ type: 'INCOME', format: 'PDF', month: '2026-03', year: 2026 }, 400);
    await refused({ type: 'INCOME', format: 'DOCX', month: '2026-03' }, 400);
    await refused({ type: 'WEEKLY', format: 'PDF', month: '2026-03' }, 400);
    await refused({ type: 'INCOME', format: 'PDF' }, 400);
    const mine = (await call(user, 'get', '/reports').expect(200)).body as Report[];
    expect(mine).toEqual([]);
  });

  it('refuses a period with more movements than the limit (volume exceeded)', async () => {
    process.env.MAX_REPORT_TRANSACTIONS = '3';
    const small = await createTestApp(google, [], undefined, undefined, ai);
    try {
      const user = await populated(small);
      const response = await call(
        user,
        'post',
        '/reports',
        { type: 'MONTHLY', format: 'PDF', month: '2026-03' },
        small,
      ).expect(422);
      expect(response.body).toMatchObject({
        code: 'report_too_large',
        details: { limit: 3 },
      });
      const fine = await call(
        user,
        'post',
        '/reports',
        { type: 'MONTHLY', format: 'PDF', month: '2026-01' },
        small,
      ).expect(201);
      expect(fine.body.status).toBe('READY');
    } finally {
      await small.close();
      delete process.env.MAX_REPORT_TRANSACTIONS;
    }
  });
});

describe('assistant', () => {
  it('"Gere meu relatório financeiro de março em PDF" returns a download for the chat', async () => {
    await db.client.aIProvider.updateMany({ data: { isActive: true } });
    const openai = await db.client.aIProvider.findFirstOrThrow({
      where: { type: 'OPENAI' },
    });
    await db.client.aIConfiguration.create({
      data: { providerId: openai.id, purpose: 'CHAT', model: 'gpt-test', priority: 1 },
    });
    const user = await populated();
    ai.OPENAI.handler = (req: ChatRequest) =>
      req.messages.some((message) => message.role === 'tool')
        ? { text: 'Pronto! Seu relatório de março está disponível para download.' }
        : {
            toolCalls: [
              {
                id: 'r1',
                name: 'generate_report',
                arguments: { type: 'MONTHLY', month: '2026-03' },
              },
            ],
          };

    const turn = (
      await call(user, 'post', '/assistant/messages', {
        message: 'Gere meu relatório financeiro de março em PDF.',
      }).expect(200)
    ).body as {
      actions: Json[];
      attachments: { url: string; fileName: string; format: string }[];
    };

    expect(turn.actions).toEqual([
      expect.objectContaining({ tool: 'generate_report', status: 'ok' }),
    ]);
    expect(turn.attachments).toEqual([
      expect.objectContaining({
        kind: 'report',
        format: 'PDF',
        fileName: 'relatorio-mensal_2026-03-01_2026-03-31.pdf',
      }),
    ]);
    const file = (await download(user, turn.attachments[0]?.url as string).expect(200))
      .body as Buffer;
    expect(pdfText(file)).toContain('Relatório mensal');
  });
});
