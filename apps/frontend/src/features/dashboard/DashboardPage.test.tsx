import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { type Dashboard, getDashboard } from '../../services/dashboard';
import { renderWithProviders } from '../../test/render';
import { DashboardPage } from './DashboardPage';

vi.mock('../../services/dashboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/dashboard')>()),
  getDashboard: vi.fn(),
}));

/** Testing Library normalizes whitespace (Intl's no-break spaces included). */
const nbsp = (text: string) => text;

function block(
  currency: string,
  overrides: Partial<Dashboard['currencies'][number]> = {},
) {
  return {
    currency,
    cards: {
      incomes: '5000.00',
      expenses: '3550.00',
      investments: '500.00',
      result: '1450.00',
      pendingIncomes: '0.00',
      pendingExpenses: '120.00',
      savings: '-200.00',
      savingsRate: '-4.0',
      accountsBalance: '8200.00',
      invested: '2500.00',
      netWorth: '10700.00',
      upcomingBills: { amount: '120.00', count: 1 },
      overdueBills: { amount: '90.25', count: 1 },
    },
    previous: {
      incomes: '4000.00',
      expenses: '2689.39',
      investments: '0.00',
      result: '0',
    },
    cashFlow: [
      {
        period: '2026-10-01',
        incomes: '5000.00',
        expenses: '1250.50',
        investments: '0.00',
        net: '3749.50',
      },
      {
        period: '2026-10-02',
        incomes: '0.00',
        expenses: '0.00',
        investments: '500.00',
        net: '0.00',
      },
    ],
    netWorth: [
      { period: '2026-10-01', value: '9000.00' },
      { period: '2026-10-02', value: '10700.00' },
    ],
    categories: [
      { categoryId: 'c1', name: 'Alimentação', amount: '1000.00', share: '28.17' },
      { categoryId: null, name: null, amount: '250.50', share: '7.06' },
    ],
    investments: {
      invested: '2500.00',
      byClass: [{ assetClass: 'TREASURY', invested: '2500.00', share: '100.00' }],
    },
    ...overrides,
  };
}

function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    period: {
      key: 'month',
      from: '2026-10-01',
      to: '2026-10-31',
      previousFrom: '2026-09-01',
      previousTo: '2026-09-30',
      groupBy: 'day',
      today: '2026-10-09',
      timeZone: 'America/Sao_Paulo',
      weekStartsOn: 'monday',
    },
    primaryCurrency: 'BRL',
    currencies: [block('BRL')],
    bills: {
      upcoming: [
        {
          id: 'b1',
          description: 'Internet',
          amount: '120.00',
          currency: 'BRL',
          dueOn: '2026-10-12',
          occurredOn: '2026-10-12',
          isOverdue: false,
          category: null,
          account: null,
        },
      ],
      overdue: [
        {
          id: 'b2',
          description: 'Luz',
          amount: '90.25',
          currency: 'BRL',
          dueOn: '2026-10-08',
          occurredOn: '2026-10-08',
          isOverdue: true,
          category: null,
          account: null,
        },
      ],
      upcomingTo: '2026-10-15',
    },
    insights: [
      {
        id: 'overdue_bills:BRL',
        kind: 'overdue_bills',
        tone: 'attention',
        currency: 'BRL',
        from: '2026-10-09',
        to: '2026-10-09',
        values: { amount: '90.25', count: 1 },
      },
      {
        id: 'expenses_change:BRL',
        kind: 'expenses_change',
        tone: 'attention',
        currency: 'BRL',
        from: '2026-10-01',
        to: '2026-10-31',
        values: {
          direction: 'up',
          change: '32.0',
          current: '3550.00',
          previous: '2689.39',
        },
      },
    ],
    ...overrides,
  };
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.mocked(getDashboard).mockResolvedValue(dashboard());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the cards with exact amounts, comparisons and states', async () => {
    renderWithProviders(<DashboardPage />);

    expect(
      screen.getByRole('heading', { name: 'Painel financeiro' }),
    ).toBeInTheDocument();
    expect((await screen.findAllByText('R$ 10.700,00'))[0]).toBeInTheDocument();
    expect(getDashboard).toHaveBeenCalledWith({ period: 'month' });
    expect(
      screen.getByText('1 de out. de 2026 a 31 de out. de 2026'),
    ).toBeInTheDocument();

    const card = (label: string) =>
      screen.getByText(label, { selector: 'dt' }).closest('.stat-card') as HTMLElement;
    expect(within(card('Receitas')).getByText(nbsp('R$ 5.000,00'))).toBeInTheDocument();
    // Comparison with the previous period (no pending incomes to mention).
    expect(
      within(card('Receitas')).getByText('+25% vs. período anterior'),
    ).toBeInTheDocument();
    expect(
      within(card('Despesas')).getByText(nbsp('R$ 120,00 ainda pendente')),
    ).toBeInTheDocument();
    expect(card('Economia realizada')).toHaveClass('stat-card--attention');
    expect(
      within(card('Economia realizada')).getByText('-4% da renda recebida'),
    ).toBeInTheDocument();
    expect(card('Contas vencidas')).toHaveClass('stat-card--attention');
  });

  it('writes insights as sentences from the API numbers, with the disclaimer', async () => {
    renderWithProviders(<DashboardPage />);
    const insights = await screen.findByRole('region', { name: 'Insights financeiros' });

    expect(
      within(insights).getByText(
        nbsp('Você tem 1 conta(s) vencida(s), somando R$ 90,25.'),
      ),
    ).toBeInTheDocument();
    expect(
      within(insights).getByText(
        nbsp(
          'Suas despesas aumentaram 32% em relação ao período anterior (R$ 2.689,39 → R$ 3.550,00).',
        ),
      ),
    ).toBeInTheDocument();
    expect(
      within(insights).getByText(/Não são recomendação financeira/),
    ).toBeInTheDocument();
  });

  it('gives every chart a summary and its data as a table', async () => {
    renderWithProviders(<DashboardPage />);
    const cashFlow = await screen.findByRole('region', { name: 'Fluxo de caixa' });

    expect(
      within(cashFlow).getByText(
        nbsp('Receitas de R$ 5.000,00 e despesas de R$ 3.550,00 no período, por dia.'),
      ),
    ).toBeInTheDocument();
    const table = within(cashFlow).getByRole('table', { name: 'Fluxo de caixa' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(
      within(table).getByRole('rowheader', { name: '01 de outubro' }),
    ).toBeInTheDocument();
    expect(within(table).getByText(nbsp('R$ 3.749,50'))).toBeInTheDocument();
    // The drawing is hidden from assistive technology (the table replaces it).
    expect(cashFlow.querySelector('.chart-canvas')).toHaveAttribute(
      'aria-hidden',
      'true',
    );

    const categories = screen.getByRole('region', { name: 'Gastos por categoria' });
    expect(
      within(categories).getByText('Maior categoria: Alimentação, 28,2% das despesas.'),
    ).toBeInTheDocument();
    expect(within(categories).getAllByText('Sem categoria').length).toBeGreaterThan(0);
    const investments = screen.getByRole('region', { name: 'Investimentos por classe' });
    expect(within(investments).getAllByText('Tesouro Direto').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('region', { name: 'Evolução patrimonial' }),
    ).toHaveTextContent(
      nbsp('Patrimônio de R$ 9.000,00 no início para R$ 10.700,00 no fim do período.'),
    );
  });

  it('lists upcoming and overdue bills', async () => {
    renderWithProviders(<DashboardPage />);
    const upcoming = await screen.findByRole('region', {
      name: 'Próximas contas (7 dias)',
    });
    expect(within(upcoming).getByText('Internet')).toBeInTheDocument();
    expect(within(upcoming).getByText('vence 12 de out. de 2026')).toBeInTheDocument();
    const overdue = screen.getByRole('region', { name: 'Contas vencidas' });
    expect(within(overdue).getByText('venceu 8 de out. de 2026')).toHaveClass(
      'bill-date--overdue',
    );
  });

  it('switches periods from the keyboard-reachable selector', async () => {
    renderWithProviders(<DashboardPage />);
    const group = await screen.findByRole('group', { name: 'Período' });
    expect(within(group).getByRole('button', { name: 'Mês' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(within(group).getByRole('button', { name: '3 meses' }));

    await waitFor(() => expect(getDashboard).toHaveBeenCalledWith({ period: '3m' }));
    expect(within(group).getByRole('button', { name: '3 meses' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('applies a custom period only when it is valid', async () => {
    renderWithProviders(<DashboardPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Personalizado' }));
    expect(getDashboard).toHaveBeenCalledTimes(1); // no query without dates

    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-03-10' } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-03-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um período válido');
    expect(screen.getByLabelText('De')).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-03-19' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    await waitFor(() =>
      expect(getDashboard).toHaveBeenLastCalledWith({
        period: 'custom',
        from: '2026-03-10',
        to: '2026-03-19',
      }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps currencies apart and lets the user switch', async () => {
    vi.mocked(getDashboard).mockResolvedValue(
      dashboard({
        currencies: [
          block('BRL'),
          block('USD', {
            cards: { ...block('USD').cards, netWorth: '90.00' },
          }),
        ],
      }),
    );
    renderWithProviders(<DashboardPage />);
    const select = await screen.findByLabelText('Moeda');
    expect(select).toHaveValue('BRL');

    fireEvent.change(select, { target: { value: 'USD' } });

    expect(await screen.findByText(nbsp('US$ 90,00'))).toBeInTheDocument();
    // BRL insights and bills are not shown for USD.
    expect(screen.queryByText('Internet')).toBeNull();
    expect(
      screen.getByText('Nenhuma observação relevante neste período.'),
    ).toBeInTheDocument();
  });

  it('invites to the assistant when there is nothing yet', async () => {
    vi.mocked(getDashboard).mockResolvedValue(
      dashboard({
        currencies: [],
        insights: [],
        bills: { upcoming: [], overdue: [], upcomingTo: '' },
      }),
    );
    renderWithProviders(<DashboardPage />);
    expect(
      await screen.findByRole('heading', { name: 'Ainda não há números neste período.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para o assistente' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('reports a load failure and retries', async () => {
    vi.mocked(getDashboard)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(dashboard());
    renderWithProviders(<DashboardPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível carregar o painel.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }));
    expect((await screen.findAllByText('R$ 10.700,00'))[0]).toBeInTheDocument();
  });
});
