import { Prisma } from '../generated/prisma/client.js';
import { diffSnapshots, snapshotOf } from './action-history.service.js';
import {
  addDays,
  endOfMonth,
  formatCalendarDate,
  parseCalendarDate,
  startOfMonth,
  todayIn,
} from './dates.js';
import { currencyDigits, moneyString, parseMoney, sum } from './money.js';

describe('parseMoney', () => {
  it.each([
    ['10', 'BRL', '10'],
    ['10.5', 'BRL', '10.5'],
    ['1234.56', 'BRL', '1234.56'],
    [' 7.25 ', 'USD', '7.25'],
    [99.9, 'BRL', '99.9'],
    ['500', 'JPY', '500'],
    ['1.234', 'BHD', '1.234'],
    ['123456789012345.12', 'BRL', '123456789012345.12'],
  ])('accepts %j in %s', (input, currency, expected) => {
    const result = parseMoney(input, currency);
    expect(result.ok && result.value.toString()).toBe(expected);
  });

  it.each([
    ['10.555', 'BRL', 'too_many_decimals'],
    ['10.5', 'JPY', 'too_many_decimals'],
    ['0', 'BRL', 'amount_not_positive'],
    ['0.00', 'BRL', 'amount_not_positive'],
    ['-5', 'BRL', 'amount_not_positive'],
    ['1e3', 'BRL', 'invalid_amount'],
    ['1,50', 'BRL', 'invalid_amount'],
    ['R$ 10', 'BRL', 'invalid_amount'],
    ['', 'BRL', 'invalid_amount'],
    ['1234567890123456', 'BRL', 'invalid_amount'],
    [Number.NaN, 'BRL', 'invalid_amount'],
    [1e21, 'BRL', 'invalid_amount'],
    [null, 'BRL', 'invalid_amount'],
  ])('rejects %j in %s (%s)', (input, currency, issue) => {
    expect(parseMoney(input, currency)).toEqual({ ok: false, issue });
  });

  it('allows zero and negatives only when asked (opening balances)', () => {
    expect(parseMoney('0', 'BRL', { allowZero: true }).ok).toBe(true);
    const negative = parseMoney('-1500.25', 'BRL', {
      allowZero: true,
      allowNegative: true,
    });
    expect(negative.ok && negative.value.toString()).toBe('-1500.25');
  });

  it('sums exactly where floats fail', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    const total = sum([new Prisma.Decimal('0.1'), new Prisma.Decimal('0.2'), null]);
    expect(moneyString(total, 'BRL')).toBe('0.30');
  });

  it('knows the minor units of each currency', () => {
    expect([currencyDigits('BRL'), currencyDigits('JPY'), currencyDigits('BHD')]).toEqual(
      [2, 0, 3],
    );
    expect(moneyString(new Prisma.Decimal('1000'), 'JPY')).toBe('1000');
  });
});

describe('calendar dates', () => {
  it.each(['2026-02-28', '2028-02-29', '1900-01-01', '2100-12-31'])(
    'accepts %s',
    (date) => {
      expect(formatCalendarDate(parseCalendarDate(date) as Date)).toBe(date);
    },
  );

  it.each([
    '2026-02-29',
    '2026-13-01',
    '2026-04-31',
    '1899-12-31',
    '2101-01-01',
    '26-01-01',
    '2026-1-1',
    'hoje',
  ])('rejects %s', (date) => {
    expect(parseCalendarDate(date)).toBeNull();
  });

  it('computes today in the user time zone', () => {
    const instant = new Date('2026-10-09T02:00:00Z'); // 23:00 of the 8th in São Paulo
    expect(formatCalendarDate(todayIn('America/Sao_Paulo', instant))).toBe('2026-10-08');
    expect(formatCalendarDate(todayIn('Asia/Tokyo', instant))).toBe('2026-10-09');
    expect(
      formatCalendarDate(todayIn('Pacific/Kiritimati', new Date('2026-10-08T11:00:00Z'))),
    ).toBe('2026-10-09');
  });

  it('handles month boundaries', () => {
    const date = parseCalendarDate('2026-02-14') as Date;
    expect(formatCalendarDate(startOfMonth(date))).toBe('2026-02-01');
    expect(formatCalendarDate(endOfMonth(date))).toBe('2026-02-28');
    expect(formatCalendarDate(addDays(parseCalendarDate('2026-12-31') as Date, 1))).toBe(
      '2027-01-01',
    );
  });
});

describe('action snapshots', () => {
  const row = {
    id: 't1',
    ownerId: 'u1',
    amount: new Prisma.Decimal('10.50'),
    occurredOn: new Date('2026-10-08T00:00:00Z'),
    tags: ['a'],
    notes: null,
    syncStatus: 'PENDING_SYNC',
    version: 1,
  };

  it('serializes Decimal and Date and drops ownership/sync bookkeeping', () => {
    expect(snapshotOf(row)).toEqual({
      id: 't1',
      amount: '10.5',
      occurredOn: '2026-10-08T00:00:00.000Z',
      tags: ['a'],
      notes: null,
      version: 1,
    });
  });

  it('keeps only the changed fields of an update (ignoring version)', () => {
    const after = snapshotOf({
      ...row,
      amount: new Prisma.Decimal('12'),
      notes: 'x',
      version: 2,
    });
    expect(diffSnapshots(snapshotOf(row), after)).toEqual({
      before: { amount: '10.5', notes: null },
      after: { amount: '12', notes: 'x' },
    });
    expect(diffSnapshots(snapshotOf(row), snapshotOf({ ...row, version: 3 }))).toBeNull();
  });
});
