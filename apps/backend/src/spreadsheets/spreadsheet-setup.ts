import type { LocaleTag } from '../profile/profile.schemas.js';
import type { SheetsRequest, SpreadsheetSnapshot } from './google-workspace.client.js';
import {
  type ColumnFormat,
  columnIndex,
  type LocaleTexts,
  type TabKey,
  type TabSpec,
  TABS,
  TEMPLATE_VERSION,
  TEXTS,
} from './spreadsheet-template.js';

export const METADATA = {
  spreadsheetId: 'lff.spreadsheet_id',
  templateVersion: 'lff.template_version',
  tab: 'lff.tab',
  column: 'lff.column',
} as const;

/** Deterministic ids so one batchUpdate can add a sheet and format it right away. */
export const SHEET_ID_BASE = 1000;
export const DASHBOARD_CHART_ID = 9001;
const DATA_ROWS = 1000;

export interface SetupOptions {
  /** Our database id; stored as metadata and Drive appProperty (idempotent lookup). */
  spreadsheetRowId: string;
  locale: LocaleTag;
  timeZone: string;
  currency: string;
}

export interface SetupPlan {
  requests: SheetsRequest[];
  sheetIds: Record<TabKey, number>;
  tabTitles: Record<TabKey, string>;
}

/** Sheets locale codes are underscore-separated. */
export function sheetsLocale(locale: LocaleTag): string {
  return locale.replace('-', '_');
}

export function columnLetter(index: number): string {
  let letters = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

export function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

/** A formula string literal. */
function text(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Number format pattern that shows the profile currency with the spreadsheet locale's
 * separators (the pattern's "," and "." are placeholders the locale renders).
 */
export function currencyPattern(currency: string, locale: LocaleTag): string {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const parts = formatter.formatToParts(1);
  const symbol = parts.find((part) => part.type === 'currency')?.value ?? currency;
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const number = digits > 0 ? `#,##0.${'0'.repeat(digits)}` : '#,##0';
  const symbolFirst =
    parts.findIndex((part) => part.type === 'currency') <
    parts.findIndex((part) => part.type === 'integer');
  const quoted = `"${symbol.replace(/"/g, '')}"`;
  return symbolFirst
    ? `${quoted} ${number};-${quoted} ${number}`
    : `${number} ${quoted};-${number} ${quoted}`;
}

function numberFormat(
  format: ColumnFormat,
  currency: string,
  locale: LocaleTag,
): Record<string, string> {
  switch (format) {
    case 'currency':
      return { type: 'CURRENCY', pattern: currencyPattern(currency, locale) };
    case 'date':
      return { type: 'DATE' };
    case 'datetime':
      return { type: 'DATE_TIME' };
    case 'integer':
      return { type: 'NUMBER', pattern: '0' };
    case 'decimal':
      return { type: 'NUMBER', pattern: '#,##0.##########' };
    case 'percent':
      return { type: 'PERCENT', pattern: '0%' };
    default:
      return { type: 'TEXT', pattern: '@' };
  }
}

function rgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return {
    red: ((value >> 16) & 255) / 255,
    green: ((value >> 8) & 255) / 255,
    blue: (value & 255) / 255,
  };
}

const WHITE = rgb('#FFFFFF');
const TECHNICAL_GREY = rgb('#6B7280');

interface ResolvedTab {
  spec: TabSpec;
  sheetId: number;
  title: string;
  existing: boolean;
  protectedDescriptions: string[];
  conditionalFormatCount: number;
  chartIds: number[];
  hasTabMetadata: boolean;
}

/**
 * Computes the batchUpdate requests that bring `snapshot` to the template. Idempotent:
 * additive items (sheets, metadata, protected ranges, chart) are only created when missing;
 * everything else (headers, formats, validation, filters, formulas, conditional formats) is
 * rewritten to the same state. User data rows are never touched.
 */
export function buildSetupPlan(
  snapshot: SpreadsheetSnapshot,
  options: SetupOptions,
): SetupPlan {
  const texts = TEXTS[options.locale];
  const firstSetup = !snapshot.metadataKeys.includes(METADATA.spreadsheetId);
  const used = new Set<number>();

  const tabs: ResolvedTab[] = TABS.map((spec, position) => {
    const byKey = snapshot.sheets.find((sheet) => sheet.tabKey === spec.key);
    const byTitle = snapshot.sheets.find(
      (sheet) => sheet.tabKey === null && sheet.title === texts.tabs[spec.key],
    );
    const sheet = byKey ?? byTitle;
    const sheetId = sheet?.sheetId ?? SHEET_ID_BASE + position;
    used.add(sheetId);
    return {
      spec,
      sheetId,
      title: sheet?.title ?? texts.tabs[spec.key],
      existing: sheet !== undefined,
      protectedDescriptions: sheet?.protectedRangeDescriptions ?? [],
      conditionalFormatCount: sheet?.conditionalFormatCount ?? 0,
      chartIds: sheet?.chartIds ?? [],
      hasTabMetadata: sheet?.tabKey === spec.key,
    };
  });

  const byKey = Object.fromEntries(tabs.map((tab) => [tab.spec.key, tab])) as Record<
    TabKey,
    ResolvedTab
  >;
  const requests: SheetsRequest[] = [];

  requests.push({
    updateSpreadsheetProperties: {
      properties: { locale: sheetsLocale(options.locale), timeZone: options.timeZone },
      fields: 'locale,timeZone',
    },
  });
  if (firstSetup) {
    requests.push(
      metadataRequest(METADATA.spreadsheetId, options.spreadsheetRowId, {
        spreadsheet: true,
      }),
      metadataRequest(METADATA.templateVersion, String(TEMPLATE_VERSION), {
        spreadsheet: true,
      }),
    );
  }

  // 1. Missing tabs, in template order.
  tabs.forEach((tab, position) => {
    if (!tab.existing) {
      requests.push({
        addSheet: {
          properties: {
            sheetId: tab.sheetId,
            title: tab.title,
            index: position,
            tabColor: rgb(tab.spec.color),
            gridProperties: {
              rowCount: tab.spec.kind === 'dashboard' ? 40 : DATA_ROWS,
              columnCount: Math.max(
                tab.spec.columns.length,
                tab.spec.kind === 'dashboard' ? 12 : 1,
              ),
              frozenRowCount: 1,
            },
          },
        },
      });
    }
  });

  // 2. On the very first setup, drop the blank default sheet Google creates ("Sheet1"…).
  if (firstSetup) {
    for (const sheet of snapshot.sheets) {
      if (!used.has(sheet.sheetId) && sheet.tabKey === null) {
        requests.push({ deleteSheet: { sheetId: sheet.sheetId } });
      }
    }
  }

  // 3. Per-tab layout.
  for (const tab of tabs) {
    requests.push(...tabLayout(tab, texts, options));
    if (!tab.hasTabMetadata) {
      requests.push(
        metadataRequest(METADATA.tab, tab.spec.key, { sheetId: tab.sheetId }),
      );
    }
    if (!tab.existing) {
      tab.spec.columns.forEach((column, index) => {
        requests.push(
          metadataRequest(METADATA.column, column.key, {
            sheetId: tab.sheetId,
            columnIndex: index,
          }),
        );
      });
    }
  }

  // 4. Formulas and generated content.
  requests.push(...viewFormulas(byKey, 'incomes', 0, texts));
  requests.push(...viewFormulas(byKey, 'expenses', 1, texts));
  requests.push(...dashboardContent(byKey, texts, options));
  requests.push(...summaryContent(byKey, texts));
  requests.push(...planningFormulas(byKey, texts));

  // 5. Conditional formats: replace ours wholesale.
  requests.push(...conditionalFormats(byKey, texts));

  // 6. Chart on the dashboard (once).
  if (!byKey.dashboard.chartIds.includes(DASHBOARD_CHART_ID)) {
    requests.push(dashboardChart(byKey, texts));
  }

  return {
    requests,
    sheetIds: Object.fromEntries(
      tabs.map((tab) => [tab.spec.key, tab.sheetId]),
    ) as Record<TabKey, number>,
    tabTitles: Object.fromEntries(tabs.map((tab) => [tab.spec.key, tab.title])) as Record<
      TabKey,
      string
    >,
  };
}

function metadataRequest(
  key: string,
  value: string,
  location: { spreadsheet: true } | { sheetId: number; columnIndex?: number },
): SheetsRequest {
  const locationSpec =
    'spreadsheet' in location
      ? { spreadsheet: true }
      : location.columnIndex === undefined
        ? { sheetId: location.sheetId }
        : {
            dimensionRange: {
              sheetId: location.sheetId,
              dimension: 'COLUMNS',
              startIndex: location.columnIndex,
              endIndex: location.columnIndex + 1,
            },
          };
  return {
    createDeveloperMetadata: {
      developerMetadata: {
        metadataKey: key,
        metadataValue: value,
        location: locationSpec,
        visibility: 'DOCUMENT',
      },
    },
  };
}

function tabLayout(
  tab: ResolvedTab,
  texts: LocaleTexts,
  options: SetupOptions,
): SheetsRequest[] {
  const { spec, sheetId } = tab;
  const requests: SheetsRequest[] = [];
  const columns = spec.columns;

  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        tabColor: rgb(spec.color),
        gridProperties: { frozenRowCount: 1 },
      },
      fields: 'tabColor,gridProperties.frozenRowCount',
    },
  });

  // Header row: localized labels, bold, tab color; technical headers in grey.
  requests.push({
    updateCells: {
      start: { sheetId, rowIndex: 0, columnIndex: 0 },
      fields:
        'userEnteredValue,userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      rows: [
        {
          values: columns.map((column) => ({
            userEnteredValue: { stringValue: texts.headers[column.key] ?? column.key },
            userEnteredFormat: {
              backgroundColor: column.technical ? TECHNICAL_GREY : rgb(spec.color),
              textFormat: { bold: true, foregroundColor: WHITE },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              wrapStrategy: 'WRAP',
            },
          })),
        },
      ],
    },
  });

  columns.forEach((column, index) => {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: index,
          endColumnIndex: index + 1,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: numberFormat(column.format, options.currency, options.locale),
            horizontalAlignment: ['currency', 'integer', 'decimal', 'percent'].includes(
              column.format,
            )
              ? 'RIGHT'
              : 'LEFT',
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      },
    });
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 },
        properties: { pixelSize: column.width, hiddenByUser: column.technical === true },
        fields: 'pixelSize,hiddenByUser',
      },
    });
    if (column.list) {
      requests.push({
        setDataValidation: {
          range: {
            sheetId,
            startRowIndex: 1,
            startColumnIndex: index,
            endColumnIndex: index + 1,
          },
          rule: {
            condition: {
              type: 'ONE_OF_LIST',
              values: texts.lists[column.list].map((value) => ({
                userEnteredValue: value,
              })),
            },
            strict: true,
            showCustomUi: true,
          },
        },
      });
    } else if (
      (column.format === 'date' || column.format === 'datetime') &&
      spec.kind === 'data'
    ) {
      requests.push({
        setDataValidation: {
          range: {
            sheetId,
            startRowIndex: 1,
            startColumnIndex: index,
            endColumnIndex: index + 1,
          },
          rule: { condition: { type: 'DATE_IS_VALID' }, strict: true },
        },
      });
    }
  });

  if (spec.kind === 'data' || spec.kind === 'planning') {
    requests.push({
      setBasicFilter: {
        filter: {
          range: {
            sheetId,
            startRowIndex: 0,
            startColumnIndex: 0,
            endColumnIndex: columns.length,
          },
        },
      },
    });
  }

  // Warning-only protections (the owner can still override, but gets a warning).
  const protect = (description: string, range: Record<string, number>) => {
    if (!tab.protectedDescriptions.includes(description)) {
      requests.push({
        addProtectedRange: {
          protectedRange: {
            description,
            warningOnly: true,
            range: { sheetId, ...range },
          },
        },
      });
    }
  };
  if (spec.kind === 'data') {
    protect(`lff:header:${spec.key}`, { startRowIndex: 0, endRowIndex: 1 });
    const first = columns.findIndex((column) => column.technical);
    if (first >= 0) {
      protect(`lff:technical:${spec.key}`, {
        startColumnIndex: first,
        endColumnIndex: columns.length,
      });
    }
  } else if (spec.kind === 'planning') {
    protect(`lff:header:${spec.key}`, { startRowIndex: 0, endRowIndex: 1 });
    const firstFormula =
      spec.key === 'budget'
        ? columnIndex('budget', 'spent')
        : columnIndex('goals', 'progress');
    protect(`lff:formulas:${spec.key}`, {
      startColumnIndex: firstFormula,
      endColumnIndex: columns.length,
    });
  } else {
    protect(`lff:generated:${spec.key}`, {});
  }

  return requests;
}

/** References to the transactions tab, by column key. */
function tx(byKey: Record<TabKey, ResolvedTab>) {
  const sheet = quoteSheet(byKey.transactions.title);
  return (key: string) => {
    const letter = columnLetter(columnIndex('transactions', key));
    return `${sheet}!${letter}2:${letter}`;
  };
}

function formulaCell(formula: string) {
  return { userEnteredValue: { formulaValue: formula } };
}

/** Receitas/Despesas: live, sorted views over Movimentações (newest first). */
function viewFormulas(
  byKey: Record<TabKey, ResolvedTab>,
  tab: 'incomes' | 'expenses',
  typeIndex: number,
  texts: LocaleTexts,
): SheetsRequest[] {
  const col = tx(byKey);
  const canceled = texts.lists.transactionStatus[2] as string;
  const type = texts.lists.transactionType[typeIndex] as string;
  const formula =
    `=IFERROR(SORT(FILTER({${['occurred_on', 'description', 'category', 'amount', 'status', 'account'].map(col).join(',')}},` +
    `${col('type')}=${text(type)},${col('status')}<>${text(canceled)}),1,FALSE),"")`;
  return [
    {
      updateCells: {
        start: { sheetId: byKey[tab].sheetId, rowIndex: 1, columnIndex: 0 },
        fields: 'userEnteredValue',
        rows: [{ values: [formulaCell(formula)] }],
      },
    },
  ];
}

function dashboardContent(
  byKey: Record<TabKey, ResolvedTab>,
  texts: LocaleTexts,
  options: SetupOptions,
): SheetsRequest[] {
  const col = tx(byKey);
  const [income, expense] = texts.lists.transactionType;
  const [pending, , canceled] = texts.lists.transactionStatus;
  const thisMonth = `${col('occurred_on')},">="&(EOMONTH(TODAY(),-1)+1),${col('occurred_on')},"<="&EOMONTH(TODAY(),0)`;
  const notCanceled = `${col('status')},"<>"&${text(canceled as string)}`;
  const invested = `${quoteSheet(byKey.investments.title)}!${columnLetter(columnIndex('investments', 'total_cost'))}2:${columnLetter(columnIndex('investments', 'total_cost'))}`;

  const rows: [string, string][] = [
    [
      texts.dashboard.monthIncomes,
      `=SUMIFS(${col('amount')},${col('type')},${text(income as string)},${notCanceled},${thisMonth})`,
    ],
    [
      texts.dashboard.monthExpenses,
      `=SUMIFS(${col('amount')},${col('type')},${text(expense as string)},${notCanceled},${thisMonth})`,
    ],
    [texts.dashboard.monthBalance, '=B2-B3'],
    [texts.dashboard.totalInvested, `=SUM(${invested})`],
    [
      texts.dashboard.pendingBills,
      `=COUNTIFS(${col('status')},${text(pending as string)})`,
    ],
    [
      texts.dashboard.overdueBills,
      `=COUNTIFS(${col('status')},${text(pending as string)},${col('due_on')},"<"&TODAY())`,
    ],
  ];
  const sheetId = byKey.dashboard.sheetId;
  return [
    {
      updateCells: {
        start: { sheetId, rowIndex: 1, columnIndex: 0 },
        fields: 'userEnteredValue,userEnteredFormat.textFormat',
        rows: rows.map(([label, formula]) => ({
          values: [
            {
              userEnteredValue: { stringValue: label },
              userEnteredFormat: { textFormat: { bold: true } },
            },
            {
              ...formulaCell(formula),
              userEnteredFormat: { textFormat: { bold: true } },
            },
          ],
        })),
      },
    },
    // The two counters are integers, not money.
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 5,
          endRowIndex: 7,
          startColumnIndex: 1,
          endColumnIndex: 2,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: numberFormat('integer', options.currency, options.locale),
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
  ];
}

/** Last 12 months, one row each; deterministic columns so the chart is reliable. */
function summaryContent(
  byKey: Record<TabKey, ResolvedTab>,
  texts: LocaleTexts,
): SheetsRequest[] {
  const col = tx(byKey);
  const [income, expense, investment] = texts.lists.transactionType;
  const canceled = texts.lists.transactionStatus[2] as string;
  const rows = Array.from({ length: 12 }, (_, offset) => {
    const row = offset + 2;
    const sum = (type: string) =>
      `=SUMIFS(${col('amount')},${col('type')},${text(type)},${col('status')},"<>"&${text(canceled)},${col('occurred_on')},">="&$A${row},${col('occurred_on')},"<="&EOMONTH($A${row},0))`;
    return {
      values: [
        formulaCell(`=EOMONTH(TODAY(),${row - 14})+1`),
        formulaCell(sum(income as string)),
        formulaCell(sum(expense as string)),
        formulaCell(sum(investment as string)),
        formulaCell(`=B${row}-C${row}-D${row}`),
      ],
    };
  });
  return [
    {
      updateCells: {
        start: { sheetId: byKey.monthly_summary.sheetId, rowIndex: 1, columnIndex: 0 },
        fields: 'userEnteredValue',
        rows,
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: byKey.monthly_summary.sheetId,
          startRowIndex: 1,
          endRowIndex: 13,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        cell: {
          userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'mmm/yyyy' } },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
  ];
}

function planningFormulas(
  byKey: Record<TabKey, ResolvedTab>,
  texts: LocaleTexts,
): SheetsRequest[] {
  const col = tx(byKey);
  const expense = texts.lists.transactionType[1] as string;
  const canceled = texts.lists.transactionStatus[2] as string;
  const monthStart = 'DATEVALUE(A2:A&"-01")';
  const spent =
    `=ARRAYFORMULA(IF(B2:B="","",SUMIFS(${col('amount')},${col('category')},B2:B,${col('type')},${text(expense)},` +
    `${col('status')},"<>"&${text(canceled)},${col('occurred_on')},">="&${monthStart},${col('occurred_on')},"<="&EOMONTH(${monthStart},0))))`;
  return [
    {
      updateCells: {
        start: {
          sheetId: byKey.budget.sheetId,
          rowIndex: 1,
          columnIndex: columnIndex('budget', 'spent'),
        },
        fields: 'userEnteredValue',
        rows: [
          {
            values: [
              formulaCell(spent),
              formulaCell('=ARRAYFORMULA(IF(B2:B="","",C2:C-D2:D))'),
            ],
          },
        ],
      },
    },
    {
      updateCells: {
        start: {
          sheetId: byKey.goals.sheetId,
          rowIndex: 1,
          columnIndex: columnIndex('goals', 'progress'),
        },
        fields: 'userEnteredValue',
        rows: [
          { values: [formulaCell('=ARRAYFORMULA(IF(B2:B="","",IFERROR(C2:C/B2:B,0)))')] },
        ],
      },
    },
  ];
}

function conditionalFormats(
  byKey: Record<TabKey, ResolvedTab>,
  texts: LocaleTexts,
): SheetsRequest[] {
  const requests: SheetsRequest[] = [];
  for (const tab of Object.values(byKey)) {
    for (let index = 0; index < tab.conditionalFormatCount; index += 1) {
      requests.push({ deleteConditionalFormatRule: { sheetId: tab.sheetId, index: 0 } });
    }
  }

  const letter = (key: string) => columnLetter(columnIndex('transactions', key));
  const range = (tab: TabKey, key: string) => {
    const index = columnIndex(tab, key);
    return {
      sheetId: byKey[tab].sheetId,
      startRowIndex: 1,
      startColumnIndex: index,
      endColumnIndex: index + 1,
    };
  };
  const rule = (
    ranges: Record<string, number>[],
    formula: string,
    format: Record<string, unknown>,
  ) => ({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges,
        booleanRule: {
          condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] },
          format,
        },
      },
    },
  });
  const [income, expense, investment] = texts.lists.transactionType;
  const [pending, paid] = texts.lists.transactionStatus;
  const green = { textFormat: { foregroundColor: rgb('#15803D'), bold: true } };
  const red = { textFormat: { foregroundColor: rgb('#B91C1C'), bold: true } };

  requests.push(
    rule(
      [range('transactions', 'amount')],
      `=$${letter('type')}2=${text(income as string)}`,
      green,
    ),
    rule(
      [range('transactions', 'amount')],
      `=$${letter('type')}2=${text(expense as string)}`,
      red,
    ),
    rule(
      [range('transactions', 'amount')],
      `=$${letter('type')}2=${text(investment as string)}`,
      {
        textFormat: { foregroundColor: rgb('#A16207'), bold: true },
      },
    ),
    rule(
      [range('transactions', 'status')],
      `=$${letter('status')}2=${text(paid as string)}`,
      {
        backgroundColor: rgb('#DCFCE7'),
      },
    ),
    rule(
      [range('transactions', 'status'), range('transactions', 'due_on')],
      `=AND($${letter('status')}2=${text(pending as string)},$${letter('due_on')}2<>"",$${letter('due_on')}2<TODAY())`,
      {
        backgroundColor: rgb('#FEE2E2'),
        textFormat: { foregroundColor: rgb('#991B1B'), bold: true },
      },
    ),
    rule(
      [
        {
          sheetId: byKey.dashboard.sheetId,
          startRowIndex: 3,
          endRowIndex: 4,
          startColumnIndex: 1,
          endColumnIndex: 2,
        },
      ],
      '=$B$4<0',
      red,
    ),
    rule([range('monthly_summary', 'balance')], '=E2<0', red),
    rule([range('budget', 'remaining')], '=AND(E2<>"",E2<0)', red),
  );
  return requests;
}

function dashboardChart(
  byKey: Record<TabKey, ResolvedTab>,
  texts: LocaleTexts,
): SheetsRequest {
  const summary = byKey.monthly_summary.sheetId;
  const source = (column: number) => ({
    sourceRange: {
      sources: [
        {
          sheetId: summary,
          startRowIndex: 0,
          endRowIndex: 13,
          startColumnIndex: column,
          endColumnIndex: column + 1,
        },
      ],
    },
  });
  return {
    addChart: {
      chart: {
        chartId: DASHBOARD_CHART_ID,
        spec: {
          title: texts.dashboard.chartTitle,
          basicChart: {
            chartType: 'COLUMN',
            legendPosition: 'BOTTOM_LEGEND',
            headerCount: 1,
            domains: [{ domain: source(0) }],
            series: [
              { series: source(1), targetAxis: 'LEFT_AXIS', color: rgb('#16A34A') },
              { series: source(2), targetAxis: 'LEFT_AXIS', color: rgb('#DC2626') },
            ],
          },
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId: byKey.dashboard.sheetId, rowIndex: 1, columnIndex: 3 },
            widthPixels: 640,
            heightPixels: 320,
          },
        },
      },
    },
  };
}
