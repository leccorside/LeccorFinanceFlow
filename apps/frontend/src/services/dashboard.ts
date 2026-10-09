import type { TransactionSummary } from './dashboard.types';
import { api } from './api';

export type PeriodKey = 'today' | 'week' | 'month' | '3m' | '6m' | 'year' | 'custom';
export const PERIOD_KEYS: PeriodKey[] = [
  'today',
  'week',
  'month',
  '3m',
  '6m',
  'year',
  'custom',
];

export type InsightKind =
  | 'overdue_bills'
  | 'upcoming_bills'
  | 'expenses_change'
  | 'expense_ratio'
  | 'category_change'
  | 'top_category'
  | 'savings_rate';

export interface Insight {
  id: string;
  kind: InsightKind;
  tone: 'positive' | 'neutral' | 'attention';
  currency: string;
  from: string;
  to: string;
  values: Record<string, string | number>;
}

interface Amounts {
  incomes: string;
  expenses: string;
  investments: string;
  result: string;
}

export interface CurrencyDashboard {
  currency: string;
  cards: Amounts & {
    pendingIncomes: string;
    pendingExpenses: string;
    savings: string;
    savingsRate: string | null;
    accountsBalance: string;
    invested: string;
    netWorth: string;
    upcomingBills: { amount: string; count: number };
    overdueBills: { amount: string; count: number };
  };
  previous: Amounts;
  cashFlow: {
    period: string;
    incomes: string;
    expenses: string;
    investments: string;
    net: string;
  }[];
  netWorth: { period: string; value: string }[];
  categories: {
    categoryId: string | null;
    name: string | null;
    amount: string;
    share: string;
  }[];
  investments: {
    invested: string;
    byClass: { assetClass: string; invested: string; share: string }[];
  };
}

export interface Dashboard {
  period: {
    key: PeriodKey;
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
    groupBy: 'day' | 'month';
    today: string;
    timeZone: string;
    weekStartsOn: 'monday' | 'sunday';
  };
  primaryCurrency: string;
  currencies: CurrencyDashboard[];
  bills: {
    upcoming: TransactionSummary[];
    overdue: TransactionSummary[];
    upcomingTo: string;
  };
  insights: Insight[];
}

export interface DashboardQuery {
  period: PeriodKey;
  from?: string;
  to?: string;
}

export async function getDashboard(query: DashboardQuery): Promise<Dashboard> {
  const params: Record<string, string> = { period: query.period };
  if (query.period === 'custom' && query.from && query.to) {
    params.from = query.from;
    params.to = query.to;
  }
  return (await api.get<Dashboard>('/dashboard', { params })).data;
}
