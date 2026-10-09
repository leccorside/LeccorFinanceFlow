/**
 * A report as a format-neutral document: the builder decides WHAT goes in (from the same
 * queries as the dashboard), the renderers decide HOW it looks in PDF or XLSX.
 */

/** Values keep their meaning so each format can render them natively. */
export type Cell =
  | string
  | { money: string; currency: string }
  | { date: string }
  | { percent: string }
  | { count: number };

export interface Column {
  header: string;
  align: 'left' | 'right';
  /** Relative width (PDF) / characters (XLSX). */
  width: number;
}

export type Section =
  | {
      kind: 'kpis';
      title: string;
      items: { label: string; value: Cell; hint?: string }[];
    }
  | {
      kind: 'table';
      title: string;
      /** Worksheet name (XLSX); defaults to the title. */
      sheet?: string;
      columns: Column[];
      rows: Cell[][];
      totals?: Cell[];
      /** Shown instead of an empty table. */
      empty: string;
    }
  | {
      kind: 'bars';
      title: string;
      currency: string;
      items: { label: string; value: string }[];
      empty: string;
    };

export interface ReportDocument {
  title: string;
  /** "1 de setembro de 2026 a 30 de setembro de 2026". */
  period: string;
  /** Who it belongs to (name or e-mail). */
  owner: string;
  generatedAt: string;
  locale: string;
  sections: Section[];
  /** Footer: where the numbers come from, no advice. */
  note: string;
}

export const REPORT_TYPES = [
  'MONTHLY',
  'ANNUAL',
  'INCOME',
  'EXPENSES',
  'CATEGORIES',
  'INVESTMENTS',
  'ACCOUNTS',
  'CASH_FLOW',
  'CONSOLIDATED',
] as const;
export type ReportTypeName = (typeof REPORT_TYPES)[number];

export const REPORT_FORMATS = ['PDF', 'XLSX'] as const;
export type ReportFormatName = (typeof REPORT_FORMATS)[number];
