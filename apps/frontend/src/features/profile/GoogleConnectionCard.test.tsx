import { fireEvent, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import {
  disconnectGoogle,
  getGoogleConnection,
  type GoogleConnection,
} from '../../services/google';
import { renderWithProviders } from '../../test/render';
import { returnMessageKey } from './google-return';
import { GoogleConnectionCard } from './GoogleConnectionCard';

vi.mock('../../services/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/google')>()),
  getGoogleConnection: vi.fn(),
  disconnectGoogle: vi.fn(),
}));

const DRIVE = 'https://www.googleapis.com/auth/drive.file';
const connection = (overrides: Partial<GoogleConnection>): GoogleConnection => ({
  status: 'NOT_CONNECTED',
  googleEmail: null,
  grantedScopes: [],
  requiredScopes: [DRIVE],
  missingScopes: [DRIVE],
  connectedAt: null,
  lastRefreshedAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.mocked(getGoogleConnection).mockReset();
  vi.mocked(disconnectGoogle).mockReset();
});

describe('GoogleConnectionCard', () => {
  it('offers to connect when not connected, through the backend consent route', async () => {
    vi.mocked(getGoogleConnection).mockResolvedValue(connection({}));
    renderWithProviders(<GoogleConnectionCard returnMessage={null} />);

    expect(await screen.findByText('Não conectada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Conectar conta Google' })).toHaveAttribute(
      'href',
      '/api/v1/google/connect?redirectTo=%2Fprofile',
    );
  });

  it('asks to reconnect when Google revoked the authorization', async () => {
    vi.mocked(getGoogleConnection).mockResolvedValue(
      connection({ status: 'NEEDS_REAUTH' }),
    );
    renderWithProviders(<GoogleConnectionCard returnMessage={null} />);

    expect(await screen.findByText(/Reconexão necessária/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Reconectar conta Google' }),
    ).toBeInTheDocument();
  });

  it('disconnects only after an explicit confirmation that keeps spreadsheets', async () => {
    vi.mocked(getGoogleConnection).mockResolvedValue(
      connection({
        status: 'ACTIVE',
        googleEmail: 'ana@example.com',
        grantedScopes: [DRIVE],
        missingScopes: [],
        connectedAt: '2026-10-08T12:00:00.000Z',
      }),
    );
    vi.mocked(disconnectGoogle).mockResolvedValue({
      status: 'REVOKED',
      remoteRevocation: 'revoked',
    });
    renderWithProviders(<GoogleConnectionCard returnMessage={null} />);

    expect(await screen.findByText('ana@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
    expect(disconnectGoogle).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Suas planilhas continuam no seu Google Drive/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sim, desconectar' }));
    await waitFor(() => expect(disconnectGoogle).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Suas planilhas foram mantidas/)).toBeInTheDocument();
  });

  it('can cancel the disconnection', async () => {
    vi.mocked(getGoogleConnection).mockResolvedValue(
      connection({ status: 'ACTIVE', googleEmail: 'a@b.com', missingScopes: [] }),
    );
    renderWithProviders(<GoogleConnectionCard returnMessage={null} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Desconectar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(
      screen.queryByRole('button', { name: 'Sim, desconectar' }),
    ).not.toBeInTheDocument();
    expect(disconnectGoogle).not.toHaveBeenCalled();
  });

  it('explains when Google did not confirm the revocation', async () => {
    vi.mocked(getGoogleConnection).mockResolvedValue(
      connection({ status: 'ACTIVE', googleEmail: 'a@b.com', missingScopes: [] }),
    );
    vi.mocked(disconnectGoogle).mockResolvedValue({
      status: 'REVOKED',
      remoteRevocation: 'failed',
    });
    renderWithProviders(<GoogleConnectionCard returnMessage={null} />, {
      regional: { locale: 'en-US' },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, disconnect' }));
    expect(
      await screen.findByText(/Google did not confirm the revocation/),
    ).toBeInTheDocument();
  });

  it.each([
    ['pt-BR', 'insufficient_scopes', /marque a permissão de acesso aos arquivos/],
    ['en-US', 'access_denied', /authorization was cancelled on Google/],
    ['es-ES', 'missing_refresh_token', /no envió una autorización permanente/],
  ] as const)('shows the consent return error in %s (%s)', async (locale, code, text) => {
    vi.mocked(getGoogleConnection).mockResolvedValue(connection({}));
    renderWithProviders(
      <GoogleConnectionCard returnMessage={returnMessageKey(null, code)} />,
      {
        regional: { locale },
      },
    );

    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });
});

describe('returnMessageKey', () => {
  it('maps the consent flow return parameters', () => {
    expect(returnMessageKey('connected', null)).toBe('google.connectedNow');
    expect(returnMessageKey(null, 'invalid_state')).toBe('google.error.invalid_state');
    expect(returnMessageKey(null, 'made-up')).toBe('google.error.unknown');
    expect(returnMessageKey(null, null)).toBeNull();
  });
});
