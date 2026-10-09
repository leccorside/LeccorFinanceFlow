import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { getGoogleConnection } from '../../services/google';
import {
  cancelDeletion,
  confirmDeletion,
  PRIVACY_EXPORT_URL,
  requestDeletion,
} from '../../services/privacy';
import { renderWithProviders } from '../../test/render';
import { PrivacyPage } from './PrivacyPage';

vi.mock('../../services/privacy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/privacy')>()),
  requestDeletion: vi.fn(),
  confirmDeletion: vi.fn(),
  cancelDeletion: vi.fn(),
}));
vi.mock('../../services/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/google')>()),
  getGoogleConnection: vi.fn(),
  disconnectGoogle: vi.fn(),
}));

const inFiveMinutes = () => new Date(Date.now() + 300_000).toISOString();

function asks(tool: string, summary: Record<string, unknown>) {
  vi.mocked(requestDeletion).mockResolvedValue({
    status: 'confirmation_required',
    tool,
    confirmation: { id: 'c-1', expiresAt: inFiveMinutes(), summary },
  });
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    { route: '/privacy' },
  );
}

const deletionItem = (title: string) =>
  screen.getByRole('heading', { name: title, level: 3 }).closest('li') as HTMLElement;

beforeEach(() => {
  vi.mocked(requestDeletion).mockReset();
  vi.mocked(confirmDeletion).mockReset();
  vi.mocked(cancelDeletion).mockReset();
  vi.mocked(getGoogleConnection).mockResolvedValue({
    status: 'ACTIVE',
    googleEmail: 'ana@gmail.com',
    grantedScopes: [],
    requiredScopes: [],
    missingScopes: [],
    connectedAt: '2026-10-01T10:00:00.000Z',
    lastRefreshedAt: null,
  });
});

describe('PrivacyPage', () => {
  it('offers the export download, the Google card, the deletions and the retention periods', async () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'Baixar arquivo JSON' });
    expect(link).toHaveAttribute('href', PRIVACY_EXPORT_URL);
    expect(link).toHaveAttribute('download');
    expect(
      await screen.findByText('ana@gmail.com', { exact: false }),
    ).toBeInTheDocument();
    for (const title of [
      'Apagar conversas',
      'Apagar dados financeiros',
      'Excluir minha conta',
    ]) {
      expect(
        within(deletionItem(title)).getByRole('button', { name: title }),
      ).toBeInTheDocument();
    }
    expect(
      screen.getByText('Sessões encerradas ou expiradas: 30 dias.'),
    ).toBeInTheDocument();
  });

  it('never deletes on the first click: shows what goes and waits for the explicit yes', async () => {
    asks('delete_conversation_history', { scope: 'all_conversations', conversations: 4 });
    vi.mocked(confirmDeletion).mockResolvedValue({
      status: 'ok',
      tool: 'delete_conversation_history',
      data: { deleted: { conversations: 4 } },
    });
    renderPage();

    fireEvent.click(
      within(deletionItem('Apagar conversas')).getByRole('button', {
        name: 'Apagar conversas',
      }),
    );
    const card = await screen.findByRole('region', {
      name: 'Confirmar: Apagar conversas',
    });
    expect(requestDeletion).toHaveBeenCalledWith('conversations');
    expect(within(card).getByText('4')).toBeInTheDocument();
    expect(confirmDeletion).not.toHaveBeenCalled();

    fireEvent.click(within(card).getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Conversas apagadas.');
    expect(confirmDeletion).toHaveBeenCalledWith('c-1');
  });

  it('cancels without deleting', async () => {
    asks('delete_financial_data', { transactions: 12, irreversible: true });
    vi.mocked(cancelDeletion).mockResolvedValue({
      status: 'ok',
      tool: 'delete_financial_data',
      data: { cancelled: true },
    });
    renderPage();
    fireEvent.click(
      within(deletionItem('Apagar dados financeiros')).getByRole('button', {
        name: 'Apagar dados financeiros',
      }),
    );
    const card = await screen.findByRole('region', {
      name: 'Confirmar: Apagar dados financeiros',
    });
    // Every count of the summary has a human label (none falls back to the raw key).
    expect(within(card).getByText('Lançamentos')).toBeInTheDocument();
    expect(within(card).queryByText(/transactions/i)).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Cancelar' }));
    expect(
      await screen.findByText('Exclusão cancelada. Nada foi apagado.'),
    ).toBeInTheDocument();
    expect(confirmDeletion).not.toHaveBeenCalled();
    expect(cancelDeletion).toHaveBeenCalledWith('c-1');
  });

  it('after deleting the account, forgets the session and goes to the landing page', async () => {
    asks('delete_my_account', { email: 'ana@example.com', irreversible: true });
    vi.mocked(confirmDeletion).mockResolvedValue({
      status: 'ok',
      tool: 'delete_my_account',
      data: { deleted: { account: true }, googleRevocation: 'revoked' },
    });
    const { queryClient } = renderPage();
    queryClient.setQueryData(['profile'], { firstName: 'Ana' });

    fireEvent.click(
      within(deletionItem('Excluir minha conta')).getByRole('button', {
        name: 'Excluir minha conta',
      }),
    );
    const card = await screen.findByRole('region', {
      name: 'Confirmar: Excluir minha conta',
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByTestId('where')).toHaveTextContent('/?accountDeleted=1');
    expect(queryClient.getQueryData(['me'])).toBeNull();
    expect(queryClient.getQueryData(['profile'])).toBeUndefined();
  });

  it('reports failures and keeps everything when the server refuses', async () => {
    asks('delete_my_account', { email: 'ana@example.com' });
    vi.mocked(confirmDeletion).mockResolvedValue({
      status: 'error',
      tool: 'delete_my_account',
      error: 'confirmation_expired',
    });
    renderPage();
    fireEvent.click(
      within(deletionItem('Excluir minha conta')).getByRole('button', {
        name: 'Excluir minha conta',
      }),
    );
    const card = await screen.findByRole('region', {
      name: 'Confirmar: Excluir minha conta',
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Não foi possível concluir. Nada foi apagado; tente de novo.',
      ),
    );
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
  });
});
