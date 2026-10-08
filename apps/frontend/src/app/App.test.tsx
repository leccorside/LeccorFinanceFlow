import { screen } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';
import { getCurrentUser } from '../services/auth';
import { getHealth } from '../services/health';
import { renderWithProviders } from '../test/render';
import { App } from './App';

vi.mock('../services/health', () => ({ getHealth: vi.fn() }));
vi.mock('../services/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/auth')>()),
  getCurrentUser: vi.fn(),
}));

describe('App', () => {
  beforeEach(() => {
    vi.mocked(getHealth).mockResolvedValue({
      status: 'ok',
      service: 'leccor-finance-flow-api',
    });
    vi.mocked(getCurrentUser).mockResolvedValue(null);
  });

  it('renders the home page and confirms the API state', async () => {
    renderWithProviders(<App />);

    expect(
      screen.getByRole('heading', {
        name: /a fundação do seu assistente financeiro está pronta/i,
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText('API disponível')).toBeInTheDocument();
  });

  it('sends anonymous visitors of /profile to the login page', async () => {
    renderWithProviders(<App />, { route: '/profile' });

    expect(
      await screen.findByRole('heading', { name: 'Entre para continuar' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entrar com Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/google/login?redirectTo=%2Fprofile',
    );
  });

  it("applies the signed-in user's language from the profile", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 'u1',
      email: 'ana@example.com',
      status: 'ACTIVE',
      roles: ['USER'],
      profile: {
        firstName: 'Ana',
        lastName: null,
        photoUrl: null,
        locale: 'es-ES',
        currency: 'EUR',
        timeZone: 'Europe/Madrid',
      },
    });
    renderWithProviders(<App />);

    expect(
      await screen.findByRole('heading', {
        name: 'La base de tu asistente financiero está lista.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('es-ES');
  });
});
