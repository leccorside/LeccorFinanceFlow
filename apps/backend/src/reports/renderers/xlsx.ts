import { currencyDigits } from '../../finance/money.js';
import type { Cell, ReportDocument, Section } from '../report.types.js';
import { createZip } from './zip.js';

/**
 * XLSX (Office Open XML) writer for report documents. Every text is written as a literal
 * inline string — never as a formula — so a description like "=HYPERLINK(...)" stays text
 * (no spreadsheet formula injection). Money and dates are real numbers with formats, so
 * the user can sum and filter them.
 */

// ─────────── Styles (indexes into cellXfs) ───────────
const NUM_FMTS = [
  { id: 164, code: '#,##0' },
  { id: 165, code: '#,##0.00' },
  { id: 166, code: '#,##0.000' },
  { id: 167, code: 'dd/mm/yyyy' },
  { id: 168, code: 'mm/dd/yyyy' },
  { id: 169, code: '0.00%' },
];
/** [numFmtId, fontId, fillId, borderId] per style; index = style id. */
const XFS: [number, number, number, number][] = [
  [0, 0, 0, 0], // 0 default
  [0, 1, 2, 1], // 1 header
  [0, 2, 0, 0], // 2 title
  [0, 3, 0, 0], // 3 subtitle (muted)
  [164, 0, 0, 0], // 4 money 0
  [165, 0, 0, 0], // 5 money 2
  [166, 0, 0, 0], // 6 money 3
  [167, 0, 0, 0], // 7 date d/m/y
  [168, 0, 0, 0], // 8 date m/d/y
  [169, 0, 0, 0], // 9 percent
  [0, 1, 0, 2], // 10 bold text (totals)
  [164, 1, 0, 2], // 11 bold money 0
  [165, 1, 0, 2], // 12 bold money 2
  [166, 1, 0, 2], // 13 bold money 3
  [3, 0, 0, 0], // 14 integer
  [0, 1, 0, 0], // 15 bold label
];

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="${NUM_FMTS.length}">${NUM_FMTS.map((f) => `<numFmt numFmtId="${f.id}" formatCode="${f.code}"/>`).join('')}</numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><color rgb="FF1F2A44"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF5F6B7A"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE3ECFA"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FF8EA3C2"/></bottom><diagonal/></border>
<border><left/><right/><top style="thin"><color rgb="FF8EA3C2"/></top><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${XFS.length}">${XFS.map(
  ([numFmt, font, fill, border]) =>
    `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${numFmt ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}/>`,
).join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ─────────── Helpers ───────────

/** XML text: escaped, without the control characters XML 1.0 forbids. */
function xml(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  );
}

function column(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/** Excel serial date (days since 1899-12-30) of a calendar date "YYYY-MM-DD". */
export function excelDate(date: string): number {
  return (
    Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000 +
    25_569
  );
}

type XCell =
  | { kind: 's'; value: string; style: number }
  | { kind: 'n'; value: number; style: number };

function moneyStyle(currency: string, bold: boolean): number {
  const digits = currencyDigits(currency);
  const base = digits === 0 ? 4 : digits === 3 ? 6 : 5;
  return bold ? base + 7 : base;
}

function toXCell(cell: Cell, locale: string, bold = false): XCell {
  if (typeof cell === 'string') return { kind: 's', value: cell, style: bold ? 10 : 0 };
  if ('money' in cell) {
    return {
      kind: 'n',
      value: Number(cell.money),
      style: moneyStyle(cell.currency, bold),
    };
  }
  if ('date' in cell) {
    return { kind: 'n', value: excelDate(cell.date), style: locale === 'en-US' ? 8 : 7 };
  }
  if ('percent' in cell)
    return { kind: 'n', value: Number(cell.percent) / 100, style: 9 };
  return { kind: 'n', value: cell.count, style: 14 };
}

interface Sheet {
  name: string;
  widths: number[];
  rows: XCell[][];
  /** Row index (0-based) of the table header, for freeze panes and filters. */
  headerRow: number | null;
  columns: number;
  /** Data rows exist (an empty table gets no filter). */
  hasData: boolean;
}

function sheetXml(sheet: Sheet): string {
  const rows = sheet.rows
    .map((cells, r) => {
      const content = cells
        .map((cell, c) => {
          const ref = `${column(c)}${r + 1}`;
          if (cell.kind === 'n') {
            return Number.isFinite(cell.value)
              ? `<c r="${ref}" s="${cell.style}"><v>${cell.value}</v></c>`
              : `<c r="${ref}" s="${cell.style}"/>`;
          }
          return `<c r="${ref}" s="${cell.style}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${content}</row>`;
    })
    .join('');
  const header = sheet.headerRow;
  const freeze =
    header !== null
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${header + 1}" topLeftCell="A${header + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const cols = `<cols>${sheet.widths
    .map(
      (width, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`,
    )
    .join('')}</cols>`;
  const lastDataRow = sheet.rows.length;
  const filter =
    header !== null && sheet.hasData && lastDataRow > header + 1
      ? `<autoFilter ref="A${header + 1}:${column(sheet.columns - 1)}${lastDataRow}"/>`
      : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${freeze}${cols}<sheetData>${rows}</sheetData>${filter}</worksheet>`;
}

/** Worksheet names: ≤ 31 chars, none of []:*?/\, unique (case-insensitive). */
function sheetName(wanted: string, used: Set<string>): string {
  const base =
    wanted
      .replace(/[[\]:*?/\\]/g, ' ')
      .trim()
      .slice(0, 31) || 'Planilha';
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n += 1) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

function sectionSheet(
  doc: ReportDocument,
  section: Exclude<Section, { kind: 'kpis' }>,
): Omit<Sheet, 'name'> {
  const title: XCell[] = [{ kind: 's', value: section.title, style: 2 }];
  const subtitle: XCell[] = [
    { kind: 's', value: `${doc.title} · ${doc.period}`, style: 3 },
  ];
  if (section.kind === 'bars') {
    const rows: XCell[][] = [title, subtitle, []];
    rows.push([
      { kind: 's', value: section.title.split(' (')[0] ?? section.title, style: 1 },
      { kind: 's', value: section.currency, style: 1 },
    ]);
    for (const item of section.items) {
      rows.push([
        { kind: 's', value: item.label, style: 0 },
        toXCell({ money: item.value, currency: section.currency }, doc.locale),
      ]);
    }
    return {
      widths: [40, 18],
      rows,
      headerRow: 3,
      columns: 2,
      hasData: section.items.length > 0,
    };
  }
  const rows: XCell[][] = [title, subtitle, []];
  rows.push(section.columns.map((col) => ({ kind: 's', value: col.header, style: 1 })));
  for (const row of section.rows) rows.push(row.map((cell) => toXCell(cell, doc.locale)));
  if (section.totals)
    rows.push(section.totals.map((cell) => toXCell(cell, doc.locale, true)));
  if (section.rows.length === 0)
    rows.push([{ kind: 's', value: section.empty, style: 3 }]);
  return {
    widths: section.columns.map((col) => Math.max(10, Math.min(60, col.width))),
    rows,
    headerRow: 3,
    columns: section.columns.length,
    hasData: section.rows.length > 0,
  };
}

export function renderXlsx(doc: ReportDocument): Buffer {
  const used = new Set<string>();
  const sheets: Sheet[] = [];

  // First sheet: cover + every KPI block.
  const summary: XCell[][] = [
    [{ kind: 's', value: doc.title, style: 2 }],
    [{ kind: 's', value: doc.period, style: 3 }],
    [{ kind: 's', value: `${doc.owner} · ${doc.generatedAt}`, style: 3 }],
    [],
  ];
  for (const section of doc.sections) {
    if (section.kind !== 'kpis') continue;
    summary.push([{ kind: 's', value: section.title, style: 15 }]);
    for (const item of section.items) {
      summary.push([
        { kind: 's', value: item.label, style: 0 },
        toXCell(item.value, doc.locale),
        { kind: 's', value: item.hint ?? '', style: 3 },
      ]);
    }
    summary.push([]);
  }
  summary.push([{ kind: 's', value: doc.note, style: 3 }]);
  const kpiTitle = doc.sections.find((section) => section.kind === 'kpis')?.title;
  sheets.push({
    name: sheetName(kpiTitle?.split(' (')[0] ?? doc.title, used),
    widths: [34, 20, 34],
    rows: summary,
    headerRow: null,
    columns: 3,
    hasData: false,
  });

  // Bars are a picture of a table; in a spreadsheet they only repeat it.
  const tableTitles = new Set(
    doc.sections
      .filter((section) => section.kind === 'table')
      .map((section) => section.title),
  );
  for (const section of doc.sections) {
    if (section.kind === 'kpis') continue;
    if (section.kind === 'bars' && tableTitles.has(section.title)) continue;
    const wanted =
      section.kind === 'table' ? (section.sheet ?? section.title) : section.title;
    sheets.push({ name: sheetName(wanted, used), ...sectionSheet(doc, section) });
  }

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map(
      (sheet, i) =>
        `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join('')}</sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_sheet, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join(
      '',
    )}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
    .map(
      (_sheet, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join(
      '',
    )}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(doc.title)}</dc:title><dc:creator>Leccor Finance Flow</dc:creator></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Leccor Finance Flow</Application></Properties>`;

  return createZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { name: '_rels/.rels', data: Buffer.from(rootRels) },
    { name: 'docProps/core.xml', data: Buffer.from(core) },
    { name: 'docProps/app.xml', data: Buffer.from(app) },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels) },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES_XML) },
    ...sheets.map((sheet, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(sheetXml(sheet)),
    })),
  ]);
}
