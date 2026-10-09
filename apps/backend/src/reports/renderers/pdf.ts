import PDFDocument from 'pdfkit';
import { cellText, formatMoney, pdfSafe } from '../report-format.js';
import type { Cell, Column, ReportDocument, Section } from '../report.types.js';

const PAGE = { width: 595.28, height: 841.89 }; // A4
const MARGIN = 40;
const CONTENT = PAGE.width - MARGIN * 2;
const FOOTER = 34;
const BOTTOM = PAGE.height - MARGIN - FOOTER;

const COLOR = {
  ink: '#16203a',
  soft: '#4b5870',
  muted: '#7a869c',
  line: '#d6deec',
  zebra: '#f5f8fd',
  header: '#e6eefb',
  band: '#0b1530',
  accent: '#00a7c4',
  accent2: '#6a3df0',
  negative: '#c0213f',
  palette: [
    '#00a7c4',
    '#6a3df0',
    '#c21ea6',
    '#0c8a55',
    '#d98a00',
    '#3d6fe0',
    '#8a5cf6',
    '#e0607e',
  ],
};

type Doc = PDFKit.PDFDocument;

/**
 * PDF rendering of a report document with the built-in Helvetica (no font files to ship).
 * Tables break across pages repeating their header; every page has a footer with the
 * page count and the note on where the numbers come from.
 */
export function renderPdf(report: ReportDocument): Promise<Buffer> {
  const doc: Doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: {
      Title: pdfSafe(report.title),
      Author: 'Leccor Finance Flow',
      Creator: 'Leccor Finance Flow',
    },
    lang: report.locale,
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  header(doc, report);
  for (const section of report.sections) renderSection(doc, report, section);
  footers(doc, report);
  doc.end();
  return done;
}

function text(
  doc: Doc,
  value: string,
  x: number,
  y: number,
  options: PDFKit.Mixins.TextOptions = {},
) {
  // One line: with a width, longer text ends in an ellipsis instead of wrapping. The
  // cursor is restored, so layout always uses explicit coordinates.
  const cursor = doc.y;
  doc.text(
    pdfSafe(value),
    x,
    y,
    options.width
      ? { height: doc.currentLineHeight(true), ellipsis: true, ...options }
      : { lineBreak: false, ...options },
  );
  doc.y = cursor;
}

function ensure(doc: Doc, height: number): void {
  if (doc.y + height > BOTTOM) {
    doc.addPage();
    doc.y = MARGIN;
  }
}

function header(doc: Doc, report: ReportDocument): void {
  doc.rect(0, 0, PAGE.width, 118).fill(COLOR.band);
  const gradient = doc.linearGradient(0, 118, PAGE.width, 118);
  gradient.stop(0, COLOR.accent).stop(1, COLOR.accent2);
  doc.rect(0, 116, PAGE.width, 4).fill(gradient);
  doc.fillColor('#7fe9ff').font('Helvetica-Bold').fontSize(8);
  text(doc, 'LECCOR FINANCE FLOW', MARGIN, 30, { characterSpacing: 2 });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(21);
  text(doc, report.title, MARGIN, 46, { width: CONTENT, ellipsis: true });
  doc.fillColor('#c9d6ee').font('Helvetica').fontSize(10);
  text(doc, report.period, MARGIN, 76, { width: CONTENT });
  doc.fillColor('#94a5c4').fontSize(8.5);
  text(doc, `${report.owner} · ${report.generatedAt}`, MARGIN, 93, { width: CONTENT });
  doc.y = 140;
}

function sectionTitle(doc: Doc, title: string): void {
  ensure(doc, 60);
  doc.fillColor(COLOR.ink).font('Helvetica-Bold').fontSize(12.5);
  text(doc, title, MARGIN, doc.y, { width: CONTENT });
  const y = doc.y + 18;
  doc
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + 36, y)
    .lineWidth(2)
    .strokeColor(COLOR.accent)
    .stroke();
  doc.y = y + 10;
}

function renderSection(doc: Doc, report: ReportDocument, section: Section): void {
  sectionTitle(doc, section.title);
  if (section.kind === 'kpis') kpis(doc, report, section);
  else if (section.kind === 'table') table(doc, report, section);
  else bars(doc, report, section);
  doc.y += 18;
}

function kpis(
  doc: Doc,
  report: ReportDocument,
  section: Extract<Section, { kind: 'kpis' }>,
): void {
  const perRow = 3;
  const gap = 10;
  const width = (CONTENT - gap * (perRow - 1)) / perRow;
  const height = 58;
  let y = doc.y;
  section.items.forEach((item, index) => {
    if (index % perRow === 0) {
      if (index > 0) doc.y = y + height + gap;
      ensure(doc, height);
      y = doc.y;
    }
    const x = MARGIN + (index % perRow) * (width + gap);
    doc.roundedRect(x, y, width, height, 8).fillAndStroke(COLOR.zebra, COLOR.line);
    doc.rect(x, y + 8, 3, height - 16).fill(index % 2 ? COLOR.accent2 : COLOR.accent);
    doc.fillColor(COLOR.muted).font('Helvetica-Bold').fontSize(7.5);
    text(doc, item.label.toUpperCase(), x + 12, y + 9, {
      width: width - 20,
      ellipsis: true,
    });
    doc.fillColor(COLOR.ink).font('Helvetica-Bold').fontSize(13);
    text(doc, cellText(item.value, report.locale), x + 12, y + 22, {
      width: width - 20,
      ellipsis: true,
    });
    if (item.hint) {
      doc.fillColor(COLOR.soft).font('Helvetica').fontSize(7.5);
      text(doc, item.hint, x + 12, y + 41, { width: width - 20, ellipsis: true });
    }
  });
  doc.y = y + height;
}

function columnsLayout(columns: Column[]): { x: number; width: number }[] {
  const total = columns.reduce((sum, column) => sum + column.width, 0);
  let x = MARGIN;
  return columns.map((column) => {
    const width = (column.width / total) * CONTENT;
    const box = { x, width };
    x += width;
    return box;
  });
}

function tableRow(
  doc: Doc,
  report: ReportDocument,
  columns: Column[],
  layout: { x: number; width: number }[],
  cells: (Cell | string)[],
  style: 'header' | 'body' | 'zebra' | 'total',
): void {
  const height = style === 'header' ? 20 : 17;
  const y = doc.y;
  if (style === 'header') doc.rect(MARGIN, y, CONTENT, height).fill(COLOR.header);
  if (style === 'zebra') doc.rect(MARGIN, y, CONTENT, height).fill(COLOR.zebra);
  if (style === 'total') {
    doc
      .moveTo(MARGIN, y)
      .lineTo(MARGIN + CONTENT, y)
      .lineWidth(0.8)
      .strokeColor(COLOR.soft)
      .stroke();
  }
  doc.font(style === 'header' || style === 'total' ? 'Helvetica-Bold' : 'Helvetica');
  doc.fontSize(style === 'header' ? 8 : 8.5);
  cells.forEach((cell, index) => {
    const box = layout[index];
    const column = columns[index];
    if (!box || !column) return;
    const value = typeof cell === 'string' ? cell : cellText(cell, report.locale);
    const negative =
      typeof cell === 'object' && 'money' in cell && cell.money.startsWith('-');
    doc.fillColor(
      style === 'header' ? COLOR.soft : negative ? COLOR.negative : COLOR.ink,
    );
    text(doc, value, box.x + 5, y + (style === 'header' ? 6 : 4.5), {
      width: box.width - 10,
      align: column.align,
      ellipsis: true,
    });
  });
  doc.y = y + height;
}

function table(
  doc: Doc,
  report: ReportDocument,
  section: Extract<Section, { kind: 'table' }>,
): void {
  const layout = columnsLayout(section.columns);
  const headers = section.columns.map((column) => column.header);
  if (section.rows.length === 0) {
    doc.fillColor(COLOR.muted).font('Helvetica-Oblique').fontSize(9);
    text(doc, section.empty, MARGIN, doc.y, { width: CONTENT });
    doc.y += 14;
    return;
  }
  ensure(doc, 20 + 17 * 2);
  tableRow(doc, report, section.columns, layout, headers, 'header');
  section.rows.forEach((row, index) => {
    if (doc.y + 17 > BOTTOM) {
      doc.addPage();
      doc.y = MARGIN;
      tableRow(doc, report, section.columns, layout, headers, 'header');
    }
    tableRow(doc, report, section.columns, layout, row, index % 2 ? 'zebra' : 'body');
  });
  if (section.totals) {
    ensure(doc, 17);
    tableRow(doc, report, section.columns, layout, section.totals, 'total');
  }
}

function bars(
  doc: Doc,
  report: ReportDocument,
  section: Extract<Section, { kind: 'bars' }>,
): void {
  if (section.items.length === 0) {
    doc.fillColor(COLOR.muted).font('Helvetica-Oblique').fontSize(9);
    text(doc, section.empty, MARGIN, doc.y, { width: CONTENT });
    doc.y += 14;
    return;
  }
  const labelWidth = 150;
  const valueWidth = 96;
  const barArea = CONTENT - labelWidth - valueWidth - 16;
  const max = Math.max(...section.items.map((item) => Math.abs(Number(item.value))), 1);
  const rowHeight = 16;
  section.items.forEach((item, index) => {
    ensure(doc, rowHeight);
    const y = doc.y;
    const value = Number(item.value);
    const width = Math.max(1.5, (Math.abs(value) / max) * barArea);
    doc.fillColor(COLOR.soft).font('Helvetica').fontSize(8.5);
    text(doc, item.label, MARGIN, y + 3, { width: labelWidth - 6, ellipsis: true });
    doc
      .roundedRect(MARGIN + labelWidth, y + 3, width, rowHeight - 6, 3)
      .fill(
        value < 0
          ? COLOR.negative
          : (COLOR.palette[index % COLOR.palette.length] as string),
      );
    doc
      .fillColor(value < 0 ? COLOR.negative : COLOR.ink)
      .font('Helvetica-Bold')
      .fontSize(8.5);
    text(
      doc,
      formatMoney(item.value, section.currency, report.locale),
      MARGIN + CONTENT - valueWidth,
      y + 3,
      {
        width: valueWidth,
        align: 'right',
      },
    );
    doc.y = y + rowHeight;
  });
}

function footers(doc: Doc, report: ReportDocument): void {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    // The footer sits inside the bottom margin; without this pdfkit would add a page.
    doc.page.margins.bottom = 0;
    const y = PAGE.height - MARGIN - 14;
    doc
      .moveTo(MARGIN, y - 8)
      .lineTo(MARGIN + CONTENT, y - 8)
      .lineWidth(0.5)
      .strokeColor(COLOR.line)
      .stroke();
    doc.fillColor(COLOR.muted).font('Helvetica').fontSize(7);
    text(doc, report.note, MARGIN, y, { width: CONTENT - 80, ellipsis: true });
    const page = report.locale.startsWith('en') ? 'Page' : 'Página';
    const of = report.locale.startsWith('en') ? 'of' : 'de';
    text(doc, `${page} ${index + 1} ${of} ${range.count}`, MARGIN + CONTENT - 80, y, {
      width: 80,
      align: 'right',
    });
  }
}
