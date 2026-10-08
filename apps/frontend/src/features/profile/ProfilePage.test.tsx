import { fireEvent, screen, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import { vi } from 'vitest';
import type { Locale } from '../../i18n/catalog';
import { getProfile, type Profile, updateProfile } from '../../services/profile';
import { renderWithProviders } from '../../test/render';
import { ProfilePage } from './ProfilePage';

vi.mock('../../services/google', () => ({
  getGoogleConnection: vi.fn().mockResolvedValue({
    status: 'NOT_CONNECTED',
    googleEmail: null,
    grantedScopes: [],
    requiredScopes: ['https://www.googleapis.com/auth/drive.file'],
    missingScopes: ['https://www.googleapis.com/auth/drive.file'],
    connectedAt: null,
    lastRefreshedAt: null,
  }),
  disconnectGoogle: vi.fn(),
  googleConnectUrl: () => '/api/v1/google/connect?redirectTo=%2Fprofile',
}));

vi.mock('../../services/spreadsheets', () => ({
  listSpreadsheets: vi.fn().mockResolvedValue([]),
  createSpreadsheet: vi.fn(),
}));

vi.mock('../../services/profile', () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}));

const baseProfile: Profile = {
  email: 'ana@example.com',
  firstName: 'Ana',
  lastName: 'Silva',
  photoUrl: null,
  phone: null,
  locale: 'pt-BR',
  currency: 'BRL',
  timeZone: 'America/Sao_Paulo',
  preferences: { theme: 'system', weekStartsOn: 'monday' },
  voice: { gender: 'FEMALE', autoSpeak: true, speakingRate: 1 },
  updatedAt: '2026-10-08T12:00:00.000Z',
};

const plain = (value: string | null) => (value ?? '').replace(/[\u00a0\u202f]/g, ' ');

function renderPage(locale: Locale = 'pt-BR', profile: Partial<Profile> = {}) {
  vi.mocked(getProfile).mockResolvedValue({ ...baseProfile, locale, ...profile });
  return renderWithProviders(<ProfilePage />, { regional: { locale } });
}

beforeEach(() => {
  vi.mocked(getProfile).mockReset();
  vi.mocked(updateProfile).mockReset();
});

describe('ProfilePage', () => {
  it.each([
    ['pt-BR', 'Seu perfil', 'Salvar alterações'],
    ['en-US', 'Your profile', 'Save changes'],
    ['es-ES', 'Tu perfil', 'Guardar cambios'],
  ] as const)('renders in %s', async (locale, title, save) => {
    renderPage(locale);

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: save })).toBeInTheDocument();
  });

  it('shows the e-mail as read-only and explains where it comes from', async () => {
    renderPage();

    const email = await screen.findByLabelText('E-mail');
    expect(email).toHaveValue('ana@example.com');
    expect(email).toHaveAttribute('readonly');
    expect(email).toHaveAccessibleDescription(/conta Google verificada/);
  });

  it('updates the preview live with currency, language and time zone', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Seu perfil' });
    expect(plain(screen.getByTestId('preview-money').textContent)).toBe('R$ 1.234,56');

    fireEvent.change(screen.getByLabelText('Moeda'), { target: { value: 'USD' } });
    fireEvent.change(screen.getByLabelText('Idioma'), { target: { value: 'en-US' } });

    expect(plain(screen.getByTestId('preview-money').textContent)).toBe('$1,234.56');
    expect(plain(screen.getByTestId('preview-date').textContent)).toBe('Dec 10, 2026');
  });

  it('saves only the changed fields and switches the UI language after saving', async () => {
    vi.mocked(updateProfile).mockResolvedValue({
      ...baseProfile,
      locale: 'en-US',
      timeZone: 'Asia/Tokyo',
      updatedAt: '2026-10-08T12:05:00.000Z',
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Seu perfil' });

    fireEvent.change(screen.getByLabelText('Idioma'), { target: { value: 'en-US' } });
    fireEvent.change(screen.getByLabelText('Fuso horário'), {
      target: { value: 'Asia/Tokyo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({
        locale: 'en-US',
        timeZone: 'Asia/Tokyo',
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Your profile' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Profile updated.')).toBeInTheDocument();
  });

  it('does not call the API when nothing changed', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByText('Nada para salvar.')).toBeInTheDocument();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('marks fields rejected by the API', async () => {
    const response = {
      status: 400,
      data: {
        code: 'validation_failed',
        message: 'Dados inválidos.',
        details: { issues: [{ path: 'phone', code: 'invalid_format', message: 'x' }] },
      },
    } as AxiosResponse;
    vi.mocked(updateProfile).mockRejectedValue(
      new AxiosError('bad', '400', undefined, null, response),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'Seu perfil' });

    fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Telefone')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(screen.getByLabelText('Telefone')).toHaveAccessibleDescription(
      /Valor inválido/,
    );
    expect(screen.getByText(/Não foi possível salvar/)).toBeInTheDocument();
  });

  it('shows an error when the profile cannot be loaded', async () => {
    vi.mocked(getProfile).mockRejectedValue(new Error('down'));
    renderWithProviders(<ProfilePage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar seu perfil.',
    );
  });
});
