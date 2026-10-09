import { isMessageKey, type Locale } from '../../i18n/catalog';
import type { I18nValue } from '../../i18n/context';
import type { Insight } from '../../services/dashboard';

/** "32.0" → "32,0" (pt-BR). Values arrive as exact decimal text from the API. */
export function formatPercent(
  value: string | number,
  locale: Locale,
  digits = 1,
): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(Number(value));
}

/** Change between two amounts as "+12,5%" / "−3%"; null when there is no base. */
export function changeLabel(
  current: string,
  previous: string,
  locale: Locale,
): string | null {
  const before = Number(previous);
  if (!Number.isFinite(before) || before === 0) return null;
  const change = ((Number(current) - before) / before) * 100;
  return (
    new Intl.NumberFormat(locale, {
      signDisplay: 'exceptZero',
      maximumFractionDigits: 1,
    }).format(change) + '%'
  );
}

/** Axis/table label of a bucket: "09/10" for days, "out. 2026" for months. */
export function bucketLabel(bucket: string, locale: Locale, long = false): string {
  if (bucket.length === 7) {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      year: long ? 'numeric' : '2-digit',
      timeZone: 'UTC',
    }).format(new Date(`${bucket}-01T00:00:00Z`));
  }
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: long ? 'long' : '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${bucket}T00:00:00Z`));
}

/** Compact money for chart axes ("R$ 12 mil"). */
export function compactMoney(value: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function assetClassLabel(t: I18nValue['t'], assetClass: string): string {
  const key = `assetClass.${assetClass}`;
  return isMessageKey(key) ? t(key) : assetClass;
}

/**
 * The sentence of an insight, in the user's language. Every number comes from `values`
 * (computed by the API from the user's records); nothing here invents or rounds amounts.
 */
export function insightText(
  i18n: Pick<I18nValue, 't' | 'money' | 'locale'>,
  insight: Insight,
): string {
  const { t, money, locale } = i18n;
  const v = insight.values;
  const amount = (key: string) => money(String(v[key] ?? '0'), insight.currency);
  const pct = (key: string) => formatPercent(String(v[key] ?? '0'), locale);
  switch (insight.kind) {
    case 'overdue_bills':
      return t('insight.overdue_bills', {
        count: Number(v.count),
        amount: amount('amount'),
      });
    case 'upcoming_bills':
      return t('insight.upcoming_bills', {
        amount: amount('amount'),
        days: Number(v.days),
        count: Number(v.count),
      });
    case 'expenses_change':
      return t(
        v.direction === 'up'
          ? 'insight.expenses_change.up'
          : 'insight.expenses_change.down',
        {
          change: pct('change'),
          previous: amount('previous'),
          current: amount('current'),
        },
      );
    case 'expense_ratio':
      return t('insight.expense_ratio', { ratio: pct('ratio') });
    case 'category_change':
      return t('insight.category_change', {
        category: String(v.category),
        change: pct('change'),
      });
    case 'top_category':
      return t('insight.top_category', {
        category: String(v.category),
        share: pct('share'),
        amount: amount('amount'),
      });
    case 'savings_rate': {
      const saved = String(v.saved ?? '0');
      return !saved.startsWith('-') && Number(saved) > 0
        ? t('insight.savings_rate.positive', {
            rate: pct('rate'),
            months: Number(v.months),
            saved: amount('saved'),
          })
        : t('insight.savings_rate.negative', {
            months: Number(v.months),
            // The amount by which expenses exceeded income, without the minus sign.
            saved: money(saved.replace(/^-/, ''), insight.currency),
          });
    }
  }
}
