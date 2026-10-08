import { fireEvent, screen, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import { vi } from 'vitest';
import { getGoogleConnection, type GoogleConnection } from '../../services/google';
import {
  createSpreadsheet,
  listSpreadsheets,
  type Spreadsheet,
} from '../../services/spreadsheets';
import { renderWithProviders } from '../../test/render';
import { SpreadsheetsCard } from './SpreadsheetsCard';

vi.mock('../../services/google', () => ({ getGoogleConnection: vi.fn() }));
vi.mock('../../services/spreadsheets', () => ({
  listSpreadsheets: vi.fn(),
  createSpreadsheet: vi.fn(),
}));

const DRIVE = 'https://www.googleapis.com/auth/drive.file';
const connection = (status: GoogleConnection['status']): GoogleConnection => ({
  status,
  googleEmail: status === 'ACTIVE' ? 'ana@example.com' : null,
  grantedScopes: status === 'ACTIVE' ? [DRIVE] : [],
  requiredScopes: [DRIVE],
  missingScopes: status === 'ACTIVE' ? [] : [DRIVE],
  connectedAt: null,
  lastRefreshedAt: null,
});

const sheet = (overrides: Partial<Spreadsheet>): Spreadsheet => ({
  id: 's1',
  name: 'Controle Financeiro — Ana',
  status: 'ACTIVE',
  isActive: true,
  locale: 'pt-BR',
  googleSpreadsheetId: 'file-1',
  url: 'https://docs.google.com/spreadsheets/d/file-1/edit',
  lastErrorCode: null,
  createdAt: '2026-10-08T12:00:00.000Z',
  updatedAt: '2026-10-08T12:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  vi.mocked(getGoogleConnection).mockReset();
  vi.mocked(listSpreadsheets).mockReset();
  vi.mocked(createSpreadsheet).mockReset();
});

describe('SpreadsheetsCard', () => {
  it('blocks creation until Google is connected and explains why', async () => {
    vi.mocked(getGoogleConnection).mockResolvedValue(connection('NOT_CONNECTED'));
    vi.mocked(listSpreadsheets).mockResolvedValue([]);
    renderWithProviders(<SpreadsheetsCard />);

    const button = await screen.findByRole('button', {
      name: 'Criar minha planilha financeira',
    });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAccessibleDescription(/Conecte sua conta Google/);
  });

  it('creates the spreadsheet and shows it ready with a link that opens in a new tab', async () => {
    vi.mocked(getGoogleConnection).mockResolvedValue(connection('ACTIVE'));
    vi.mocked(listSpreadsheets)
      .mockResolvedValueOnce([])
      .mockResolvedValue([sheet({})]);
    vi.mocked(createSpreadsheet).mockResolvedValue(sheet({}));
    renderWithProviders(<SpreadsheetsCard />);

    const button = await screen.findByRole('button', {
      name: 'Criar minha planilha financeira',
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(
      await screen.findByText('Planilha pronta no seu Google Drive.'),
    ).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: 'Abrir no Google Sheets' });
    expect(link).toHaveAttribute(
      'href',
      'https://docs.google.com/spreadsheets/d/file-1/edit',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/Pronta · em uso/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Criar minha planilha financeira' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['google_reauth_required', 'Reconecte sua conta Google e tente de novo.'],
    ['google_unavailable', 'O Google não respondeu.'],
    ['something_else', 'Não foi possível criar a planilha.'],
  ])('explains the %s failure', async (code, text) => {
    vi.mocked(getGoogleConnection).mockResolvedValue(connection('ACTIVE'));
    vi.mocked(listSpreadsheets).mockResolvedValue([]);
    const response = {
      status: 409,
      data: { code, message: 'x', details: null },
    } as AxiosResponse;
    vi.mocked(createSpreadsheet).mockRejectedValue(
      new AxiosError('fail', '409', undefined, null, response),
    );
    renderWithProviders(<SpreadsheetsCard />);

    const button = await screen.findByRole('button', {
      name: 'Criar minha planilha financeira',
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('shows an unfinished spreadsheet with its reason and offers to retry', async () => {
    vi.mocked(getGoogleConnection).mockResolvedValue(connection('ACTIVE'));
    vi.mocked(listSpreadsheets).mockResolvedValue([
      sheet({
        status: 'ERROR',
        isActive: false,
        url: null,
        lastErrorCode: 'google_unavailable',
      }),
    ]);
    renderWithProviders(<SpreadsheetsCard />, { regional: { locale: 'en-US' } });

    expect(await screen.findByText('Not completed')).toBeInTheDocument();
    expect(screen.getByText(/Google did not respond/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create my financial spreadsheet' }),
    ).toBeInTheDocument();
  });

  it('renders in Spanish', async () => {
    vi.mocked(getGoogleConnection).mockResolvedValue(connection('ACTIVE'));
    vi.mocked(listSpreadsheets).mockResolvedValue([]);
    renderWithProviders(<SpreadsheetsCard />, { regional: { locale: 'es-ES' } });

    expect(
      await screen.findByRole('heading', { name: 'Hoja de cálculo financiera' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Todavía no tienes una hoja de cálculo.'),
    ).toBeInTheDocument();
  });
});
