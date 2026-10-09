import { Prisma } from '../generated/prisma/client.js';
import { formatCalendarDate, parseCalendarDate } from './dates.js';
import {
  addMonthsAnchored,
  cardFirstDueDate,
  nextOccurrence,
  occurrencesBetween,
  parcelDueDate,
  type RecurrenceRule,
  splitAmount,
} from './schedule.js';

const d = (text: string) => parseCalendarDate(text) as Date;
const texts = (dates: Date[]) => dates.map(formatCalendarDate);
const decimal = (text: string) => new Prisma.Decimal(text);

const rule = (overrides: Partial<RecurrenceRule>): RecurrenceRule => ({
  frequency: 'MONTHLY',
  intervalCount: 1,
  intervalUnit: null,
  dayOfMonth: null,
  startOn: d('2026-01-01'),
  endOn: null,
  ...overrides,
});

describe('splitAmount', () => {
  it('splits R$ 3.600 in 12 parcels of exactly R$ 300', () => {
    const parcels = splitAmount(decimal('3600'), 12, 'BRL') as Prisma.Decimal[];
    expect(parcels.map((value) => value.toFixed(2))).toEqual(Array(12).fill('300.00'));
  });

  it('gives the residue cents to the first parcels so the sum is exact', () => {
    expect(
      (splitAmount(decimal('100'), 3, 'BRL') as Prisma.Decimal[]).map((v) =>
        v.toFixed(2),
      ),
    ).toEqual(['33.34', '33.33', '33.33']);
    const twelve = splitAmount(decimal('1000'), 12, 'BRL') as Prisma.Decimal[];
    expect(twelve.map((v) => v.toFixed(2))).toEqual([
      ...Array(4).fill('83.34'),
      ...Array(8).fill('83.33'),
    ]);
  });

  it('keeps the sum equal to the total for many totals and counts', () => {
    for (const total of ['0.12', '1.01', '99.99', '1234.57', '3600', '999999.99']) {
      for (const count of [2, 3, 7, 12, 24, 420]) {
        const parcels = splitAmount(decimal(total), count, 'BRL');
        if (!parcels) continue; // too small for that many parcels
        const sum = parcels.reduce((acc, value) => acc.plus(value), decimal('0'));
        expect(sum.equals(decimal(total))).toBe(true);
        expect(parcels).toHaveLength(count);
        const cents = parcels.map((value) => value.times(100));
        expect(cents.every((value) => value.isInteger() && value.greaterThan(0))).toBe(
          true,
        );
        // Parcels differ by at most one cent, larger ones first.
        expect(cents[0]?.minus(cents.at(-1) as Prisma.Decimal).lessThanOrEqualTo(1)).toBe(
          true,
        );
      }
    }
  });

  it('respects the currency minor unit (JPY has none)', () => {
    expect(
      (splitAmount(decimal('1000'), 3, 'JPY') as Prisma.Decimal[]).map((v) =>
        v.toFixed(),
      ),
    ).toEqual(['334', '333', '333']);
  });

  it('refuses a split where a parcel would be zero', () => {
    expect(splitAmount(decimal('0.05'), 12, 'BRL')).toBeNull();
    expect(
      (splitAmount(decimal('0.12'), 12, 'BRL') as Prisma.Decimal[]).every((v) =>
        v.equals(decimal('0.01')),
      ),
    ).toBe(true);
  });
});

describe('due dates', () => {
  it('keeps the anchor day across short months (no drift)', () => {
    const first = d('2026-01-31');
    expect(
      [1, 2, 3, 4, 13].map((n) => formatCalendarDate(parcelDueDate(first, n))),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2027-01-31']);
    expect(formatCalendarDate(addMonthsAnchored(d('2028-01-29'), 1))).toBe('2028-02-29');
    expect(formatCalendarDate(addMonthsAnchored(d('2026-11-15'), 3))).toBe('2027-02-15');
  });

  it('puts card purchases on the right statement around the closing day', () => {
    const due = (purchase: string, closing: number, dueDay: number) =>
      formatCalendarDate(cardFirstDueDate(d(purchase), closing, dueDay));
    expect(due('2026-03-02', 3, 10)).toBe('2026-03-10');
    expect(due('2026-03-03', 3, 10)).toBe('2026-04-10'); // closing day: next statement
    expect(due('2026-03-10', 25, 5)).toBe('2026-04-05'); // due in the month after closing
    expect(due('2026-03-26', 25, 5)).toBe('2026-05-05');
    expect(due('2026-12-20', 25, 5)).toBe('2027-01-05'); // year boundary
    expect(due('2026-02-27', 30, 10)).toBe('2026-03-10'); // closing 30 → 28/02
    expect(due('2026-02-28', 30, 10)).toBe('2026-04-10');
  });
});

describe('recurrences', () => {
  it('monthly on day 31 clamps to short months without drifting', () => {
    const dates = occurrencesBetween(
      rule({ startOn: d('2026-01-31') }),
      d('2026-01-01'),
      d('2026-05-31'),
    );
    expect(texts(dates)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('"todo dia 10" starting after day 10 begins next month; salary on the 30th', () => {
    expect(
      texts(
        occurrencesBetween(
          rule({ dayOfMonth: 10, startOn: d('2026-03-15') }),
          d('2026-01-01'),
          d('2026-06-30'),
        ),
      ),
    ).toEqual(['2026-04-10', '2026-05-10', '2026-06-10']);
    expect(
      texts(
        occurrencesBetween(
          rule({ dayOfMonth: 30, startOn: d('2026-01-01') }),
          d('2026-01-01'),
          d('2026-03-31'),
        ),
      ),
    ).toEqual(['2026-01-30', '2026-02-28', '2026-03-30']);
  });

  it('weekly, biweekly (every 14 days) and custom day/week intervals', () => {
    expect(
      texts(
        occurrencesBetween(
          rule({ frequency: 'WEEKLY', startOn: d('2026-02-20') }),
          d('2026-02-01'),
          d('2026-03-10'),
        ),
      ),
    ).toEqual(['2026-02-20', '2026-02-27', '2026-03-06']);
    expect(
      texts(
        occurrencesBetween(
          rule({ frequency: 'BIWEEKLY', startOn: d('2026-12-25') }),
          d('2026-12-01'),
          d('2027-01-31'),
        ),
      ),
    ).toEqual(['2026-12-25', '2027-01-08', '2027-01-22']);
    expect(
      texts(
        occurrencesBetween(
          rule({
            frequency: 'CUSTOM',
            intervalUnit: 'DAY',
            intervalCount: 10,
            startOn: d('2026-02-25'),
          }),
          d('2026-01-01'),
          d('2026-03-20'),
        ),
      ),
    ).toEqual(['2026-02-25', '2026-03-07', '2026-03-17']);
  });

  it('yearly on 29/02 falls on 28/02 in common years and returns to 29/02', () => {
    expect(
      texts(
        occurrencesBetween(
          rule({ frequency: 'YEARLY', startOn: d('2028-02-29') }),
          d('2028-01-01'),
          d('2032-12-31'),
        ),
      ),
    ).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });

  it('custom every 3 months on day 31 and every 2 years', () => {
    expect(
      texts(
        occurrencesBetween(
          rule({
            frequency: 'CUSTOM',
            intervalUnit: 'MONTH',
            intervalCount: 3,
            dayOfMonth: 31,
            startOn: d('2026-01-31'),
          }),
          d('2026-01-01'),
          d('2026-12-31'),
        ),
      ),
    ).toEqual(['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
    expect(
      texts(
        occurrencesBetween(
          rule({
            frequency: 'CUSTOM',
            intervalUnit: 'YEAR',
            intervalCount: 2,
            startOn: d('2026-06-15'),
          }),
          d('2026-01-01'),
          d('2031-12-31'),
        ),
      ),
    ).toEqual(['2026-06-15', '2028-06-15', '2030-06-15']);
  });

  it('respects the start, the end date and the limit', () => {
    const monthly = rule({
      dayOfMonth: 5,
      startOn: d('2026-01-05'),
      endOn: d('2026-04-05'),
    });
    expect(texts(occurrencesBetween(monthly, d('2026-02-01'), d('2026-12-31')))).toEqual([
      '2026-02-05',
      '2026-03-05',
      '2026-04-05',
    ]);
    expect(occurrencesBetween(monthly, d('2025-01-01'), d('2025-12-31'))).toEqual([]);
    expect(
      occurrencesBetween(
        rule({ frequency: 'CUSTOM', intervalUnit: 'DAY', intervalCount: 1 }),
        d('2026-01-01'),
        d('2027-12-31'),
        500,
      ),
    ).toHaveLength(500);
  });

  it('jumping to a late window gives the same dates as walking from the start', () => {
    const rules = [
      rule({ startOn: d('2020-01-31') }),
      rule({ dayOfMonth: 28, startOn: d('2019-07-29') }),
      rule({ frequency: 'WEEKLY', startOn: d('2021-03-03') }),
      rule({ frequency: 'BIWEEKLY', startOn: d('2018-11-11') }),
      rule({ frequency: 'YEARLY', startOn: d('2012-02-29') }),
      rule({
        frequency: 'CUSTOM',
        intervalUnit: 'MONTH',
        intervalCount: 5,
        startOn: d('2015-08-31'),
      }),
      rule({
        frequency: 'CUSTOM',
        intervalUnit: 'DAY',
        intervalCount: 9,
        startOn: d('2017-05-05'),
      }),
    ];
    for (const item of rules) {
      const all = occurrencesBetween(item, item.startOn, d('2030-12-31'), 100_000);
      const window = occurrencesBetween(item, d('2026-02-14'), d('2027-03-01'));
      expect(texts(window)).toEqual(
        texts(
          all.filter(
            (date) =>
              date.getTime() >= d('2026-02-14').getTime() &&
              date.getTime() <= d('2027-03-01').getTime(),
          ),
        ),
      );
    }
  });

  it('finds the next occurrence on or after a date', () => {
    const monthly = rule({ dayOfMonth: 5, startOn: d('2026-01-05') });
    expect(formatCalendarDate(nextOccurrence(monthly, d('2026-03-05')) as Date)).toBe(
      '2026-03-05',
    );
    expect(formatCalendarDate(nextOccurrence(monthly, d('2026-03-06')) as Date)).toBe(
      '2026-04-05',
    );
    expect(formatCalendarDate(nextOccurrence(monthly, d('2025-06-01')) as Date)).toBe(
      '2026-01-05',
    );
  });
});
