import { createHash } from 'node:crypto';
import { formatCalendarDate, parseCalendarDate } from '../../finance/dates.js';
import type { CellValue } from '../google-workspace.client.js';

/**
 * Conversions between domain values and raw Sheets cells. Everything read from a sheet is
 * untrusted user content: it is only ever parsed into plain values and validated by the
 * domain DTOs/services, never interpreted. Everything written is a literal value
 * (`stringValue`/`numberValue`), so text coming from the app can never become a formula.
 */

/** A cell as the sync sees it: a raw value, or null when empty. */
export type Cell = CellValue | null;
export type RowCells = Record<string, Cell>;

/** Sheets date serial: days since 1899-12-30 (fraction = time of day). */
const EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

export function dateToSerial(date: Date): number {
  return Math.round((date.getTime() - EPOCH) / DAY_MS);
}

/** Wall-clock date-time of `instant` in `timeZone`, as a serial with whole seconds. */
export function dateTimeToSerial(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round(((wall - EPOCH) / DAY_MS) * 86_400) / 86_400;
}

/** True for "no value" cells (missing, empty or blank text). */
export function isEmpty(cell: Cell | undefined): boolean {
  return (
    cell === null ||
    cell === undefined ||
    (typeof cell === 'string' && cell.trim() === '')
  );
}

/** Canonical text of a cell for comparisons and hashes. */
export function normalized(cell: Cell | undefined): string {
  if (isEmpty(cell)) return '';
  if (typeof cell === 'number') return String(cell);
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
  return (cell as string).trim().normalize('NFC');
}

/** SHA-256 of the given columns' canonical values (order matters). */
export function rowHash(cells: RowCells, keys: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify(keys.map((key) => normalized(cells[key]))))
    .digest('hex');
}

/** Same canonical values for every key: the row already shows what we would write. */
export function sameCells(a: RowCells, b: RowCells, keys: readonly string[]): boolean {
  return keys.every((key) => normalized(a[key]) === normalized(b[key]));
}

/** Why a row cannot be imported: a stable code plus the column that caused it. */
export class RowError extends Error {
  constructor(
    readonly code: string,
    readonly column?: string,
  ) {
    super(code);
    this.name = 'RowError';
  }
}

/** Plain text cell (numbers typed in a text column become their text). */
export function textOf(cell: Cell | undefined): string | null {
  if (isEmpty(cell)) return null;
  return typeof cell === 'string' ? cell.trim() : normalized(cell);
}

/** Calendar date from a serial number or a "YYYY-MM-DD" text; null when empty. */
export function calendarDateOf(cell: Cell | undefined, column: string): string | null {
  if (isEmpty(cell)) return null;
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    const text = formatCalendarDate(new Date(EPOCH + Math.floor(cell) * DAY_MS));
    if (parseCalendarDate(text)) return text;
  } else if (typeof cell === 'string' && parseCalendarDate(cell.trim())) {
    return cell.trim();
  }
  throw new RowError('invalid_date', column);
}

/**
 * Money as exact decimal text. A number cell uses its shortest round-trip text (87.45 →
 * "87.45"), so no binary rounding is introduced; the domain then checks the currency's
 * decimals. Text cells accept "87.45" or "87,45" (no thousands separators).
 */
export function amountOf(cell: Cell | undefined, column: string): string | null {
  if (isEmpty(cell)) return null;
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    const text = String(cell);
    if (/e/i.test(text)) throw new RowError('invalid_amount', column);
    return text;
  }
  if (typeof cell === 'string') {
    const text = cell.trim();
    if (/^-?\d+([.,]\d+)?$/.test(text)) return text.replace(',', '.');
  }
  throw new RowError('invalid_amount', column);
}

/** Whole number cell (days, counts). */
export function integerOf(cell: Cell | undefined, column: string): number | null {
  if (isEmpty(cell)) return null;
  const value = typeof cell === 'number' ? cell : Number(String(cell).trim());
  if (!Number.isInteger(value)) throw new RowError('invalid_number', column);
  return value;
}

/**
 * Localized dropdown label → domain enum value, by position (the template keeps the same
 * order in every language). The enum code itself is accepted too.
 */
export function enumOf<T extends string>(
  cell: Cell | undefined,
  labels: readonly string[],
  values: readonly T[],
  column: string,
): T | null {
  const text = textOf(cell);
  if (text === null) return null;
  const wanted = fold(text);
  const index = labels.findIndex((label) => fold(label) === wanted);
  if (index >= 0 && values[index]) return values[index];
  const code = values.find((value) => value.toLowerCase() === wanted);
  if (code) return code;
  throw new RowError('invalid_option', column);
}

/** Case/accent-insensitive key for names typed by people. */
export function fold(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** "a, b, c" → ["a", "b", "c"]. */
export function tagsOf(cell: Cell | undefined): string[] {
  const text = textOf(cell);
  return text
    ? text
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
}

/** Sheets `CellData` for a literal value (never a formula). */
export function cellData(value: Cell | undefined): Record<string, unknown> {
  if (isEmpty(value)) return {};
  if (typeof value === 'number') return { userEnteredValue: { numberValue: value } };
  if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
  return { userEnteredValue: { stringValue: value } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
