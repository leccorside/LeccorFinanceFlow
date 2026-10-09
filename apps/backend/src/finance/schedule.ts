import { Prisma } from '../generated/prisma/client.js';
import { addDays } from './dates.js';
import { currencyDigits } from './money.js';

/**
 * Pure calendar and money rules for installments and recurrences. No I/O: everything here is
 * deterministic and unit-tested (month ends, leap years, cent residues).
 */

/** Day `day` of (year, month), month 0-based and allowed to overflow; clamped to the month end. */
export function clampedDate(year: number, month: number, day: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay)),
  );
}

/**
 * Same day `months` later, clamped to the month end and always anchored on `anchorDay`
 * (31/01 → 28/02 → 31/03: no drift after a short month).
 */
export function addMonthsAnchored(date: Date, months: number, anchorDay?: number): Date {
  return clampedDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    anchorDay ?? date.getUTCDate(),
  );
}

// ─────────────────────────────── Installments ───────────────────────────────

/**
 * Splits `total` into `count` parcels in the currency's minor units. The residue cents go one
 * by one to the first parcels (100.00 / 3 = 33.34 + 33.33 + 33.33), so the sum is exact.
 * Returns null when a parcel would be zero.
 */
export function splitAmount(
  total: Prisma.Decimal,
  count: number,
  currency: string,
): Prisma.Decimal[] | null {
  const scale = new Prisma.Decimal(10).pow(currencyDigits(currency));
  const units = total.times(scale);
  if (!units.isInteger() || units.lessThan(count)) return null;
  const base = units.dividedToIntegerBy(count);
  const residue = units.minus(base.times(count)).toNumber();
  return Array.from({ length: count }, (_, index) =>
    (index < residue ? base.plus(1) : base).dividedBy(scale),
  );
}

/** Due date of parcel `number` (1-based): monthly from the first due date, same day. */
export function parcelDueDate(firstDueOn: Date, number: number): Date {
  return addMonthsAnchored(firstDueOn, number - 1, firstDueOn.getUTCDate());
}

/**
 * First due date of a card purchase: purchases before the closing day go to that month's
 * statement; on or after it, to the next one. The statement is due on the first `dueDay`
 * after its closing date.
 */
export function cardFirstDueDate(
  purchasedOn: Date,
  closingDay: number,
  dueDay: number,
): Date {
  let closing = clampedDate(
    purchasedOn.getUTCFullYear(),
    purchasedOn.getUTCMonth(),
    closingDay,
  );
  if (closing.getTime() <= purchasedOn.getTime()) {
    closing = clampedDate(
      closing.getUTCFullYear(),
      closing.getUTCMonth() + 1,
      closingDay,
    );
  }
  let due = clampedDate(closing.getUTCFullYear(), closing.getUTCMonth(), dueDay);
  if (due.getTime() <= closing.getTime()) {
    due = clampedDate(due.getUTCFullYear(), due.getUTCMonth() + 1, dueDay);
  }
  return due;
}

// ──────────────────────────────── Recurrences ───────────────────────────────

export type Frequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'YEARLY' | 'CUSTOM';
export type IntervalUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

export interface RecurrenceRule {
  frequency: Frequency;
  intervalCount: number;
  intervalUnit: IntervalUnit | null;
  /** MONTHLY or CUSTOM/MONTH only; defaults to the start day. Clamped to the month end. */
  dayOfMonth: number | null;
  startOn: Date;
  endOn: Date | null;
}

/** Hard cap of occurrences produced by one call (keeps on-demand work bounded). */
export const MAX_OCCURRENCES_PER_CALL = 500;

/**
 * The n-th candidate date (n ≥ 0) counted from the rule's anchor. Every candidate is
 * computed from the anchor, never from the previous date, so month ends do not drift.
 * Monthly candidates may fall before `startOn` (day 5 for a start on the 20th): callers skip them.
 */
function candidate(rule: RecurrenceRule, n: number): Date {
  const start = rule.startOn;
  const { unit, every } = normalized(rule);
  switch (unit) {
    case 'DAY':
      return addDays(start, n * every);
    case 'WEEK':
      return addDays(start, n * every * 7);
    case 'MONTH':
      return clampedDate(
        start.getUTCFullYear(),
        start.getUTCMonth() + n * every,
        rule.dayOfMonth ?? start.getUTCDate(),
      );
    case 'YEAR':
      return clampedDate(
        start.getUTCFullYear() + n * every,
        start.getUTCMonth(),
        start.getUTCDate(),
      );
  }
}

function normalized(rule: RecurrenceRule): { unit: IntervalUnit; every: number } {
  switch (rule.frequency) {
    case 'WEEKLY':
      return { unit: 'WEEK', every: 1 };
    case 'BIWEEKLY':
      return { unit: 'WEEK', every: 2 };
    case 'MONTHLY':
      return { unit: 'MONTH', every: 1 };
    case 'YEARLY':
      return { unit: 'YEAR', every: 1 };
    case 'CUSTOM':
      return { unit: rule.intervalUnit as IntervalUnit, every: rule.intervalCount };
  }
}

/**
 * Occurrence dates within [from, to] (inclusive), never before `startOn` nor after `endOn`,
 * in ascending order and at most `limit` of them.
 */
export function occurrencesBetween(
  rule: RecurrenceRule,
  from: Date,
  to: Date,
  limit = MAX_OCCURRENCES_PER_CALL,
): Date[] {
  const lower = Math.max(from.getTime(), rule.startOn.getTime());
  const upper = Math.min(to.getTime(), rule.endOn?.getTime() ?? Number.POSITIVE_INFINITY);
  const dates: Date[] = [];
  if (lower > upper) return dates;

  // Jump close to `lower` instead of walking from the anchor (old daily rules stay cheap).
  let n = Math.max(0, estimateIndex(rule, lower) - 1);
  for (; dates.length < limit; n += 1) {
    const date = candidate(rule, n);
    if (date.getTime() > upper) break;
    if (date.getTime() >= lower) dates.push(date);
  }
  return dates;
}

/** First occurrence on or after `date` (ignores `endOn`; null only past the year 2100). */
export function nextOccurrence(rule: RecurrenceRule, date: Date): Date | null {
  const [next] = occurrencesBetween(
    { ...rule, endOn: null },
    date,
    new Date(Date.UTC(2100, 11, 31)),
    1,
  );
  return next ?? null;
}

/** Lower bound for the index whose candidate is at or after `time` (never overshoots). */
function estimateIndex(rule: RecurrenceRule, time: number): number {
  const { unit, every } = normalized(rule);
  const start = rule.startOn;
  const target = new Date(time);
  if (unit === 'DAY' || unit === 'WEEK') {
    const days = Math.floor((time - start.getTime()) / 86_400_000);
    return Math.floor(days / (every * (unit === 'WEEK' ? 7 : 1)));
  }
  const months =
    (target.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (target.getUTCMonth() - start.getUTCMonth());
  return Math.floor((unit === 'YEAR' ? Math.floor(months / 12) : months) / every);
}
