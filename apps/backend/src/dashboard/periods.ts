import {
  addDays,
  daysBetween,
  endOfMonth,
  formatCalendarDate,
  parseCalendarDate,
  startOfMonth,
} from '../finance/dates.js';

export const PERIOD_KEYS = [
  'today',
  'week',
  'month',
  '3m',
  '6m',
  'year',
  'custom',
] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
export type WeekStart = 'monday' | 'sunday';
export type GroupBy = 'day' | 'month';

/** Longest custom period (5 years): the dashboard answers synchronously. */
export const MAX_DASHBOARD_DAYS = 1_830;
/** Up to this many days the series are daily; longer ones are monthly. */
export const DAILY_UP_TO_DAYS = 62;

export interface ResolvedPeriod {
  key: PeriodKey;
  from: Date;
  to: Date;
  /** The comparable period right before (same length / same calendar shape). */
  previousFrom: Date;
  previousTo: Date;
  groupBy: GroupBy;
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function startOfWeek(today: Date, weekStartsOn: WeekStart): Date {
  const weekday = today.getUTCDay(); // 0 = Sunday
  const offset = weekStartsOn === 'sunday' ? weekday : (weekday + 6) % 7;
  return addDays(today, -offset);
}

/**
 * Calendar periods around "today" in the user's time zone. They cover the whole calendar
 * unit (this month = 1st to last day), so bills scheduled later in the month count as
 * pending; "3m"/"6m" include the current month.
 */
export function resolvePeriod(
  key: PeriodKey,
  today: Date,
  weekStartsOn: WeekStart,
  custom?: { from: Date; to: Date },
): ResolvedPeriod {
  let from: Date;
  let to: Date;
  let previousFrom: Date;
  let previousTo: Date;
  switch (key) {
    case 'today':
      from = today;
      to = today;
      previousFrom = addDays(today, -1);
      previousTo = previousFrom;
      break;
    case 'week':
      from = startOfWeek(today, weekStartsOn);
      to = addDays(from, 6);
      previousFrom = addDays(from, -7);
      previousTo = addDays(from, -1);
      break;
    case 'month':
      from = startOfMonth(today);
      to = endOfMonth(today);
      previousFrom = addMonths(from, -1);
      previousTo = addDays(from, -1);
      break;
    case '3m':
    case '6m': {
      const months = key === '3m' ? 3 : 6;
      from = addMonths(startOfMonth(today), -(months - 1));
      to = endOfMonth(today);
      previousFrom = addMonths(from, -months);
      previousTo = addDays(from, -1);
      break;
    }
    case 'year':
      from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
      to = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
      previousFrom = new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1));
      previousTo = addDays(from, -1);
      break;
    case 'custom': {
      if (!custom) throw new Error('custom period without dates');
      from = custom.from;
      to = custom.to;
      const length = daysBetween(from, to);
      previousTo = addDays(from, -1);
      previousFrom = addDays(previousTo, -(length - 1));
      break;
    }
  }
  return {
    key,
    from,
    to,
    previousFrom,
    previousTo,
    groupBy: daysBetween(from, to) <= DAILY_UP_TO_DAYS ? 'day' : 'month',
  };
}

/** Every bucket of the period, so charts show empty days/months as zero (no gaps). */
export function bucketsOf(from: Date, to: Date, groupBy: GroupBy): string[] {
  const keys: string[] = [];
  if (groupBy === 'day') {
    for (let day = from; day <= to; day = addDays(day, 1))
      keys.push(formatCalendarDate(day));
    return keys;
  }
  for (let month = startOfMonth(from); month <= to; month = addMonths(month, 1)) {
    keys.push(formatCalendarDate(month).slice(0, 7));
  }
  return keys;
}

/** Last calendar day of a bucket ("2026-10" → 2026-10-31, clamped to the period end). */
export function bucketEnd(bucket: string, to: Date): Date {
  const end =
    bucket.length === 7
      ? endOfMonth(parseCalendarDate(`${bucket}-01`) as Date)
      : (parseCalendarDate(bucket) as Date);
  return end > to ? to : end;
}
