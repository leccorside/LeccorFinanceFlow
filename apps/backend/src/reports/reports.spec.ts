import { pdfText, readXlsx, unzip } from '../../test/office-readers.js';
import { renderPdf } from './renderers/pdf.js';
import { excelDate, renderXlsx } from './renderers/xlsx.js';
import { createZip, crc32 } from './renderers/zip.js';
import { cellText, pdfSafe } from './report-format.js';
import { reportText } from './report-i18n.js';
import type { ReportDocument } from './report.types.js';
import { resolveReportPeriod } from './reports.service.js';

const doc = (overrides: Partial<ReportDocument> = {}): ReportDocument => ({
  title: 'Relatório mensal',
  period: '1 de setembro de 2026 a 30 de setembro de 2026',
  owner: 'Ana Souza',
  generatedAt: 'Gerado em 9 de outubro de 2026',
  locale: 'pt-BR',
  note: 'Gerado a partir dos seus registros.',
  sections: [
    {
      kind: 'kpis',
      title: 'Resumo',
      items: [
        {
          label: 'Receitas',
          value: { money: '7700.00', currency: 'BRL' },
          hint: 'pendente',
        },
        { label: 'Movimentações', value: { count: 3 } },
      ],
    },
    {
      kind: 'bars',
      title: 'Despesas por categoria',
      currency: 'BRL',
      items: [{ label: 'Alimentação', value: '976.42' }],
      empty: 'Sem dados.',
    },
    {
      kind: 'table',
      title: 'Despesas por categoria',
      columns: [
        { header: 'Categoria', align: 'left', width: 30 },
        { header: 'Valor', align: 'right', width: 15 },
        { header: 'Participação', align: 'right', width: 12 },
      ],
      rows: [['Alimentação', { money: '976.42', currency: 'BRL' }, { percent: '100' }]],
      totals: ['Total', { money: '976.42', currency: 'BRL' }, { percent: '100' }],
      empty: 'Sem dados.',
    },
    {
      kind: 'table',
      title: 'Lançamentos',
      columns: [
        { header: 'Data', align: 'left', width: 12 },
        { header: 'Descrição', align: 'left', width: 30 },
        { header: 'Valor', align: 'right', width: 15 },
      ],
      rows: [
        [
          { date: '2026-09-01' },
          '=HYPERLINK("http://x","y") <b> & "a"',
          { money: '-10.50', currency: 'BRL' },
        ],
        [{ date: '2026-09-02' }, 'café 🍕\u0007', { money: '5', currency: 'JPY' }],
      ],
      empty: 'Sem dados.',
    },
  ],
  ...overrides,
});

describe('report periods', () => {
  const max = 120;
  const iso = (value: Date) => value.toISOString().slice(0, 10);

  it('accepts a month, a year or from/to', () => {
    const month = resolveReportPeriod(
      { type: 'MONTHLY', format: 'PDF', month: '2024-02' },
      max,
    );
    expect([iso(month.from), iso(month.to)]).toEqual(['2024-02-01', '2024-02-29']);
    const year = resolveReportPeriod({ type: 'ANNUAL', format: 'XLSX', year: 2026 }, max);
    expect([iso(year.from), iso(year.to)]).toEqual(['2026-01-01', '2026-12-31']);
    const range = resolveReportPeriod(
      { type: 'EXPENSES', format: 'PDF', from: '2026-03-10', to: '2026-04-05' },
      max,
    );
    expect([iso(range.from), iso(range.to)]).toEqual(['2026-03-10', '2026-04-05']);
  });

  it('keeps monthly and annual reports on whole calendar units', () => {
    expect(() =>
      resolveReportPeriod(
        { type: 'MONTHLY', format: 'PDF', from: '2026-09-02', to: '2026-09-30' },
        max,
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'report_period_invalid' }),
      }),
    );
    expect(() =>
      resolveReportPeriod({ type: 'ANNUAL', format: 'PDF', month: '2026-09' }, max),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'report_period_invalid' }),
      }),
    );
  });

  it('refuses inverted, impossible and too long periods', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as { response: { code: string } }).response.code;
      }
      return null;
    };
    expect(
      code(() =>
        resolveReportPeriod(
          { type: 'INCOME', format: 'PDF', from: '2026-05-01', to: '2026-04-01' },
          max,
        ),
      ),
    ).toBe('report_period_invalid');
    expect(
      code(() =>
        resolveReportPeriod({ type: 'INCOME', format: 'PDF', month: '2026-13' }, max),
      ),
    ).toBe('report_period_invalid');
    expect(
      code(() =>
        resolveReportPeriod(
          { type: 'INCOME', format: 'PDF', from: '2016-01-01', to: '2026-01-31' },
          max,
        ),
      ),
    ).toBe('report_period_too_long');
    expect(
      code(() =>
        resolveReportPeriod(
          { type: 'INCOME', format: 'PDF', from: '2017-01-01', to: '2026-12-31' },
          max,
        ),
      ),
    ).toBeNull();
  });
});

describe('zip', () => {
  it('computes the standard CRC-32 and writes an archive any reader can open', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    const files = unzip(
      createZip([
        { name: 'a.txt', data: Buffer.from('olá') },
        { name: 'dir/b.xml', data: Buffer.from('<x/>'.repeat(100)) },
      ]),
    );
    expect(files.get('a.txt')?.toString()).toBe('olá');
    expect(files.get('dir/b.xml')?.toString()).toBe('<x/>'.repeat(100));
  });
});

describe('xlsx', () => {
  it('writes a valid package with typed cells, one sheet per table', () => {
    const file = renderXlsx(doc());
    const parts = unzip(file);
    expect([...parts.keys()]).toEqual(
      expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml']),
    );
    const sheets = readXlsx(file);
    // The bars repeat the category table, so they get no sheet of their own.
    expect([...sheets.keys()]).toEqual([
      'Resumo',
      'Despesas por categoria',
      'Lançamentos',
    ]);
    const summary = sheets.get('Resumo') ?? [];
    expect(summary.find((cell) => cell.ref === 'B6')).toMatchObject({
      type: 'number',
      value: 7700,
    });
    const rows = sheets.get('Lançamentos') ?? [];
    expect(rows.find((cell) => cell.ref === 'A5')).toMatchObject({
      type: 'number',
      value: excelDate('2026-09-01'),
    });
    expect(rows.find((cell) => cell.ref === 'C5')).toMatchObject({
      type: 'number',
      value: -10.5,
    });
  });

  it('keeps user text as text: no formula, escaped XML, no control characters', () => {
    const rows = readXlsx(renderXlsx(doc())).get('Lançamentos') ?? [];
    const injected = rows.find((cell) => cell.ref === 'B5');
    expect(injected).toMatchObject({
      type: 'string',
      value: '=HYPERLINK("http://x","y") <b> & "a"',
      formula: false,
    });
    expect(rows.find((cell) => cell.ref === 'B6')?.value).toBe('café 🍕');
  });

  it('uses Excel serial dates and the currency decimals', () => {
    expect(excelDate('1900-03-01')).toBe(61);
    expect(excelDate('2026-09-01')).toBe(46266);
    const xml = unzip(renderXlsx(doc())).get('xl/styles.xml')?.toString() ?? '';
    expect(xml).toContain('formatCode="#,##0.00"');
    expect(xml).toContain('formatCode="#,##0"');
  });
});

describe('pdf', () => {
  it('produces a paginated PDF whose text carries the formatted values', async () => {
    const file = await renderPdf(doc());
    expect(file.subarray(0, 5).toString()).toBe('%PDF-');
    expect(file.toString('latin1')).toContain('/Title');
    const text = pdfText(file);
    expect(text).toContain('Relatório mensal');
    expect(text).toContain('R$ 7.700,00');
    expect(text).toContain('-R$ 10,50');
    expect(text).toContain('Página 1 de 1');
    // Characters the built-in fonts cannot draw become "?" instead of breaking the file.
    expect(text).toContain('café ?');
  });

  it('breaks long tables across pages, repeating the header', async () => {
    const many = doc({
      sections: [
        {
          kind: 'table',
          title: 'Lançamentos',
          columns: [
            { header: 'Descrição', align: 'left', width: 30 },
            { header: 'Valor', align: 'right', width: 15 },
          ],
          rows: Array.from({ length: 120 }, (_, i) => [
            `Linha ${i + 1}`,
            { money: '1', currency: 'BRL' },
          ]),
          empty: 'Sem dados.',
        },
      ],
    });
    const text = pdfText(await renderPdf(many));
    expect(text).toContain('Linha 120');
    const pages = Number(text.match(/Página \d de (\d)/)?.[1]);
    expect(pages).toBeGreaterThan(2);
    // One header per page the table spans.
    expect(text.split('\n').filter((line) => line === 'Descrição').length).toBe(pages);
  });
});

describe('report text helpers', () => {
  it('formats cells and texts per locale', () => {
    expect(
      cellText({ money: '1234.5', currency: 'BRL' }, 'pt-BR').replace(/\s/g, ' '),
    ).toBe('R$ 1.234,50');
    expect(cellText({ date: '2026-09-01' }, 'en-US')).toBe('9/1/26');
    expect(cellText({ percent: '28.17' }, 'pt-BR')).toBe('28,17%');
    expect(reportText('es_ES')('type.MONTHLY')).toBe('Informe mensual');
    expect(reportText('en_US')('unknown.key')).toBe('key');
    expect(pdfSafe('a b 🍕 ŒŸ')).toBe('a b ? ŒŸ');
  });
});
