/** Calendar helpers for the report period picker (dates as "YYYY-MM-DD", no time zone). */

export type Preset = 'thisMonth' | 'lastMonth' | 'last3' | 'thisYear' | 'custom';
export const PRESETS: Preset[] = [
  'thisMonth',
  'lastMonth',
  'last3',
  'thisYear',
  'custom',
];

/** Today's calendar date in a time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day));

/** The from/to of a preset around `today`. */
export function presetRange(preset: Exclude<Preset, 'custom'>, today: string) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  switch (preset) {
    case 'thisMonth':
      return { from: iso(utc(year, month, 1)), to: iso(utc(year, month + 1, 0)) };
    case 'lastMonth':
      return { from: iso(utc(year, month - 1, 1)), to: iso(utc(year, month, 0)) };
    case 'last3':
      return { from: iso(utc(year, month - 2, 1)), to: iso(utc(year, month + 1, 0)) };
    case 'thisYear':
      return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
}

/** "2026-09" → "2026-09-01" and "2026-09-30". */
export function monthRange(month: string) {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  return { from: iso(utc(year, index, 1)), to: iso(utc(year, index + 1, 0)) };
}
