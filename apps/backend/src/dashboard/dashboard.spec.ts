import { formatCalendarDate, parseCalendarDate, todayIn } from '../finance/dates.js';
import { Prisma } from '../generated/prisma/client.js';
import { buildInsights, type InsightInput } from './insights.js';
import { bucketEnd, bucketsOf, resolvePeriod } from './periods.js';

const d = (text: string) => parseCalendarDate(text) as Date;
const f = formatCalendarDate;
const dec = (value: string) => new Prisma.Decimal(value);

function shape(
  key: Parameters<typeof resolvePeriod>[0],
  today: string,
  weekStartsOn: 'monday' | 'sunday' = 'monday',
) {
  const period = resolvePeriod(key, d(today), weekStartsOn);
  return {
    from: f(period.from),
    to: f(period.to),
    previousFrom: f(period.previousFrom),
    previousTo: f(period.previousTo),
    groupBy: period.groupBy,
  };
}

describe('dashboard periods', () => {
  it('covers whole calendar units with the comparable previous one', () => {
    expect(shape('today', '2026-03-01')).toEqual({
      from: '2026-03-01',
      to: '2026-03-01',
      previousFrom: '2026-02-28',
      previousTo: '2026-02-28',
      groupBy: 'day',
    });
    expect(shape('month', '2024-03-15')).toEqual({
      from: '2024-03-01',
      to: '2024-03-31',
      previousFrom: '2024-02-01',
      previousTo: '2024-02-29', // leap year
      groupBy: 'day',
    });
    expect(shape('3m', '2026-01-10')).toEqual({
      from: '2025-11-01',
      to: '2026-01-31',
      previousFrom: '2025-08-01',
      previousTo: '2025-10-31',
      groupBy: 'month',
    });
    expect(shape('6m', '2026-10-09')).toMatchObject({
      from: '2026-05-01',
      to: '2026-10-31',
    });
    expect(shape('year', '2026-10-09')).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
      previousFrom: '2025-01-01',
      previousTo: '2025-12-31',
      groupBy: 'month',
    });
  });

  it('starts the week on the day chosen in the profile', () => {
    // 2026-10-11 is a Sunday.
    expect(shape('week', '2026-10-11', 'monday')).toMatchObject({
      from: '2026-10-05',
      to: '2026-10-11',
      previousFrom: '2026-09-28',
      previousTo: '2026-10-04',
    });
    expect(shape('week', '2026-10-11', 'sunday')).toMatchObject({
      from: '2026-10-11',
      to: '2026-10-17',
    });
    expect(shape('week', '2026-10-05', 'monday')).toMatchObject({ from: '2026-10-05' });
  });

  it('compares a custom period with the same number of days right before it', () => {
    const period = resolvePeriod('custom', d('2026-10-09'), 'monday', {
      from: d('2026-03-10'),
      to: d('2026-03-19'),
    });
    expect([f(period.previousFrom), f(period.previousTo)]).toEqual([
      '2026-02-28',
      '2026-03-09',
    ]);
    const long = resolvePeriod('custom', d('2026-10-09'), 'monday', {
      from: d('2026-01-01'),
      to: d('2026-03-31'),
    });
    expect(long.groupBy).toBe('month');
  });

  it('"today" follows the user time zone, not the server', () => {
    // 02:30 UTC on the 10th is still the 9th in São Paulo and already the 10th in Tokyo.
    const instant = new Date('2026-10-10T02:30:00Z');
    expect(f(todayIn('America/Sao_Paulo', instant))).toBe('2026-10-09');
    expect(f(todayIn('Asia/Tokyo', instant))).toBe('2026-10-10');
    expect(
      shape('month', f(todayIn('America/Sao_Paulo', new Date('2026-11-01T01:00:00Z')))),
    ).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('lists every bucket (no gaps) and clamps bucket ends to the period', () => {
    expect(bucketsOf(d('2026-02-27'), d('2026-03-02'), 'day')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(bucketsOf(d('2025-11-15'), d('2026-02-03'), 'month')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(f(bucketEnd('2026-02', d('2026-12-31')))).toBe('2026-02-28');
    expect(f(bucketEnd('2026-02', d('2026-02-10')))).toBe('2026-02-10');
  });
});

function input(overrides: Partial<InsightInput> = {}): InsightInput {
  return {
    currency: 'BRL',
    from: '2026-10-01',
    to: '2026-10-31',
    previousFrom: '2026-09-01',
    previousTo: '2026-09-30',
    incomes: dec('5000'),
    expenses: dec('3550'),
    previousExpenses: dec('2689.39'),
    categories: [
      { key: 'food', name: 'Alimentação', amount: dec('1000') },
      { key: 'delivery', name: 'Delivery', amount: dec('660') },
      { key: 'tiny', name: 'Tarifas', amount: dec('10') },
    ],
    previousCategories: [
      { key: 'food', amount: dec('950') },
      { key: 'delivery', amount: dec('500') },
      { key: 'tiny', amount: dec('1') },
    ],
    upcoming: {
      amount: dec('1480'),
      count: 3,
      days: 7,
      from: '2026-10-09',
      to: '2026-10-15',
    },
    overdue: { amount: dec('0'), count: 0, today: '2026-10-09' },
    savings: {
      from: '2026-08-01',
      to: '2026-10-09',
      incomes: dec('15000'),
      expenses: dec('12900'),
    },
    ...overrides,
  };
}

describe('insights', () => {
  it('states comparisons exactly, from the given numbers only', () => {
    const insights = buildInsights(input());
    const byKind = Object.fromEntries(insights.map((item) => [item.kind, item]));

    expect(insights.map((item) => item.kind)).toEqual([
      'upcoming_bills',
      'expenses_change',
      'expense_ratio',
      'category_change',
      'top_category',
      'savings_rate',
    ]);
    expect(byKind.expenses_change).toMatchObject({
      tone: 'attention',
      values: {
        direction: 'up',
        change: '32.0',
        current: '3550.00',
        previous: '2689.39',
      },
    });
    expect(byKind.expense_ratio?.values).toMatchObject({ ratio: '71' });
    // Delivery grew 32% with 18.6% of the expenses; the tiny fee grew 900% but is noise.
    expect(byKind.category_change?.values).toMatchObject({
      category: 'Delivery',
      change: '32.0',
    });
    expect(byKind.top_category?.values).toMatchObject({
      category: 'Alimentação',
      share: '28.2',
    });
    expect(byKind.upcoming_bills?.values).toEqual({
      amount: '1480.00',
      count: 3,
      days: 7,
    });
    expect(byKind.savings_rate).toMatchObject({
      tone: 'positive',
      from: '2026-08-01',
      values: { rate: '14.0', saved: '2100.00', months: 3 },
    });
  });

  it('says nothing it cannot back: no division by zero, no tiny changes', () => {
    const quiet = buildInsights(
      input({
        incomes: dec('0'),
        expenses: dec('100'),
        previousExpenses: dec('98'),
        categories: [],
        upcoming: { amount: dec('0'), count: 0, days: 7, from: 'a', to: 'b' },
        savings: { from: 'a', to: 'b', incomes: dec('0'), expenses: dec('50') },
      }),
    );
    expect(quiet).toEqual([]);
    expect(
      buildInsights(input({ previousExpenses: dec('0') })).some(
        (item) => item.kind === 'expenses_change',
      ),
    ).toBe(false);
  });

  it('flags overdue bills first and negative savings as attention', () => {
    const insights = buildInsights(
      input({
        overdue: { amount: dec('320.5'), count: 2, today: '2026-10-09' },
        expenses: dec('2000'),
        previousExpenses: dec('2500'),
        savings: { from: 'a', to: 'b', incomes: dec('1000'), expenses: dec('1200') },
      }),
    );
    expect(insights[0]).toMatchObject({
      kind: 'overdue_bills',
      tone: 'attention',
      values: { amount: '320.50', count: 2 },
    });
    expect(insights.find((item) => item.kind === 'expenses_change')).toMatchObject({
      tone: 'positive',
      values: { direction: 'down', change: '20.0' },
    });
    expect(insights.find((item) => item.kind === 'savings_rate')).toMatchObject({
      tone: 'attention',
      values: { rate: '-20.0' },
    });
  });

  it('formats amounts with the currency decimals', () => {
    const yen = buildInsights(
      input({
        currency: 'JPY',
        upcoming: { amount: dec('1500'), count: 1, days: 7, from: 'a', to: 'b' },
      }),
    );
    expect(yen.find((item) => item.kind === 'upcoming_bills')?.values.amount).toBe(
      '1500',
    );
  });
});
