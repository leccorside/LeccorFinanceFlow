import type { Cell } from './report.types.js';

/** Amounts arrive as exact decimal text and are formatted as text (no floating point). */
export function formatMoney(amount: string, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amount as unknown as number,
  );
}

/** A calendar date "YYYY-MM-DD" (never shifted by a time zone). */
export function formatDate(
  date: string,
  locale: string,
  style: 'short' | 'long' = 'short',
): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: style, timeZone: 'UTC' }).format(
    new Date(`${date.slice(0, 10)}T00:00:00Z`),
  );
}

export function formatPercent(value: string, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(value))}%`;
}

/** "2026-10" → "out. 2026"; days → short date. */
export function formatBucket(bucket: string, locale: string): string {
  if (bucket.length === 7) {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${bucket}-01T00:00:00Z`));
  }
  return formatDate(bucket, locale);
}

export function cellText(cell: Cell, locale: string): string {
  if (typeof cell === 'string') return cell;
  if ('money' in cell) return formatMoney(cell.money, cell.currency, locale);
  if ('date' in cell) return formatDate(cell.date, locale);
  if ('percent' in cell) return formatPercent(cell.percent, locale);
  return new Intl.NumberFormat(locale).format(cell.count);
}

/** Characters the PDF standard fonts (WinAnsi) can draw. */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/**
 * Text safe for the built-in PDF fonts: Intl's special spaces become spaces and anything
 * outside WinAnsi (emoji, CJK…) becomes "?", instead of breaking the document.
 */
export function pdfSafe(text: string): string {
  let out = '';
  for (const char of text.normalize('NFC').replace(/[\u00a0\u202f\u2009]/g, ' ')) {
    const code = char.codePointAt(0) ?? 0;
    out +=
      (code >= 32 && code <= 126) ||
      (code >= 160 && code <= 255) ||
      WIN_ANSI_EXTRA.has(char)
        ? char
        : code === 9 || code === 10
          ? ' '
          : '?';
  }
  return out;
}
