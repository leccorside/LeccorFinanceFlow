import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import { afterEach, beforeEach, vi } from 'vitest';
import { createReport, listReports, type Report } from '../../services/reports';
import { renderWithProviders } from '../../test/render';
import { monthRange, presetRange, todayIn } from './report-periods';
import { ReportsPage } from './ReportsPage';

vi.mock('../../services/reports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/reports')>()),
  createReport: vi.fn(),
  listReports: vi.fn(),
}));

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: 'r1',
    type: 'MONTHLY',
    format: 'PDF',
    from: '2026-09-01',
    to: '2026-09-30',
    status: 'READY',
    fileName: 'relatorio-mensal_2026-09-01_2026-09-30.pdf',
    expiresAt: '2026-10-09T15:30:00.000Z',
    createdAt: '2026-10-09T15:00:00.000Z',
    downloadUrl: '/api/v1/reports/r1/download',
    ...overrides,
  };
}

const today = todayIn('America/Sao_Paulo');

describe('report periods', () => {
  it('computes presets and months on the calendar', () => {
    expect(presetRange('thisMonth', '2024-02-15')).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    });
    expect(presetRange('lastMonth', '2026-01-10')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(presetRange('last3', '2026-01-10')).toEqual({
      from: '2025-11-01',
      to: '2026-01-31',
    });
    expect(presetRange('thisYear', '2026-10-09')).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(todayIn('Pacific/Kiritimati', new Date('2026-10-09T23:00:00Z'))).toBe(
      '2026-10-10',
    );
  });
});

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.mocked(listReports).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('offers the nine reports as accessible choices and generates the monthly PDF', async () => {
    vi.mocked(createReport).mockResolvedValue(report());
    renderWithProviders(<ReportsPage />);

    const types = screen.getByRole('group', { name: 'Tipo de relatório' });
    expect(within(types).getAllByRole('radio')).toHaveLength(9);
    expect(within(types).getByRole('radio', { name: /Mensal/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /PDF/ })).toBeChecked();
    expect(screen.getByLabelText('Mês')).toHaveValue(today.slice(0, 7));
    expect(await screen.findByText('Nenhum relatório gerado ainda.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2026-09' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }));

    await waitFor(() =>
      expect(createReport).toHaveBeenCalledWith({
        type: 'MONTHLY',
        format: 'PDF',
        month: '2026-09',
      }),
    );
    const link = await screen.findByRole('link', {
      name: 'Baixar relatorio-mensal_2026-09-01_2026-09-30.pdf',
    });
    expect(link).toHaveAttribute('href', '/api/v1/reports/r1/download');
    expect(screen.getByText(/fica disponível por pouco tempo/)).toBeInTheDocument();
    // The history is refreshed after a new report.
    await waitFor(() => expect(listReports).toHaveBeenCalledTimes(2));
  });

  it('uses a year for the annual report and presets or dates for the others', async () => {
    vi.mocked(createReport).mockResolvedValue(
      report({ type: 'EXPENSES', format: 'XLSX' }),
    );
    renderWithProviders(<ReportsPage />);

    fireEvent.click(screen.getByRole('radio', { name: /Anual/ }));
    fireEvent.click(screen.getByRole('radio', { name: /XLSX/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }));
    await waitFor(() =>
      expect(createReport).toHaveBeenLastCalledWith({
        type: 'ANNUAL',
        format: 'XLSX',
        year: Number(today.slice(0, 4)),
      }),
    );

    fireEvent.click(screen.getByRole('radio', { name: /^Despesas/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mês passado' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }));
    await waitFor(() =>
      expect(createReport).toHaveBeenLastCalledWith({
        type: 'EXPENSES',
        format: 'XLSX',
        ...presetRange('lastMonth', today),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Outro período' }));
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-05-10' } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-05-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um período válido.');
    expect(createReport).toHaveBeenCalledTimes(2);
  });

  it('explains a refused report', async () => {
    vi.mocked(createReport).mockRejectedValue(
      new AxiosError('failed', '422', undefined, undefined, {
        status: 422,
        data: {
          code: 'report_too_large',
          message: 'x',
          details: null,
          requestId: 'r',
          timestamp: 't',
        },
      } as AxiosResponse),
    );
    renderWithProviders(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar relatório' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Esse período tem lançamentos demais para um relatório.',
    );
  });

  it('lists recent reports with download for available ones only', async () => {
    vi.mocked(listReports).mockResolvedValue([
      report(),
      report({ id: 'r2', type: 'ANNUAL', status: 'EXPIRED', downloadUrl: null }),
    ]);
    renderWithProviders(<ReportsPage />);
    const history = await screen.findByRole('region', { name: 'Relatórios recentes' });
    const items = await within(history).findAllByRole('listitem');
    expect(
      within(items[0] as HTMLElement).getByRole('link', { name: 'Baixar' }),
    ).toHaveAttribute('href', '/api/v1/reports/r1/download');
    expect(within(items[1] as HTMLElement).queryByRole('link')).toBeNull();
    expect(within(items[1] as HTMLElement).getByText('Expirado')).toBeInTheDocument();
  });
});
