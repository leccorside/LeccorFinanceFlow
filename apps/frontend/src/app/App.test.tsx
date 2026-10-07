import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, vi } from 'vitest';
import { App } from './App';
import { getHealth } from '../services/health';

vi.mock('../services/health', () => ({
  getHealth: vi.fn(),
}));

describe('App', () => {
  beforeEach(() => {
    vi.mocked(getHealth).mockResolvedValue({
      status: 'ok',
      service: 'leccor-finance-flow-api',
    });
  });

  it('renders the foundation and confirms the API state', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole('heading', {
        name: /a fundação do seu assistente financeiro está pronta/i,
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText('API disponível')).toBeInTheDocument();
  });
});
