import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { RegionalSettings } from '../i18n/context';
import { I18nProvider } from '../i18n/I18nProvider';

export function renderWithProviders(
  ui: ReactElement,
  options: { route?: string; regional?: Partial<RegionalSettings> } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider
          initial={{
            locale: 'pt-BR',
            timeZone: 'America/Sao_Paulo',
            currency: 'BRL',
            ...options.regional,
          }}
        >
          <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>,
    ),
  };
}
