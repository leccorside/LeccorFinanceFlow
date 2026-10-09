import { screen } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';
import { getCurrentUser } from '../services/auth';
import { getHealth } from '../services/health';
import { renderWithProviders } from '../test/render';
import { App } from './App';

vi.mock('../services/health', () => ({ getHealth: vi.fn() }));
vi.mock('../services/profile', () => ({
  getProfile: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../services/voice', () => ({
  getVoiceCapabilities: vi.fn(() => new Promise(() => {})),
  transcribe: vi.fn(),
  speak: vi.fn(),
}));
vi.mock('../services/assistant', () => ({
  listConversations: vi.fn(() => Promise.resolve([])),
  listPendingConfirmations: vi.fn(() => Promise.resolve([])),
  getSuggestions: vi.fn(() => Promise.resolve([])),
  getMessages: vi.fn(),
  sendMessage: vi.fn(),
  confirmInConversation: vi.fn(),
  cancelInConversation: vi.fn(),
  undoLastAction: vi.fn(),
}));
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

  it('shows visitors the landing with the way in and the API state', async () => {
    renderWithProviders(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Converse com o seu dinheiro.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entrar com Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/google/login?redirectTo=%2F',
    );
    expect(await screen.findByText('API disponível')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Abrir o assistente' }),
    ).not.toBeInTheDocument();
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
      await screen.findByRole('heading', { name: 'Asistente financiero' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Hola, Ana. ¿En qué te ayudo?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Asistente' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('es-ES');
  });

  it('shows the administration link only to admins and blocks the page for others', async () => {
    const user = {
      id: 'u1',
      email: 'ana@example.com',
      status: 'ACTIVE' as const,
      roles: ['USER' as const],
      profile: null,
    };
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    const view = renderWithProviders(<App />, { route: '/admin/ai' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Esta área é só para administradores.',
    );
    expect(screen.queryByRole('link', { name: 'Administração' })).not.toBeInTheDocument();
    // Away from the chat, the floating button leads back to it.
    expect(screen.getByRole('link', { name: 'Abrir o assistente' })).toHaveAttribute(
      'href',
      '/',
    );
    view.unmount();

    vi.mocked(getCurrentUser).mockResolvedValue({ ...user, roles: ['ADMIN', 'USER'] });
    renderWithProviders(<App />);
    expect(await screen.findByRole('link', { name: 'Administração' })).toHaveAttribute(
      'href',
      '/admin/ai',
    );
  });

  it('sends unknown addresses to the home page', async () => {
    renderWithProviders(<App />, { route: '/qualquer-coisa' });
    expect(
      await screen.findByRole('heading', { name: 'Converse com o seu dinheiro.' }),
    ).toBeInTheDocument();
  });
});
