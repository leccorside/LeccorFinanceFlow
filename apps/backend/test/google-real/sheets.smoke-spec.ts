/**
 * OPT-IN smoke test against the real Google APIs. Skipped unless:
 *   RUN_GOOGLE_INTEGRATION_TESTS=true
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   (the app's OAuth client)
 *   GOOGLE_TEST_REFRESH_TOKEN                (refresh token of a TEST account, drive.file scope)
 * Run: pnpm --filter @leccor/backend test:google
 *
 * Creates a real spreadsheet in that account, applies the template twice (idempotency),
 * checks the result and deletes the file at the end.
 */
import { randomUUID } from 'node:crypto';
import { OpenIdGoogleOAuthClient } from '../../src/google/google-oauth.client.js';
import {
  DRIVE_FILES_URL,
  HttpGoogleWorkspaceClient,
} from '../../src/spreadsheets/google-workspace.client.js';
import { buildSetupPlan } from '../../src/spreadsheets/spreadsheet-setup.js';
import { TABS } from '../../src/spreadsheets/spreadsheet-template.js';

const enabled =
  process.env.RUN_GOOGLE_INTEGRATION_TESTS === 'true' &&
  Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_TEST_REFRESH_TOKEN,
  );

describe.skipIf(!enabled)('real Google Sheets (opt-in)', () => {
  const workspace = new HttpGoogleWorkspaceClient();
  const rowId = randomUUID();
  let token = '';
  let fileId: string | null = null;

  beforeAll(async () => {
    const oauth = new OpenIdGoogleOAuthClient({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirectUri: 'http://localhost:5173/api/v1/google/callback',
    });
    token = (await oauth.refresh(process.env.GOOGLE_TEST_REFRESH_TOKEN ?? ''))
      .accessToken;
  });

  afterAll(async () => {
    if (fileId) {
      await fetch(`${DRIVE_FILES_URL}/${fileId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
    }
  });

  it('creates, formats and re-applies the template idempotently', async () => {
    fileId = await workspace.createSpreadsheetFile(token, {
      name: `Leccor smoke ${new Date().toISOString()}`,
      appProperties: { lffSpreadsheetId: rowId },
    });
    expect(
      await workspace.findSpreadsheetByAppProperty(token, 'lffSpreadsheetId', rowId),
    ).toBe(fileId);

    const options = {
      spreadsheetRowId: rowId,
      locale: 'pt-BR' as const,
      timeZone: 'America/Sao_Paulo',
      currency: 'BRL',
    };
    await workspace.batchUpdate(
      token,
      fileId,
      buildSetupPlan(await workspace.getSpreadsheet(token, fileId), options).requests,
    );
    const first = await workspace.getSpreadsheet(token, fileId);

    expect(first.locale).toBe('pt_BR');
    expect(first.sheets.map((sheet) => sheet.tabKey)).toEqual(TABS.map((tab) => tab.key));

    const rerun = buildSetupPlan(first, options);
    for (const type of [
      'addSheet',
      'deleteSheet',
      'createDeveloperMetadata',
      'addProtectedRange',
      'addChart',
    ]) {
      expect(rerun.requests.filter((request) => type in request)).toEqual([]);
    }
    await workspace.batchUpdate(token, fileId, rerun.requests);
    const second = await workspace.getSpreadsheet(token, fileId);
    expect(
      second.sheets.map((sheet) => [
        sheet.title,
        sheet.conditionalFormatCount,
        sheet.protectedRangeDescriptions.length,
      ]),
    ).toEqual(
      first.sheets.map((sheet) => [
        sheet.title,
        sheet.conditionalFormatCount,
        sheet.protectedRangeDescriptions.length,
      ]),
    );
  }, 120_000);
});
