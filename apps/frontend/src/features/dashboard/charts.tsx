import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useI18n } from '../../i18n/context';
import type { CurrencyDashboard } from '../../services/dashboard';
import { usePrefersReducedMotion } from '../assistant/motion';
import { useChartColors } from './chart-colors';
import { ChartCard } from './ChartCard';
import {
  assetClassLabel,
  bucketLabel,
  compactMoney,
  formatPercent,
} from './dashboard-format';

const HEIGHT = 260;

/**
 * Recharts' keyboard layer is turned off: the visual chart is hidden from assistive
 * technology (aria-hidden) and the data is available as a table instead, so nothing
 * focusable may live inside it.
 */
const CHART_A11Y = { accessibilityLayer: false } as const;

function useChartBasics(block: CurrencyDashboard) {
  const i18n = useI18n();
  const colors = useChartColors();
  const reduced = usePrefersReducedMotion();
  const money = (value: string | number) => i18n.money(String(value), block.currency);
  const axisMoney = (value: number) => compactMoney(value, block.currency, i18n.locale);
  const tooltipStyle = {
    contentStyle: {
      background: 'var(--surface-strong)',
      border: '1px solid var(--border-strong)',
      borderRadius: 12,
      color: 'var(--text)',
    },
    labelStyle: { color: 'var(--text-soft)' },
  };
  return { ...i18n, colors, animate: !reduced, money, axisMoney, tooltipStyle };
}

export function CashFlowChart({
  block,
  groupBy,
}: {
  block: CurrencyDashboard;
  groupBy: 'day' | 'month';
}) {
  const { t, locale, colors, animate, money, axisMoney, tooltipStyle } =
    useChartBasics(block);
  const data = block.cashFlow.map((point) => ({
    label: bucketLabel(point.period, locale),
    incomes: Number(point.incomes),
    expenses: Number(point.expenses),
    net: Number(point.net),
  }));
  const empty = block.cashFlow.every(
    (point) => Number(point.incomes) === 0 && Number(point.expenses) === 0,
  );
  return (
    <ChartCard
      className="chart-card--wide"
      title={t('dashboard.chart.cashFlow')}
      summary={t('dashboard.chart.cashFlowSummary', {
        incomes: money(block.cards.incomes),
        expenses: money(block.cards.expenses),
        unit: t(groupBy === 'day' ? 'dashboard.unit.day' : 'dashboard.unit.month'),
      })}
      empty={empty}
      table={{
        headers: [
          t('dashboard.series.period'),
          t('dashboard.series.incomes'),
          t('dashboard.series.expenses'),
          t('dashboard.series.net'),
        ],
        rows: block.cashFlow.map((point) => [
          bucketLabel(point.period, locale, true),
          money(point.incomes),
          money(point.expenses),
          money(point.net),
        ]),
      }}
    >
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          {...CHART_A11Y}
        >
          <CartesianGrid stroke={colors.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: colors.text, fontSize: 11 }}
            minTickGap={12}
          />
          <YAxis
            tick={{ fill: colors.text, fontSize: 11 }}
            tickFormatter={axisMoney}
            width={72}
          />
          <Tooltip formatter={(value) => money(Number(value))} {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="incomes"
            name={t('dashboard.series.incomes')}
            fill={colors.incomes}
            radius={[4, 4, 0, 0]}
            isAnimationActive={animate}
          />
          <Bar
            dataKey="expenses"
            name={t('dashboard.series.expenses')}
            fill={colors.expenses}
            radius={[4, 4, 0, 0]}
            isAnimationActive={animate}
          />
          <Line
            dataKey="net"
            name={t('dashboard.series.net')}
            stroke={colors.net}
            strokeWidth={2}
            dot={false}
            type="monotone"
            isAnimationActive={animate}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function NetWorthChart({ block }: { block: CurrencyDashboard }) {
  const { t, locale, colors, animate, money, axisMoney, tooltipStyle } =
    useChartBasics(block);
  const data = block.netWorth.map((point) => ({
    label: bucketLabel(point.period, locale),
    value: Number(point.value),
  }));
  const first = block.netWorth[0]?.value ?? '0';
  const last = block.netWorth.at(-1)?.value ?? '0';
  const gradientId = `worth-${block.currency}`;
  return (
    <ChartCard
      title={t('dashboard.chart.netWorth')}
      summary={t('dashboard.chart.netWorthSummary', {
        first: money(first),
        last: money(last),
      })}
      empty={block.netWorth.every((point) => Number(point.value) === 0)}
      table={{
        headers: [t('dashboard.series.period'), t('dashboard.series.netWorth')],
        rows: block.netWorth.map((point) => [
          bucketLabel(point.period, locale, true),
          money(point.value),
        ]),
      }}
    >
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <AreaChart
          data={data}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          {...CHART_A11Y}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.worth} stopOpacity={0.55} />
              <stop offset="100%" stopColor={colors.worth} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={colors.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: colors.text, fontSize: 11 }}
            minTickGap={12}
          />
          <YAxis
            tick={{ fill: colors.text, fontSize: 11 }}
            tickFormatter={axisMoney}
            width={72}
            domain={['auto', 'auto']}
          />
          <Tooltip formatter={(value) => money(Number(value))} {...tooltipStyle} />
          <Area
            dataKey="value"
            name={t('dashboard.series.netWorth')}
            type="monotone"
            stroke={colors.worth}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive={animate}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function CategoriesChart({ block }: { block: CurrencyDashboard }) {
  const { t, locale, colors, animate, money, tooltipStyle } = useChartBasics(block);
  const items = block.categories.map((item, index) => ({
    name: item.name ?? t('dashboard.uncategorized'),
    value: Number(item.amount),
    amount: item.amount,
    share: item.share,
    color: colors.palette[index % colors.palette.length] as string,
  }));
  const top = items[0];
  return (
    <ChartCard
      title={t('dashboard.chart.categories')}
      summary={
        top
          ? t('dashboard.chart.categoriesSummary', {
              name: top.name,
              share: formatPercent(top.share, locale),
            })
          : ''
      }
      empty={items.length === 0}
      table={{
        headers: [
          t('dashboard.series.category'),
          t('dashboard.series.amount'),
          t('dashboard.series.share'),
        ],
        rows: items.map((item) => [
          item.name,
          money(item.amount),
          `${formatPercent(item.share, locale)}%`,
        ]),
      }}
    >
      <div className="donut-layout">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart {...CHART_A11Y}>
            <Pie
              data={items}
              dataKey="value"
              nameKey="name"
              innerRadius="58%"
              outerRadius="88%"
              paddingAngle={2}
              rootTabIndex={-1}
              stroke="none"
              isAnimationActive={animate}
            >
              {items.map((item) => (
                <Cell key={item.name} fill={item.color} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => money(Number(value))} {...tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <ul className="donut-legend">
          {items.slice(0, 6).map((item) => (
            <li key={item.name}>
              <span className="legend-dot" style={{ background: item.color }} />
              <span className="legend-name">{item.name}</span>
              <span className="legend-value">{formatPercent(item.share, locale)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}

export function InvestmentsChart({ block }: { block: CurrencyDashboard }) {
  const { t, locale, colors, animate, money, axisMoney, tooltipStyle } =
    useChartBasics(block);
  const data = block.investments.byClass.map((item) => ({
    name: assetClassLabel(t, item.assetClass),
    value: Number(item.invested),
    invested: item.invested,
    share: item.share,
  }));
  return (
    <ChartCard
      title={t('dashboard.chart.investments')}
      summary={t('dashboard.chart.investmentsSummary', {
        amount: money(block.investments.invested),
        count: data.length,
      })}
      empty={data.length === 0}
      table={{
        headers: [
          t('dashboard.series.class'),
          t('dashboard.series.amount'),
          t('dashboard.series.share'),
        ],
        rows: data.map((item) => [
          item.name,
          money(item.invested),
          `${formatPercent(item.share, locale)}%`,
        ]),
      }}
    >
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 44 + 40)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 12, left: 0, bottom: 0 }}
          {...CHART_A11Y}
        >
          <CartesianGrid stroke={colors.grid} horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: colors.text, fontSize: 11 }}
            tickFormatter={axisMoney}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: colors.text, fontSize: 11 }}
            width={110}
          />
          <Tooltip formatter={(value) => money(Number(value))} {...tooltipStyle} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} isAnimationActive={animate}>
            {data.map((item, index) => (
              <Cell
                key={item.name}
                fill={colors.palette[index % colors.palette.length] as string}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
