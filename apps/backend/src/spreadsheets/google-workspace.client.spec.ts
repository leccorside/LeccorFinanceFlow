import {
  DRIVE_FILES_URL,
  GoogleApiError,
  HttpGoogleWorkspaceClient,
  SHEETS_URL,
  SPREADSHEET_MIME,
} from './google-workspace.client.js';

interface Call {
  url: string;
  init: RequestInit;
}

function fake(status: number, body: unknown) {
  const calls: Call[] = [];
  const client = new HttpGoogleWorkspaceClient(async (url, init) => {
    calls.push({ url, init });
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { client, calls };
}

const authorization = (call: Call | undefined) =>
  (call?.init.headers as Record<string, string>).authorization;

describe('HttpGoogleWorkspaceClient', () => {
  it('finds a spreadsheet by appProperty in Drive, excluding trashed files', async () => {
    const { client, calls } = fake(200, { files: [{ id: 'file-9' }] });

    await expect(
      client.findSpreadsheetByAppProperty('tok', 'lffSpreadsheetId', "id'1"),
    ).resolves.toBe('file-9');

    const url = new URL(calls[0]?.url ?? '');
    expect(`${url.origin}${url.pathname}`).toBe(DRIVE_FILES_URL);
    expect(url.searchParams.get('q')).toBe(
      `appProperties has { key='lffSpreadsheetId' and value='id\\'1' } and mimeType='${SPREADSHEET_MIME}' and trashed=false`,
    );
    expect(authorization(calls[0])).toBe('Bearer tok');
  });

  it('returns null when Drive finds nothing', async () => {
    await expect(
      fake(200, { files: [] }).client.findSpreadsheetByAppProperty('t', 'k', 'v'),
    ).resolves.toBeNull();
  });

  it('creates the spreadsheet as a Drive file with appProperties', async () => {
    const { client, calls } = fake(200, { id: 'file-1' });

    await expect(
      client.createSpreadsheetFile('tok', {
        name: 'Controle',
        appProperties: { lffSpreadsheetId: 'row-1' },
      }),
    ).resolves.toBe('file-1');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      name: 'Controle',
      mimeType: SPREADSHEET_MIME,
      appProperties: { lffSpreadsheetId: 'row-1' },
    });
  });

  it('maps the spreadsheet into a snapshot (tab metadata only at sheet level)', async () => {
    const { client, calls } = fake(200, {
      spreadsheetId: 'file-1',
      properties: { title: 'T', locale: 'pt_BR', timeZone: 'America/Sao_Paulo' },
      developerMetadata: [{ metadataKey: 'lff.spreadsheet_id', metadataValue: 'row-1' }],
      sheets: [
        {
          properties: { sheetId: 1001, title: 'Movimentações', index: 1 },
          developerMetadata: [
            {
              metadataKey: 'lff.column',
              metadataValue: 'type',
              location: { locationType: 'COLUMN' },
            },
            {
              metadataKey: 'lff.tab',
              metadataValue: 'transactions',
              location: { locationType: 'SHEET' },
            },
          ],
          protectedRanges: [{ description: 'lff:technical:transactions' }],
          conditionalFormats: [{}, {}],
          charts: [],
        },
        { properties: { sheetId: 0, title: 'Página1', index: 0 } },
      ],
    });

    const snapshot = await client.getSpreadsheet('tok', 'file-1');

    expect(calls[0]?.url.startsWith(`${SHEETS_URL}/file-1?`)).toBe(true);
    expect(snapshot).toEqual({
      spreadsheetId: 'file-1',
      title: 'T',
      locale: 'pt_BR',
      timeZone: 'America/Sao_Paulo',
      metadataKeys: ['lff.spreadsheet_id'],
      sheets: [
        {
          sheetId: 1001,
          title: 'Movimentações',
          index: 1,
          tabKey: 'transactions',
          protectedRangeDescriptions: ['lff:technical:transactions'],
          conditionalFormatCount: 2,
          chartIds: [],
        },
        {
          sheetId: 0,
          title: 'Página1',
          index: 0,
          tabKey: null,
          protectedRangeDescriptions: [],
          conditionalFormatCount: 0,
          chartIds: [],
        },
      ],
    });
  });

  it('sends batchUpdate requests and skips empty batches', async () => {
    const { client, calls } = fake(200, {});
    await client.batchUpdate('tok', 'file-1', [{ deleteSheet: { sheetId: 0 } }]);
    await client.batchUpdate('tok', 'file-1', []);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${SHEETS_URL}/file-1:batchUpdate`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      requests: [{ deleteSheet: { sheetId: 0 } }],
      includeSpreadsheetInResponse: false,
    });
  });

  it.each([
    [400, 'invalid_request'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ] as const)('maps HTTP %i to %s without leaking the body', async (status, kind) => {
    const failure = fake(status, {
      error: { message: 'secret detail ya29.token' },
    }).client.getSpreadsheet('t', 'f');
    await expect(failure).rejects.toMatchObject({ kind, status });
    await expect(failure).rejects.not.toThrow(/secret detail/);
  });

  it('maps network failures to unavailable', async () => {
    const client = new HttpGoogleWorkspaceClient(async () => {
      throw new Error('ECONNRESET');
    });
    await expect(client.getSpreadsheet('t', 'f')).rejects.toBeInstanceOf(GoogleApiError);
    await expect(client.getSpreadsheet('t', 'f')).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});
