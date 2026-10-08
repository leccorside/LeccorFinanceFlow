import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  it('links to the backend Google login keeping a safe return path', () => {
    renderWithProviders(<LoginPage />, { route: '/login?redirectTo=/profile?tab=voz' });

    expect(screen.getByRole('link', { name: 'Entrar com Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/google/login?redirectTo=%2Fprofile%3Ftab%3Dvoz',
    );
  });

  it('ignores external return paths', () => {
    renderWithProviders(<LoginPage />, { route: '/login?redirectTo=//evil.example' });

    expect(screen.getByRole('link', { name: 'Entrar com Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/google/login?redirectTo=%2Fprofile',
    );
  });

  it.each([
    ['pt-BR', 'account_blocked', 'Sua conta está bloqueada'],
    ['en-US', 'account_blocked', 'Your account is blocked'],
    ['es-ES', 'email_not_verified', 'Tu correo de Google aún no está verificado'],
    ['pt-BR', 'something-new', 'Não foi possível entrar'],
  ] as const)('translates the error in %s (%s)', (locale, code, text) => {
    renderWithProviders(<LoginPage />, {
      route: `/login?error=${code}`,
      regional: { locale },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });
});
