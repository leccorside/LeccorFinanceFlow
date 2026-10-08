import type { Locale } from './catalog';

/**
 * Presentation-only formatting. Money arrives from the API as decimal strings and is
 * passed to Intl as a string, so no binary floating point is involved.
 */
export function formatMoney(
  amount: string | number,
  currency: string,
  locale: Locale,
): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amount as unknown as number,
  );
}

/** An instant (ISO with time) shown in the user's time zone. */
export function formatDateTime(
  instant: string | Date,
  locale: Locale,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(typeof instant === 'string' ? new Date(instant) : instant);
}

/**
 * A calendar date ("2026-10-08": due date, occurrence date). It has no time of day,
 * so it must never shift with the time zone.
 */
export function formatCalendarDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

export const COMMON_CURRENCIES = [
  'BRL',
  'USD',
  'EUR',
  'GBP',
  'ARS',
  'CLP',
  'COP',
  'MXN',
  'PEN',
  'UYU',
  'CAD',
  'JPY',
];

export function supportedTimeZones(): string[] {
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [];
  return zones.includes('UTC') ? zones : ['UTC', ...zones];
}
