/**
 * Thin REST client for the Google Drive v3 and Sheets v4 calls the app needs. Uses fetch
 * directly (no `googleapis` package): four endpoints, typed and testable with a fake fetch.
 */

export const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
export const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
export const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

/** Request objects follow the Sheets API `batchUpdate` schema verbatim. */
export type SheetsRequest = Record<string, unknown>;

export interface SheetSnapshot {
  sheetId: number;
  title: string;
  index: number;
  /** Value of the `lff.tab` developer metadata, when present. */
  tabKey: string | null;
  protectedRangeDescriptions: string[];
  conditionalFormatCount: number;
  chartIds: number[];
}

export interface SpreadsheetSnapshot {
  spreadsheetId: string;
  title: string;
  locale: string;
  timeZone: string;
  /** Spreadsheet-level developer metadata keys. */
  metadataKeys: string[];
  sheets: SheetSnapshot[];
}

export type GoogleApiErrorKind =
  | 'unauthorized' // 401: token expired or revoked
  | 'forbidden' // 403: missing scope or file not shared with the app
  | 'not_found' // 404: deleted or never accessible
  | 'rate_limited' // 429
  | 'unavailable' // 5xx or network
  | 'invalid_request'; // 400: a bug in our request

export class GoogleApiError extends Error {
  constructor(
    readonly kind: GoogleApiErrorKind,
    readonly status: number,
  ) {
    // No response body in the message: it may echo request data.
    super(`google api ${kind} (${status})`);
    this.name = 'GoogleApiError';
  }
}

export interface GoogleWorkspaceClient {
  /** Drive search (drive.file scope: only files created/opened by this app are visible). */
  findSpreadsheetByAppProperty(
    token: string,
    key: string,
    value: string,
  ): Promise<string | null>;
  /** Creates an empty spreadsheet file in the user's Drive (owned by the user). */
  createSpreadsheetFile(
    token: string,
    file: { name: string; appProperties: Record<string, string> },
  ): Promise<string>;
  getSpreadsheet(token: string, spreadsheetId: string): Promise<SpreadsheetSnapshot>;
  batchUpdate(
    token: string,
    spreadsheetId: string,
    requests: SheetsRequest[],
  ): Promise<void>;
}

export const GOOGLE_WORKSPACE_CLIENT = Symbol('GOOGLE_WORKSPACE_CLIENT');

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const SNAPSHOT_FIELDS = [
  'spreadsheetId',
  'properties(title,locale,timeZone)',
  'developerMetadata(metadataKey,metadataValue)',
  'sheets(properties(sheetId,title,index)',
  'developerMetadata(metadataKey,metadataValue,location(locationType))',
  'protectedRanges(description)',
  'conditionalFormats(booleanRule(condition(type)))',
  'charts(chartId))',
].join(',');

interface RawMetadata {
  metadataKey?: string;
  metadataValue?: string;
  location?: { locationType?: string };
}

interface RawSpreadsheet {
  spreadsheetId: string;
  properties?: { title?: string; locale?: string; timeZone?: string };
  developerMetadata?: RawMetadata[];
  sheets?: {
    properties?: { sheetId?: number; title?: string; index?: number };
    developerMetadata?: RawMetadata[];
    protectedRanges?: { description?: string }[];
    conditionalFormats?: unknown[];
    charts?: { chartId?: number }[];
  }[];
}

export class HttpGoogleWorkspaceClient implements GoogleWorkspaceClient {
  constructor(private readonly fetchImpl: Fetch = (url, init) => fetch(url, init)) {}

  async findSpreadsheetByAppProperty(
    token: string,
    key: string,
    value: string,
  ): Promise<string | null> {
    const query = `appProperties has { key='${escapeQuery(key)}' and value='${escapeQuery(value)}' } and mimeType='${SPREADSHEET_MIME}' and trashed=false`;
    const url = `${DRIVE_FILES_URL}?${new URLSearchParams({ q: query, fields: 'files(id)', pageSize: '10', spaces: 'drive' })}`;
    const body = (await this.call(token, url, { method: 'GET' })) as {
      files?: { id: string }[];
    };
    return body.files?.[0]?.id ?? null;
  }

  async createSpreadsheetFile(
    token: string,
    file: { name: string; appProperties: Record<string, string> },
  ): Promise<string> {
    const body = (await this.call(token, `${DRIVE_FILES_URL}?fields=id`, {
      method: 'POST',
      body: JSON.stringify({
        name: file.name,
        mimeType: SPREADSHEET_MIME,
        appProperties: file.appProperties,
      }),
    })) as { id: string };
    return body.id;
  }

  async getSpreadsheet(
    token: string,
    spreadsheetId: string,
  ): Promise<SpreadsheetSnapshot> {
    const url = `${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}?${new URLSearchParams({ fields: SNAPSHOT_FIELDS, includeGridData: 'false' })}`;
    return toSnapshot((await this.call(token, url, { method: 'GET' })) as RawSpreadsheet);
  }

  async batchUpdate(
    token: string,
    spreadsheetId: string,
    requests: SheetsRequest[],
  ): Promise<void> {
    if (requests.length === 0) return;
    await this.call(
      token,
      `${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({ requests, includeSpreadsheetInResponse: false }),
      },
    );
  }

  private async call(token: string, url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        redirect: 'error',
      });
    } catch {
      throw new GoogleApiError('unavailable', 0);
    }
    if (!response.ok) {
      throw new GoogleApiError(errorKind(response.status), response.status);
    }
    return response.status === 204 ? {} : response.json();
  }
}

function errorKind(status: number): GoogleApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'invalid_request';
}

/** Drive query strings use single quotes; escape backslashes and quotes. */
function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function tabKeyOf(metadata: RawMetadata[] | undefined): string | null {
  const entry = metadata?.find(
    (item) => item.metadataKey === 'lff.tab' && item.location?.locationType !== 'COLUMN',
  );
  return entry?.metadataValue ?? null;
}

export function toSnapshot(raw: RawSpreadsheet): SpreadsheetSnapshot {
  return {
    spreadsheetId: raw.spreadsheetId,
    title: raw.properties?.title ?? '',
    locale: raw.properties?.locale ?? '',
    timeZone: raw.properties?.timeZone ?? '',
    metadataKeys: (raw.developerMetadata ?? [])
      .map((item) => item.metadataKey)
      .filter((key): key is string => typeof key === 'string'),
    sheets: (raw.sheets ?? []).map((sheet) => ({
      sheetId: sheet.properties?.sheetId ?? 0,
      title: sheet.properties?.title ?? '',
      index: sheet.properties?.index ?? 0,
      tabKey: tabKeyOf(sheet.developerMetadata),
      protectedRangeDescriptions: (sheet.protectedRanges ?? [])
        .map((range) => range.description)
        .filter((description): description is string => typeof description === 'string'),
      conditionalFormatCount: sheet.conditionalFormats?.length ?? 0,
      chartIds: (sheet.charts ?? [])
        .map((chart) => chart.chartId)
        .filter((id): id is number => typeof id === 'number'),
    })),
  };
}
