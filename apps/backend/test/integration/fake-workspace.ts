import {
  GoogleApiError,
  type GoogleApiErrorKind,
  type GoogleWorkspaceClient,
  type SheetsRequest,
  type SpreadsheetSnapshot,
} from '../../src/spreadsheets/google-workspace.client.js';

interface FakeSheet {
  sheetId: number;
  title: string;
  index: number;
  tabKey: string | null;
  protectedRanges: string[];
  conditionalFormats: number;
  charts: number[];
  headers: string[];
  formulas: string[];
  columnKeys: string[];
}

interface FakeFile {
  id: string;
  name: string;
  appProperties: Record<string, string>;
  /** Token that created the file: the file lives in that user's Drive. */
  createdWith: string;
  deleted: boolean;
  locale: string;
  timeZone: string;
  metadataKeys: string[];
  sheets: FakeSheet[];
}

type Method = 'find' | 'create' | 'get' | 'batchUpdate';

/**
 * In-memory Google Drive/Sheets. Applies batchUpdate requests with the rules that matter
 * for correctness: atomic batches, sheets must exist when referenced, no duplicate sheet
 * ids/titles or chart ids, conditional rules can only be deleted when present.
 */
export class FakeWorkspace implements GoogleWorkspaceClient {
  files = new Map<string, FakeFile>();
  tokensUsed: string[] = [];
  /** Tokens Google answers 401 for (e.g. revoked at Google). */
  rejectedTokens = new Set<string>();
  /** Fail the next call of a method once. */
  failOnce: Partial<Record<Method, GoogleApiErrorKind>> = {};
  batches: SheetsRequest[][] = [];
  private counter = 0;

  async findSpreadsheetByAppProperty(
    token: string,
    key: string,
    value: string,
  ): Promise<string | null> {
    this.enter('find', token);
    const file = [...this.files.values()].find(
      (item) => !item.deleted && item.appProperties[key] === value,
    );
    return file?.id ?? null;
  }

  async createSpreadsheetFile(
    token: string,
    input: { name: string; appProperties: Record<string, string> },
  ): Promise<string> {
    this.enter('create', token);
    this.counter += 1;
    const id = `file-${this.counter}`;
    this.files.set(id, {
      id,
      name: input.name,
      appProperties: input.appProperties,
      createdWith: token,
      deleted: false,
      locale: 'en_US',
      timeZone: 'Etc/GMT',
      metadataKeys: [],
      sheets: [blankSheet(0, 'Página1', 0)],
    });
    return id;
  }

  async getSpreadsheet(
    token: string,
    spreadsheetId: string,
  ): Promise<SpreadsheetSnapshot> {
    this.enter('get', token);
    const file = this.file(spreadsheetId);
    return {
      spreadsheetId: file.id,
      title: file.name,
      locale: file.locale,
      timeZone: file.timeZone,
      metadataKeys: [...file.metadataKeys],
      sheets: file.sheets.map((sheet) => ({
        sheetId: sheet.sheetId,
        title: sheet.title,
        index: sheet.index,
        tabKey: sheet.tabKey,
        protectedRangeDescriptions: [...sheet.protectedRanges],
        conditionalFormatCount: sheet.conditionalFormats,
        chartIds: [...sheet.charts],
      })),
    };
  }

  async batchUpdate(
    token: string,
    spreadsheetId: string,
    requests: SheetsRequest[],
  ): Promise<void> {
    this.enter('batchUpdate', token);
    const file = this.file(spreadsheetId);
    const backup = structuredClone(file);
    try {
      for (const request of requests) this.apply(file, request);
      this.batches.push(requests);
    } catch (error) {
      this.files.set(spreadsheetId, backup); // all-or-nothing, like Google
      throw error;
    }
  }

  liveFiles(): FakeFile[] {
    return [...this.files.values()].filter((file) => !file.deleted);
  }

  private enter(method: Method, token: string): void {
    this.tokensUsed.push(token);
    if (this.rejectedTokens.has(token)) throw new GoogleApiError('unauthorized', 401);
    const failure = this.failOnce[method];
    if (failure) {
      delete this.failOnce[method];
      throw new GoogleApiError(failure, 0);
    }
  }

  private file(id: string): FakeFile {
    const file = this.files.get(id);
    if (!file || file.deleted) throw new GoogleApiError('not_found', 404);
    return file;
  }

  private apply(file: FakeFile, request: SheetsRequest): void {
    const [type, body] = Object.entries(request)[0] as [string, Record<string, unknown>];
    const invalid = () => new GoogleApiError('invalid_request', 400);
    const sheet = (id: unknown) => {
      const found = file.sheets.find((item) => item.sheetId === id);
      if (!found) throw invalid();
      return found;
    };

    switch (type) {
      case 'addSheet': {
        const properties = body.properties as {
          sheetId: number;
          title: string;
          index: number;
        };
        if (
          file.sheets.some(
            (item) =>
              item.sheetId === properties.sheetId || item.title === properties.title,
          )
        )
          throw invalid();
        file.sheets.push(
          blankSheet(properties.sheetId, properties.title, properties.index),
        );
        return;
      }
      case 'deleteSheet': {
        sheet(body.sheetId);
        if (file.sheets.length === 1) throw invalid(); // a spreadsheet keeps at least one sheet
        file.sheets = file.sheets.filter((item) => item.sheetId !== body.sheetId);
        return;
      }
      case 'updateSpreadsheetProperties': {
        const properties = body.properties as { locale: string; timeZone: string };
        file.locale = properties.locale;
        file.timeZone = properties.timeZone;
        return;
      }
      case 'createDeveloperMetadata': {
        const metadata = body.developerMetadata as {
          metadataKey: string;
          metadataValue: string;
          location: {
            spreadsheet?: boolean;
            sheetId?: number;
            dimensionRange?: { sheetId: number; startIndex: number };
          };
        };
        if (metadata.location.spreadsheet) {
          file.metadataKeys.push(metadata.metadataKey);
        } else if (metadata.location.dimensionRange) {
          const target = sheet(metadata.location.dimensionRange.sheetId);
          target.columnKeys[metadata.location.dimensionRange.startIndex] =
            metadata.metadataValue;
        } else {
          sheet(metadata.location.sheetId).tabKey = metadata.metadataValue;
        }
        return;
      }
      case 'addProtectedRange': {
        const range = body.protectedRange as {
          description: string;
          range: { sheetId: number };
        };
        sheet(range.range.sheetId).protectedRanges.push(range.description);
        return;
      }
      case 'addConditionalFormatRule': {
        const rule = body.rule as { ranges: { sheetId: number }[] };
        for (const range of rule.ranges) sheet(range.sheetId);
        sheet(rule.ranges[0]?.sheetId).conditionalFormats += 1;
        return;
      }
      case 'deleteConditionalFormatRule': {
        const target = sheet(body.sheetId);
        if (target.conditionalFormats === 0) throw invalid();
        target.conditionalFormats -= 1;
        return;
      }
      case 'addChart': {
        const chart = body.chart as {
          chartId: number;
          position: { overlayPosition: { anchorCell: { sheetId: number } } };
        };
        if (file.sheets.some((item) => item.charts.includes(chart.chartId)))
          throw invalid();
        sheet(chart.position.overlayPosition.anchorCell.sheetId).charts.push(
          chart.chartId,
        );
        return;
      }
      case 'updateCells': {
        const start = body.start as { sheetId: number; rowIndex: number };
        const target = sheet(start.sheetId);
        const rows = body.rows as {
          values: {
            userEnteredValue?: { stringValue?: string; formulaValue?: string };
          }[];
        }[];
        if (start.rowIndex === 0) {
          target.headers =
            rows[0]?.values.map((cell) => cell.userEnteredValue?.stringValue ?? '') ?? [];
        }
        for (const row of rows) {
          for (const cell of row.values) {
            if (
              cell.userEnteredValue?.formulaValue &&
              !target.formulas.includes(cell.userEnteredValue.formulaValue)
            ) {
              target.formulas.push(cell.userEnteredValue.formulaValue);
            }
          }
        }
        return;
      }
      default: {
        // Formatting requests: only check that the referenced sheet exists.
        const referenced = findSheetId(body);
        if (referenced !== undefined) sheet(referenced);
      }
    }
  }
}

function blankSheet(sheetId: number, title: string, index: number): FakeSheet {
  return {
    sheetId,
    title,
    index,
    tabKey: null,
    protectedRanges: [],
    conditionalFormats: 0,
    charts: [],
    headers: [],
    formulas: [],
    columnKeys: [],
  };
}

function findSheetId(value: unknown): number | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  if ('sheetId' in value && typeof (value as { sheetId: unknown }).sheetId === 'number') {
    return (value as { sheetId: number }).sheetId;
  }
  for (const child of Object.values(value)) {
    const found = findSheetId(child);
    if (found !== undefined) return found;
  }
  return undefined;
}
