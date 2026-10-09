import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { type FormEvent, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/context';
import {
  type CurrencyDashboard,
  type Dashboard,
  type DashboardQuery,
  getDashboard,
  PERIOD_KEYS,
  type PeriodKey,
} from '../../services/dashboard';
import type { TransactionSummary } from '../../services/dashboard.types';
import {
  CashFlowChart,
  CategoriesChart,
  InvestmentsChart,
  NetWorthChart,
} from './charts';
import { changeLabel, formatPercent, insightText } from './dashboard-format';

/** Longest custom period the API accepts (5 years). */
const MAX_DAYS = 1830;

function Card({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string | null;
  tone?: 'positive' | 'attention' | null;
}) {
  return (
    <div className={tone ? `stat-card stat-card--${tone}` : 'stat-card'}>
      <dt>{label}</dt>
      <dd>
        <span className="stat-value">{value}</span>
        {detail && <span className="stat-detail">{detail}</span>}
      </dd>
    </div>
  );
}

function Cards({ block }: { block: CurrencyDashboard }) {
  const { t, money, locale } = useI18n();
  const m = (value: string) => money(value, block.currency);
  const { cards, previous } = block;
  const vs = (current: string, before: string) => {
    const change = changeLabel(current, before, locale);
    return change ? t('dashboard.card.vsPrevious', { change }) : null;
  };
  const pending = (amount: string) =>
    Number(amount) > 0 ? t('dashboard.card.pending', { amount: m(amount) }) : null;
  return (
    <dl className="stat-grid">
      <Card
        label={t('dashboard.card.netWorth')}
        value={m(cards.netWorth)}
        detail={t('dashboard.card.netWorthHint')}
      />
      <Card
        label={t('dashboard.card.accountsBalance')}
        value={m(cards.accountsBalance)}
        detail={t('dashboard.card.accountsHint')}
      />
      <Card
        label={t('dashboard.card.incomes')}
        value={m(cards.incomes)}
        detail={pending(cards.pendingIncomes) ?? vs(cards.incomes, previous.incomes)}
      />
      <Card
        label={t('dashboard.card.expenses')}
        value={m(cards.expenses)}
        detail={pending(cards.pendingExpenses) ?? vs(cards.expenses, previous.expenses)}
      />
      <Card
        label={t('dashboard.card.savings')}
        value={m(cards.savings)}
        tone={
          Number(cards.savings) < 0
            ? 'attention'
            : Number(cards.savings) > 0
              ? 'positive'
              : null
        }
        detail={
          cards.savingsRate === null
            ? t('dashboard.card.savingsNoIncome')
            : t('dashboard.card.savingsRate', {
                rate: formatPercent(cards.savingsRate, locale),
              })
        }
      />
      <Card
        label={t('dashboard.card.investments')}
        value={m(cards.investments)}
        detail={t('dashboard.card.investedTotal', { amount: m(cards.invested) })}
      />
      <Card
        label={t('dashboard.card.upcoming')}
        value={m(cards.upcomingBills.amount)}
        detail={t('dashboard.card.count', { count: cards.upcomingBills.count })}
      />
      <Card
        label={t('dashboard.card.overdue')}
        value={m(cards.overdueBills.amount)}
        tone={cards.overdueBills.count > 0 ? 'attention' : null}
        detail={t('dashboard.card.count', { count: cards.overdueBills.count })}
      />
    </dl>
  );
}

function Insights({ data, currency }: { data: Dashboard; currency: string }) {
  const i18n = useI18n();
  const { t, calendarDate } = i18n;
  const titleId = useId();
  const items = data.insights.filter((item) => item.currency === currency);
  return (
    <section className="insights" aria-labelledby={titleId}>
      <h2 id={titleId}>
        <span className="insights-spark" aria-hidden="true" />
        {t('dashboard.insights')}
      </h2>
      {items.length === 0 ? (
        <p className="hint">{t('dashboard.insights.empty')}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id} className={`insight insight--${item.tone}`}>
              <p>{insightText(i18n, item)}</p>
              <small>
                {t('insight.period', {
                  from: calendarDate(item.from),
                  to: calendarDate(item.to),
                })}
              </small>
            </li>
          ))}
        </ul>
      )}
      <p className="insights-disclaimer">{t('dashboard.insights.disclaimer')}</p>
    </section>
  );
}

function Bills({
  title,
  items,
  overdue,
}: {
  title: string;
  items: TransactionSummary[];
  overdue: boolean;
}) {
  const { t, money, calendarDate } = useI18n();
  const titleId = useId();
  return (
    <section className="bills" aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      {items.length === 0 ? (
        <p className="hint">{t('dashboard.bills.none')}</p>
      ) : (
        <ul>
          {items.map((bill) => (
            <li key={bill.id}>
              <span className="bill-name">{bill.description}</span>
              <span className={overdue ? 'bill-date bill-date--overdue' : 'bill-date'}>
                {t(overdue ? 'dashboard.bills.overdueOn' : 'dashboard.bills.due', {
                  date: calendarDate(bill.dueOn ?? bill.occurredOn),
                })}
              </span>
              <span className="bill-amount">{money(bill.amount, bill.currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function daysBetween(from: string, to: string): number {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1
  );
}

/**
 * The visual side of the same data the assistant works with: no forms, only a period
 * filter. Amounts per currency are never mixed; numbers come straight from the API.
 */
export function DashboardPage() {
  const { t, calendarDate } = useI18n();
  /** The button pressed; "custom" only becomes the query once its dates are applied. */
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>('month');
  const [query, setQuery] = useState<DashboardQuery>({ period: 'month' });
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [customError, setCustomError] = useState(false);
  const [currency, setCurrency] = useState<string | null>(null);
  const fromId = useId();
  const toId = useId();
  const currencyId = useId();

  const dashboard = useQuery({
    queryKey: ['dashboard', query],
    queryFn: () => getDashboard(query),
    placeholderData: keepPreviousData,
  });
  const data = dashboard.data;
  const selected =
    data?.currencies.find(
      (block) => block.currency === (currency ?? data.primaryCurrency),
    ) ?? data?.currencies[0];

  const choose = (period: PeriodKey) => {
    setCustomError(false);
    setSelectedPeriod(period);
    if (period !== 'custom') setQuery({ period });
  };

  const applyCustom = (event: FormEvent) => {
    event.preventDefault();
    const valid =
      custom.from !== '' &&
      custom.to !== '' &&
      custom.from <= custom.to &&
      daysBetween(custom.from, custom.to) <= MAX_DAYS;
    setCustomError(!valid);
    if (valid) setQuery({ period: 'custom', from: custom.from, to: custom.to });
  };

  const showingCustom = selectedPeriod === 'custom';

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>{t('dashboard.title')}</h1>
          <p className="hint">{t('dashboard.subtitle')}</p>
        </div>
        {data && (
          <p className="dashboard-range" aria-live="polite">
            {t('dashboard.range', {
              from: calendarDate(data.period.from),
              to: calendarDate(data.period.to),
            })}
          </p>
        )}
      </header>

      <div className="dashboard-filters">
        <div className="segmented" role="group" aria-label={t('dashboard.period')}>
          {PERIOD_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={selectedPeriod === key}
              onClick={() => choose(key)}
            >
              {t(`dashboard.period.${key}`)}
            </button>
          ))}
        </div>
        {data && data.currencies.length > 1 && (
          <div className="field field--inline">
            <label htmlFor={currencyId}>{t('dashboard.currency')}</label>
            <select
              id={currencyId}
              value={selected?.currency ?? ''}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {data.currencies.map((block) => (
                <option key={block.currency} value={block.currency}>
                  {block.currency}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {showingCustom && (
        <form className="custom-period" onSubmit={applyCustom} noValidate>
          <div className="field">
            <label htmlFor={fromId}>{t('dashboard.custom.from')}</label>
            <input
              id={fromId}
              type="date"
              value={custom.from}
              onChange={(event) =>
                setCustom((value) => ({ ...value, from: event.target.value }))
              }
              aria-invalid={customError}
            />
          </div>
          <div className="field">
            <label htmlFor={toId}>{t('dashboard.custom.to')}</label>
            <input
              id={toId}
              type="date"
              value={custom.to}
              onChange={(event) =>
                setCustom((value) => ({ ...value, to: event.target.value }))
              }
              aria-invalid={customError}
            />
          </div>
          <button type="submit" className="button-secondary">
            {t('dashboard.custom.apply')}
          </button>
          {customError && (
            <p className="form-status form-status--error" role="alert">
              {t('dashboard.custom.invalid')}
            </p>
          )}
        </form>
      )}

      {dashboard.isPending && (
        <div
          className="dashboard-skeleton"
          role="status"
          aria-label={t('dashboard.loading')}
        >
          {Array.from({ length: 8 }, (_, index) => (
            <span key={index} className="skeleton" aria-hidden="true" />
          ))}
        </div>
      )}

      {dashboard.isError && (
        <div className="alert" role="alert">
          <p>{t('dashboard.error')}</p>
          <button
            type="button"
            className="button-secondary"
            onClick={() => void dashboard.refetch()}
          >
            {t('dashboard.retry')}
          </button>
        </div>
      )}

      {data && !selected && (
        <section className="dashboard-empty">
          <h2>{t('dashboard.empty.title')}</h2>
          <p>{t('dashboard.empty.body')}</p>
          <Link to="/" className="button-primary">
            {t('dashboard.empty.cta')}
          </Link>
        </section>
      )}

      {data && selected && (
        <motion.div
          className={
            dashboard.isPlaceholderData
              ? 'dashboard-body is-refreshing'
              : 'dashboard-body'
          }
          aria-busy={dashboard.isFetching}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Cards block={selected} />
          <Insights data={data} currency={selected.currency} />
          <div className="chart-grid">
            <CashFlowChart block={selected} groupBy={data.period.groupBy} />
            <NetWorthChart block={selected} />
            <CategoriesChart block={selected} />
            <InvestmentsChart block={selected} />
          </div>
          <div className="bills-grid">
            <Bills
              title={t('dashboard.bills.upcoming')}
              items={data.bills.upcoming.filter(
                (bill) => bill.currency === selected.currency,
              )}
              overdue={false}
            />
            <Bills
              title={t('dashboard.bills.overdue')}
              items={data.bills.overdue.filter(
                (bill) => bill.currency === selected.currency,
              )}
              overdue
            />
          </div>
        </motion.div>
      )}
    </div>
  );
}
