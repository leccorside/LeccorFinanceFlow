import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import { vi } from 'vitest';
import {
  type AiProvider,
  createAiConfiguration,
  listAiProviders,
  reorderAiConfigurations,
  testAiConfiguration,
  updateAiConfiguration,
} from '../../services/aiProviders';
import { renderWithProviders } from '../../test/render';
import { AiProvidersPage } from './AiProvidersPage';

vi.mock('../../services/aiProviders', async (original) => ({
  ...(await original<typeof import('../../services/aiProviders')>()),
  listAiProviders: vi.fn(),
  setProviderActive: vi.fn(),
  createAiConfiguration: vi.fn(),
  updateAiConfiguration: vi.fn(),
  deleteAiConfiguration: vi.fn(),
  reorderAiConfigurations: vi.fn(),
  testAiConfiguration: vi.fn(),
}));

const SECRET = 'sk-typed-by-the-admin-123';

const providers = (): AiProvider[] => [
  {
    id: 'p-gemini',
    type: 'GEMINI',
    displayName: 'Google Gemini',
    isActive: true,
    capabilities: ['CHAT', 'FINANCIAL_INTERPRETATION', 'ANALYSIS'],
    defaultModel: 'gemini-default',
    hasEnvironmentKey: true,
    configurations: [
      {
        id: 'c-flash',
        purpose: 'CHAT',
        model: 'gemini-2.5-flash',
        priority: 1,
        isActive: true,
        keySource: 'stored',
        keyVersion: 'v1',
        updatedAt: '2026-10-09T10:00:00.000Z',
      },
      {
        id: 'c-lite',
        purpose: 'CHAT',
        model: 'gemini-2.5-flash-lite',
        priority: 2,
        isActive: true,
        keySource: 'environment',
        keyVersion: null,
        updatedAt: '2026-10-09T10:00:00.000Z',
      },
    ],
  },
];

const apiError = (status: number, code: string) =>
  new AxiosError('fail', String(status), undefined, null, {
    status,
    data: { code, message: 'x', details: null },
  } as AxiosResponse);

beforeEach(() => {
  vi.mocked(listAiProviders).mockReset().mockResolvedValue(providers());
  vi.mocked(createAiConfiguration)
    .mockReset()
    .mockResolvedValue(providers()[0] as AiProvider);
  vi.mocked(updateAiConfiguration)
    .mockReset()
    .mockResolvedValue(providers()[0] as AiProvider);
  vi.mocked(reorderAiConfigurations).mockReset().mockResolvedValue(providers());
  vi.mocked(testAiConfiguration).mockReset();
});

describe('AiProvidersPage', () => {
  it('lists the Gemini models, priorities and where each key comes from', async () => {
    renderWithProviders(<AiProvidersPage />);

    const gemini = await screen.findByRole('region', { name: 'Google Gemini' });
    expect(gemini.querySelector('.badge')).toHaveTextContent('Ativo');
    expect(within(gemini).getByText('gemini-2.5-flash')).toBeInTheDocument();
    expect(within(gemini).getByText('gemini-2.5-flash-lite')).toBeInTheDocument();
    expect(within(gemini).getByText('Guardada (cifrada)')).toBeInTheDocument();
    expect(within(gemini).getByText('Do servidor')).toBeInTheDocument();
    expect(
      within(gemini).getByText(/chave deste provedor no ambiente/),
    ).toBeInTheDocument();
    // Gemini only: no other provider card.
    expect(
      screen.queryByRole('region', { name: /OpenAI|Anthropic/ }),
    ).not.toBeInTheDocument();

    // Key fields are write-only password inputs, always empty.
    const keyInputs = document.querySelectorAll('input[type="password"]');
    expect(keyInputs.length).toBeGreaterThan(0);
    keyInputs.forEach((input) => expect((input as HTMLInputElement).value).toBe(''));
    keyInputs.forEach((input) => expect(input).toHaveAttribute('autocomplete', 'off'));
  });

  it('adds another model to a purpose that already has one (fallback), forgetting the key', async () => {
    renderWithProviders(<AiProvidersPage />);
    const form = await screen.findByRole('form', { name: 'Novo modelo — Google Gemini' });

    expect(within(form).getByLabelText('Modelo')).toHaveValue('gemini-default');
    // CHAT already has two models and is still offered.
    expect(
      within(within(form).getByLabelText('Finalidade')).getByRole('option', {
        name: 'Conversa',
      }),
    ).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('Modelo'), {
      target: { value: 'gemini-2.5-pro' },
    });
    const key = within(form).getByLabelText('Chave de API (opcional)');
    fireEvent.change(key, { target: { value: SECRET } });
    fireEvent.click(within(form).getByRole('button', { name: 'Adicionar' }));

    await waitFor(() =>
      expect(createAiConfiguration).toHaveBeenCalledWith('p-gemini', {
        purpose: 'CHAT',
        model: 'gemini-2.5-pro',
        apiKey: SECRET,
      }),
    );
    await waitFor(() => expect(key).toHaveValue(''));
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('replaces and removes a stored key', async () => {
    renderWithProviders(<AiProvidersPage />);
    const input = await screen.findByLabelText(
      'Nova chave — gemini-2.5-flash · Conversa',
    );
    fireEvent.change(input, { target: { value: SECRET } });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Salvar chave' })[0] as HTMLElement,
    );
    await waitFor(() =>
      expect(updateAiConfiguration).toHaveBeenCalledWith('c-flash', { apiKey: SECRET }),
    );
    await waitFor(() => expect(input).toHaveValue(''));

    fireEvent.click(screen.getByRole('button', { name: 'Remover chave' }));
    await waitFor(() =>
      expect(updateAiConfiguration).toHaveBeenCalledWith('c-flash', { apiKey: null }),
    );
  });

  it('tests a configuration and explains a failure in plain words', async () => {
    vi.mocked(testAiConfiguration)
      .mockResolvedValueOnce({
        ok: true,
        provider: 'GEMINI',
        model: 'gemini-2.5-flash',
        latencyMs: 120,
        error: null,
      })
      .mockResolvedValueOnce({
        ok: false,
        provider: 'GEMINI',
        model: 'gemini-2.5-flash',
        latencyMs: 80,
        error: 'credential_rejected',
      });
    renderWithProviders(<AiProvidersPage />);

    const button = await screen.findByRole('button', {
      name: 'Testar — gemini-2.5-flash · Conversa',
    });
    fireEvent.click(button);
    expect(await screen.findByText('Respondeu em 120 ms.')).toBeInTheDocument();
    fireEvent.click(button);
    expect(await screen.findByText('Falhou: a chave foi recusada.')).toBeInTheDocument();
  });

  it('changes the fallback order between Gemini models', async () => {
    renderWithProviders(<AiProvidersPage />);
    const order = await screen.findByRole('region', {
      name: 'Ordem de uso por finalidade',
    });
    const chat = within(order).getByRole('list', { name: 'Conversa' });
    expect(
      within(chat)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('gemini-2.5-flash'),
      expect.stringContaining('gemini-2.5-flash-lite'),
    ]);
    expect(
      within(chat).getByRole('button', { name: 'Subir gemini-2.5-flash' }),
    ).toBeDisabled();
    fireEvent.click(
      within(chat).getByRole('button', { name: 'Descer gemini-2.5-flash' }),
    );
    await waitFor(() =>
      expect(reorderAiConfigurations).toHaveBeenCalledWith('CHAT', ['c-lite', 'c-flash']),
    );
  });

  it('explains API errors', async () => {
    vi.mocked(createAiConfiguration).mockRejectedValue(
      apiError(409, 'ai_priority_taken'),
    );
    renderWithProviders(<AiProvidersPage />);
    const form = await screen.findByRole('form', { name: 'Novo modelo — Google Gemini' });
    fireEvent.click(within(form).getByRole('button', { name: 'Adicionar' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Já existe uma configuração com essa prioridade.',
    );
  });

  it('tells non-admins the area is restricted', async () => {
    vi.mocked(listAiProviders).mockRejectedValue(apiError(403, 'forbidden'));
    renderWithProviders(<AiProvidersPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Esta área é só para administradores.',
    );
  });

  it('renders in English and Spanish', async () => {
    const english = renderWithProviders(<AiProvidersPage />, {
      regional: { locale: 'en-US' },
    });
    expect(
      await screen.findByRole('heading', { name: 'AI (Google Gemini)' }),
    ).toBeInTheDocument();
    expect((await screen.findAllByText('Stored (encrypted)')).length).toBeGreaterThan(0);
    english.unmount();
    renderWithProviders(<AiProvidersPage />, { regional: { locale: 'es-ES' } });
    expect(
      await screen.findByRole('heading', { name: 'IA (Google Gemini)' }),
    ).toBeInTheDocument();
  });
});
