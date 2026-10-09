import type { SheetsRequest, SpreadsheetSnapshot } from './google-workspace.client.js';
import {
  buildSetupPlan,
  columnLetter,
  currencyPattern,
  DASHBOARD_CHART_ID,
  METADATA,
  quoteSheet,
  type SetupOptions,
} from './spreadsheet-setup.js';
import { TABS, TEXTS } from './spreadsheet-template.js';

const options: SetupOptions = {
  spreadsheetRowId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  locale: 'pt-BR',
  timeZone: 'America/Sao_Paulo',
  currency: 'BRL',
};

const fresh: SpreadsheetSnapshot = {
  spreadsheetId: 'file-1',
  title: 'Controle Financeiro — Ana',
  locale: 'en_US',
  timeZone: 'Etc/GMT',
  metadataKeys: [],
  sheets: [
    {
      sheetId: 0,
      title: 'Página1',
      index: 0,
      tabKey: null,
      rowCount: 1000,
      columns: [],
      protectedRangeDescriptions: [],
      conditionalFormatCount: 0,
      chartIds: [],
    },
  ],
};

const ofType = (requests: SheetsRequest[], type: string) =>
  requests
    .filter((request) => type in request)
    .map((request) => request[type] as Record<string, unknown>);

const json = (value: unknown) => JSON.stringify(value);

/** Snapshot as Google would return it after applying `first` (what a re-run sees). */
function afterFirstRun(locale: SetupOptions['locale'] = 'pt-BR'): SpreadsheetSnapshot {
  const first = buildSetupPlan(fresh, { ...options, locale });
  const protections = ofType(first.requests, 'addProtectedRange').map(
    (request) =>
      request.protectedRange as { description: string; range: { sheetId: number } },
  );
  const conditional = ofType(first.requests, 'addConditionalFormatRule').map(
    (request) => (request.rule as { ranges: { sheetId: number }[] }).ranges[0]?.sheetId,
  );
  return {
    ...fresh,
    metadataKeys: [METADATA.spreadsheetId, METADATA.templateVersion],
    sheets: TABS.map((tab, index) => {
      const sheetId = first.sheetIds[tab.key];
      return {
        sheetId,
        title: first.tabTitles[tab.key],
        index,
        tabKey: tab.key,
        rowCount: 1000,
        columns: tab.columns.map((column, position) => ({
          key: column.key,
          index: position,
        })),
        protectedRangeDescriptions: protections
          .filter((p) => p.range.sheetId === sheetId)
          .map((p) => p.description),
        conditionalFormatCount: conditional.filter((id) => id === sheetId).length,
        chartIds: tab.key === 'dashboard' ? [DASHBOARD_CHART_ID] : [],
      };
    }),
  };
}

describe('buildSetupPlan — first setup', () => {
  const plan = buildSetupPlan(fresh, options);

  it('sets locale and time zone and tags the spreadsheet with our id', () => {
    expect(ofType(plan.requests, 'updateSpreadsheetProperties')[0]).toMatchObject({
      properties: { locale: 'pt_BR', timeZone: 'America/Sao_Paulo' },
    });
    const metadata = ofType(plan.requests, 'createDeveloperMetadata').map(
      (request) =>
        request.developerMetadata as { metadataKey: string; metadataValue: string },
    );
    expect(metadata).toContainEqual(
      expect.objectContaining({
        metadataKey: METADATA.spreadsheetId,
        metadataValue: options.spreadsheetRowId,
      }),
    );
  });

  it('adds the ten tabs in order with localized titles and frozen headers, then drops the blank default sheet', () => {
    const added = ofType(plan.requests, 'addSheet').map(
      (request) => request.properties as Record<string, unknown>,
    );
    expect(added.map((sheet) => sheet.title)).toEqual([
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
    expect(
      added.every(
        (sheet) =>
          (sheet.gridProperties as { frozenRowCount: number }).frozenRowCount === 1,
      ),
    ).toBe(true);
    expect(ofType(plan.requests, 'deleteSheet')).toEqual([{ sheetId: 0 }]);

    // Sheets referenced later in the batch exist by then (adds come first).
    const firstOther = plan.requests.findIndex(
      (request) =>
        !('addSheet' in request) &&
        !('updateSpreadsheetProperties' in request) &&
        !('createDeveloperMetadata' in request),
    );
    const lastAdd = plan.requests
      .map((request) => 'addSheet' in request)
      .lastIndexOf(true);
    expect(lastAdd).toBeLessThan(firstOther);
  });

  it('identifies tabs and columns with developer metadata', () => {
    const metadata = ofType(plan.requests, 'createDeveloperMetadata').map(
      (request) =>
        request.developerMetadata as { metadataKey: string; metadataValue: string },
    );
    expect(
      metadata
        .filter((item) => item.metadataKey === METADATA.tab)
        .map((item) => item.metadataValue),
    ).toEqual(TABS.map((tab) => tab.key));
    const columns = metadata.filter((item) => item.metadataKey === METADATA.column);
    expect(columns).toHaveLength(
      TABS.reduce((total, tab) => total + tab.columns.length, 0),
    );
    expect(columns.map((item) => item.metadataValue)).toContain('record_id');
  });

  it('writes localized headers and hides + protects the technical columns', () => {
    const transactionsId = plan.sheetIds.transactions;
    const header = ofType(plan.requests, 'updateCells').find(
      (request) =>
        json(request.start) ===
        json({ sheetId: transactionsId, rowIndex: 0, columnIndex: 0 }),
    );
    const labels = (
      header?.rows as { values: { userEnteredValue: { stringValue: string } }[] }[]
    )[0]?.values.map((cell) => cell.userEnteredValue.stringValue);
    expect(labels?.slice(0, 6)).toEqual([
      'Tipo',
      'Descrição',
      'Categoria',
      'Subcategoria',
      'Valor',
      'Data',
    ]);
    expect(labels?.slice(-3)).toEqual([
      'ID (não editar)',
      'Versão (não editar)',
      'Sincronizado em (não editar)',
    ]);

    const hidden = ofType(plan.requests, 'updateDimensionProperties').filter(
      (request) =>
        (request.range as { sheetId: number }).sheetId === transactionsId &&
        (request.properties as { hiddenByUser: boolean }).hiddenByUser,
    );
    expect(hidden).toHaveLength(3);

    const descriptions = ofType(plan.requests, 'addProtectedRange').map(
      (request) =>
        request.protectedRange as { description: string; warningOnly: boolean },
    );
    expect(descriptions).toContainEqual(
      expect.objectContaining({
        description: 'lff:technical:transactions',
        warningOnly: true,
      }),
    );
    expect(descriptions.every((item) => item.warningOnly)).toBe(true);
  });

  it('formats money with the profile currency, dates and integers', () => {
    const formats = ofType(plan.requests, 'repeatCell').map((request) =>
      json(request.cell),
    );
    expect(
      formats.some(
        (format) => format.includes('"CURRENCY"') && format.includes('\\"R$\\" #,##0.00'),
      ),
    ).toBe(true);
    expect(formats.some((format) => format.includes('"DATE"'))).toBe(true);
    expect(formats.some((format) => format.includes('"DATE_TIME"'))).toBe(true);
  });

  it('adds dropdowns with localized values, filters and conditional colors', () => {
    const lists = ofType(plan.requests, 'setDataValidation')
      .map(
        (request) =>
          (
            request.rule as {
              condition: { type: string; values?: { userEnteredValue: string }[] };
            }
          ).condition,
      )
      .filter((condition) => condition.type === 'ONE_OF_LIST')
      .map((condition) => condition.values?.map((value) => value.userEnteredValue));
    expect(lists).toContainEqual(['Receita', 'Despesa', 'Investimento', 'Transferência']);
    expect(lists).toContainEqual(['Pendente', 'Pago', 'Cancelado']);

    const filtered = ofType(plan.requests, 'setBasicFilter').map(
      (request) => (request.filter as { range: { sheetId: number } }).range.sheetId,
    );
    for (const key of [
      'transactions',
      'accounts',
      'investments',
      'categories',
      'budget',
      'goals',
    ] as const) {
      expect(filtered).toContain(plan.sheetIds[key]);
    }
    expect(
      ofType(plan.requests, 'addConditionalFormatRule').length,
    ).toBeGreaterThanOrEqual(5);
  });

  it('writes formulas for views, dashboard, summary, budget and goals', () => {
    const formulas = ofType(plan.requests, 'updateCells')
      .flatMap(
        (request) =>
          request.rows as {
            values: { userEnteredValue?: { formulaValue?: string } }[];
          }[],
      )
      .flatMap((row) => row.values)
      .map((cell) => cell.userEnteredValue?.formulaValue)
      .filter((formula): formula is string => typeof formula === 'string');

    expect(formulas).toContainEqual(
      expect.stringMatching(
        /^=IFERROR\(SORT\(FILTER\(\{'Movimentações'!F2:F,.*'Movimentações'!A2:A="Receita"/,
      ),
    );
    expect(formulas).toContainEqual(
      expect.stringMatching(/'Movimentações'!A2:A="Despesa"/),
    );
    expect(formulas).toContainEqual(
      expect.stringMatching(
        /^=SUMIFS\('Movimentações'!E2:E,'Movimentações'!A2:A,"Receita"/,
      ),
    );
    expect(formulas).toContain('=B2-B3');
    expect(formulas).toContainEqual(
      expect.stringMatching(/^=SUM\('Investimentos'!E2:E\)$/),
    );
    expect(formulas).toContain('=EOMONTH(TODAY(),-12)+1');
    expect(formulas).toContain('=EOMONTH(TODAY(),-1)+1');
    expect(formulas).toContainEqual(
      expect.stringMatching(/^=ARRAYFORMULA\(IF\(B2:B="","",SUMIFS\(/),
    );
    expect(formulas).toContain('=ARRAYFORMULA(IF(B2:B="","",IFERROR(C2:C/B2:B,0)))');
  });

  it('adds one chart on the dashboard fed by the monthly summary', () => {
    const charts = ofType(plan.requests, 'addChart');
    expect(charts).toHaveLength(1);
    expect(json(charts[0])).toContain(`"chartId":${DASHBOARD_CHART_ID}`);
    expect(json(charts[0])).toContain(`"sheetId":${plan.sheetIds.monthly_summary}`);
  });
});

describe('buildSetupPlan — re-run (idempotency)', () => {
  const rerun = buildSetupPlan(afterFirstRun(), options);

  it('never adds, deletes or duplicates sheets, metadata, protections or charts', () => {
    for (const type of [
      'addSheet',
      'deleteSheet',
      'createDeveloperMetadata',
      'addProtectedRange',
      'addChart',
    ]) {
      expect(ofType(rerun.requests, type)).toEqual([]);
    }
  });

  it('replaces conditional formats instead of piling them up', () => {
    const first = buildSetupPlan(fresh, options);
    const added = ofType(first.requests, 'addConditionalFormatRule').length;
    expect(ofType(rerun.requests, 'deleteConditionalFormatRule')).toHaveLength(added);
    expect(ofType(rerun.requests, 'addConditionalFormatRule')).toHaveLength(added);
  });

  it('keeps tabs renamed by the user and points formulas at the new name', () => {
    const snapshot = afterFirstRun();
    const renamed: SpreadsheetSnapshot = {
      ...snapshot,
      sheets: snapshot.sheets.map((sheet) =>
        sheet.tabKey === 'transactions'
          ? { ...sheet, title: "Lançamentos d'Ana" }
          : sheet,
      ),
    };
    const plan = buildSetupPlan(renamed, options);
    expect(json(plan.requests)).toContain("'Lançamentos d''Ana'!A2:A");
    expect(
      ofType(plan.requests, 'updateSheetProperties').every(
        (request) => !json(request).includes('"title"'),
      ),
    ).toBe(true);
  });

  it('never deletes sheets the user added later', () => {
    const snapshot = afterFirstRun();
    snapshot.sheets.push({
      sheetId: 77,
      title: 'Minhas anotações',
      index: 10,
      tabKey: null,
      rowCount: 1000,
      columns: [],
      protectedRangeDescriptions: [],
      conditionalFormatCount: 0,
      chartIds: [],
    });
    expect(ofType(buildSetupPlan(snapshot, options).requests, 'deleteSheet')).toEqual([]);
  });
});

describe('localization', () => {
  it.each([
    ['en-US', 'Transactions', 'Income', 'Type'],
    ['es-ES', 'Movimientos', 'Ingreso', 'Tipo'],
  ] as const)('builds the %s template', (locale, tab, income, header) => {
    const plan = buildSetupPlan(fresh, { ...options, locale, currency: 'EUR' });
    expect(plan.tabTitles.transactions).toBe(tab);
    expect(ofType(plan.requests, 'updateSpreadsheetProperties')[0]).toMatchObject({
      properties: { locale: locale.replace('-', '_') },
    });
    expect(json(plan.requests)).toContain(`="${income}"`.replace(/"/g, '\\"'));
    expect(json(plan.requests)).toContain(`"stringValue":"${header}"`);
  });

  it('keeps every list the same length in all locales (position = domain value)', () => {
    for (const key of Object.keys(
      TEXTS['pt-BR'].lists,
    ) as (keyof (typeof TEXTS)['pt-BR']['lists'])[]) {
      expect(TEXTS['en-US'].lists[key]).toHaveLength(TEXTS['pt-BR'].lists[key].length);
      expect(TEXTS['es-ES'].lists[key]).toHaveLength(TEXTS['pt-BR'].lists[key].length);
    }
  });

  it('has a header label for every column in every locale', () => {
    for (const locale of ['pt-BR', 'en-US', 'es-ES'] as const) {
      for (const tab of TABS) {
        for (const column of tab.columns) {
          expect(
            TEXTS[locale].headers[column.key],
            `${locale} ${column.key}`,
          ).toBeTruthy();
        }
      }
    }
  });
});

describe('helpers', () => {
  it('converts column indexes to letters and quotes sheet names', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetter)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ]);
    expect(quoteSheet("Ana's")).toBe("'Ana''s'");
  });

  it.each([
    ['BRL', 'pt-BR', '"R$" #,##0.00;-"R$" #,##0.00'],
    ['USD', 'en-US', '"$" #,##0.00;-"$" #,##0.00'],
    ['EUR', 'es-ES', '#,##0.00 "€";-#,##0.00 "€"'],
    ['JPY', 'en-US', '"¥" #,##0;-"¥" #,##0'],
  ] as const)('builds the %s pattern for %s', (currency, locale, pattern) => {
    expect(currencyPattern(currency, locale)).toBe(pattern);
  });
});
