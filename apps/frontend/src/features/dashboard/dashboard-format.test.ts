import { translate } from '../../i18n/catalog';
import { formatMoney } from '../../i18n/format';
import type { Insight } from '../../services/dashboard';
import { bucketLabel, changeLabel, formatPercent, insightText } from './dashboard-format';

const i18n = (locale: 'pt-BR' | 'en-US' | 'es-ES') => ({
  locale,
  t: (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(locale, key, params),
  money: (amount: string | number, currency?: string) =>
    formatMoney(amount, currency ?? 'BRL', locale),
});
const plain = (text: string) => text.replace(/\u00a0/g, ' ');

const insight = (kind: Insight['kind'], values: Insight['values']): Insight => ({
  id: kind,
  kind,
  tone: 'neutral',
  currency: 'BRL',
  from: '2026-10-01',
  to: '2026-10-31',
  values,
});

describe('dashboard formatting', () => {
  it('formats percents and changes in the user language', () => {
    expect(formatPercent('32.0', 'pt-BR')).toBe('32');
    expect(formatPercent('28.17', 'pt-BR', 2)).toBe('28,17');
    expect(formatPercent('14.5', 'en-US')).toBe('14.5');
    expect(changeLabel('5000.00', '4000.00', 'pt-BR')).toBe('+25%');
    expect(changeLabel('3000', '4000', 'pt-BR')).toBe('-25%');
    expect(changeLabel('10', '0', 'pt-BR')).toBeNull();
  });

  it('labels days and months without time zone shifts', () => {
    expect(bucketLabel('2026-10-01', 'pt-BR')).toBe('01/10');
    expect(bucketLabel('2026-10', 'pt-BR')).toBe('out. de 26');
    expect(bucketLabel('2026-10', 'en-US', true)).toBe('Oct 2026');
  });

  it('writes every insight kind with the API values only', () => {
    const pt = i18n('pt-BR');
    expect(
      plain(
        insightText(
          pt,
          insight('upcoming_bills', { amount: '1480.00', count: 3, days: 7 }),
        ),
      ),
    ).toBe(
      'Você possui R$ 1.480,00 em contas vencendo nos próximos 7 dias (3 lançamento(s)).',
    );
    expect(plain(insightText(pt, insight('expense_ratio', { ratio: '71' })))).toBe(
      'Suas despesas representam 71% da sua receita neste período.',
    );
    expect(
      plain(
        insightText(
          pt,
          insight('expenses_change', {
            direction: 'down',
            change: '12.5',
            previous: '400.00',
            current: '350.00',
          }),
        ),
      ),
    ).toBe(
      'Suas despesas caíram 12,5% em relação ao período anterior (R$ 400,00 → R$ 350,00).',
    );
    expect(
      plain(
        insightText(
          pt,
          insight('category_change', { category: 'Delivery', change: '32.0' }),
        ),
      ),
    ).toBe('Seus gastos com Delivery aumentaram 32% em relação ao período anterior.');
    expect(
      plain(
        insightText(
          pt,
          insight('top_category', {
            category: 'Alimentação',
            share: '28.2',
            amount: '1000.00',
          }),
        ),
      ),
    ).toBe(
      'Alimentação foi sua maior categoria de despesa: 28,2% do total (R$ 1.000,00).',
    );
    expect(
      plain(
        insightText(
          pt,
          insight('savings_rate', { rate: '14.0', saved: '2100.00', months: 3 }),
        ),
      ),
    ).toBe('Você economizou 14% da sua renda nos últimos 3 meses (R$ 2.100,00).');
    expect(
      plain(
        insightText(
          pt,
          insight('savings_rate', { rate: '-20.0', saved: '-200.00', months: 3 }),
        ),
      ),
    ).toBe('Nos últimos 3 meses, suas despesas superaram a renda recebida em R$ 200,00.');
    expect(
      plain(insightText(i18n('es-ES'), insight('expense_ratio', { ratio: '71' }))),
    ).toBe('Tus gastos representan el 71% de tus ingresos en este período.');
  });
});
