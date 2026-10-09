import { Prisma } from '../generated/prisma/client.js';
import { moneyString } from '../finance/money.js';

type Decimal = Prisma.Decimal;

export type InsightKind =
  | 'overdue_bills'
  | 'upcoming_bills'
  | 'expenses_change'
  | 'expense_ratio'
  | 'category_change'
  | 'top_category'
  | 'savings_rate';

/**
 * A statement backed only by the user's own numbers. The text is built by the client from
 * `kind` + `values` (localized); every value is already formatted as exact decimal text.
 * Never a recommendation, a forecast or a promise of return.
 */
export interface Insight {
  id: string;
  kind: InsightKind;
  tone: 'positive' | 'neutral' | 'attention';
  currency: string;
  /** Period the statement is about (calendar dates). */
  from: string;
  to: string;
  values: Record<string, string | number>;
}

export interface InsightInput {
  currency: string;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  /** COMPLETED + PENDING, like the cards. */
  incomes: Decimal;
  expenses: Decimal;
  previousExpenses: Decimal;
  categories: { key: string; name: string | null; amount: Decimal }[];
  previousCategories: { key: string; amount: Decimal }[];
  upcoming: { amount: Decimal; count: number; days: number; from: string; to: string };
  overdue: { amount: Decimal; count: number; today: string };
  /** Realized (COMPLETED) incomes and expenses of the last three months. */
  savings: { from: string; to: string; incomes: Decimal; expenses: Decimal };
}

/** Changes smaller than this (in %) are noise, not a statement. */
export const MIN_CHANGE_PERCENT = 5;
/** A category must grow at least this much (in %) to be called out. */
export const MIN_CATEGORY_CHANGE_PERCENT = 20;
/** …and represent at least this share of the period's expenses. */
export const MIN_CATEGORY_SHARE_PERCENT = 5;

const HUNDRED = new Prisma.Decimal(100);

function percent(part: Decimal, whole: Decimal, places: number): string {
  return part.dividedBy(whole).times(HUNDRED).toFixed(places);
}

/** Deterministic insights for one currency, most urgent first. */
export function buildInsights(input: InsightInput): Insight[] {
  const { currency } = input;
  const money = (value: Decimal) => moneyString(value, currency) as string;
  const insights: Insight[] = [];
  const add = (
    kind: InsightKind,
    tone: Insight['tone'],
    range: { from: string; to: string },
    values: Insight['values'],
  ) =>
    insights.push({ id: `${kind}:${currency}`, kind, tone, currency, ...range, values });

  if (input.overdue.count > 0) {
    add(
      'overdue_bills',
      'attention',
      { from: input.overdue.today, to: input.overdue.today },
      { amount: money(input.overdue.amount), count: input.overdue.count },
    );
  }
  if (input.upcoming.count > 0) {
    add(
      'upcoming_bills',
      'neutral',
      { from: input.upcoming.from, to: input.upcoming.to },
      {
        amount: money(input.upcoming.amount),
        count: input.upcoming.count,
        days: input.upcoming.days,
      },
    );
  }

  const period = { from: input.from, to: input.to };
  if (input.previousExpenses.greaterThan(0) && input.expenses.greaterThan(0)) {
    const change = input.expenses
      .minus(input.previousExpenses)
      .dividedBy(input.previousExpenses)
      .times(HUNDRED);
    if (change.abs().greaterThanOrEqualTo(MIN_CHANGE_PERCENT)) {
      const up = change.greaterThan(0);
      add('expenses_change', up ? 'attention' : 'positive', period, {
        direction: up ? 'up' : 'down',
        change: change.abs().toFixed(1),
        current: money(input.expenses),
        previous: money(input.previousExpenses),
        previousFrom: input.previousFrom,
        previousTo: input.previousTo,
      });
    }
  }

  if (input.incomes.greaterThan(0) && input.expenses.greaterThan(0)) {
    const ratio = input.expenses.dividedBy(input.incomes).times(HUNDRED);
    add(
      'expense_ratio',
      ratio.greaterThan(100)
        ? 'attention'
        : ratio.greaterThan(80)
          ? 'neutral'
          : 'positive',
      period,
      {
        ratio: ratio.toFixed(0),
        expenses: money(input.expenses),
        incomes: money(input.incomes),
      },
    );
  }

  if (input.expenses.greaterThan(0)) {
    const previous = new Map(
      input.previousCategories.map((item) => [item.key, item.amount]),
    );
    let best: { name: string; change: Decimal; amount: Decimal; before: Decimal } | null =
      null;
    for (const category of input.categories) {
      const before = previous.get(category.key);
      if (!category.name || !before || before.lessThanOrEqualTo(0)) continue;
      const share = category.amount.dividedBy(input.expenses).times(HUNDRED);
      const change = category.amount.minus(before).dividedBy(before).times(HUNDRED);
      if (
        share.greaterThanOrEqualTo(MIN_CATEGORY_SHARE_PERCENT) &&
        change.greaterThanOrEqualTo(MIN_CATEGORY_CHANGE_PERCENT) &&
        (!best || change.greaterThan(best.change))
      ) {
        best = { name: category.name, change, amount: category.amount, before };
      }
    }
    if (best) {
      add('category_change', 'attention', period, {
        category: best.name,
        change: best.change.toFixed(1),
        current: money(best.amount),
        previous: money(best.before),
      });
    }
    const top = input.categories[0];
    if (top?.name) {
      add('top_category', 'neutral', period, {
        category: top.name,
        share: percent(top.amount, input.expenses, 1),
        amount: money(top.amount),
      });
    }
  }

  if (input.savings.incomes.greaterThan(0)) {
    const saved = input.savings.incomes.minus(input.savings.expenses);
    add(
      'savings_rate',
      saved.greaterThan(0) ? 'positive' : 'attention',
      { from: input.savings.from, to: input.savings.to },
      {
        rate: percent(saved, input.savings.incomes, 1),
        saved: money(saved),
        months: 3,
      },
    );
  }
  return insights;
}
