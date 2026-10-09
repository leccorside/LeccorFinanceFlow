/**
 * Calendar dates ("YYYY-MM-DD") have no time zone: stored as `date`, represented in JS as
 * UTC midnight. "Today" depends on the user's time zone.
 */

const CALENDAR = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

/** Strict: rejects impossible dates (2026-02-30) and years outside 1900–2100. */
export function parseCalendarDate(value: string): Date | null {
  const match = CALENDAR.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

export function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's calendar date in `timeZone` (e.g. still yesterday in Honolulu). */
export function todayIn(timeZone: string, now: Date = new Date()): Date {
  const text = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parseCalendarDate(text) as Date;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

/** Inclusive number of days between two calendar dates. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}
