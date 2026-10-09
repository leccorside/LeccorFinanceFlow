import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import { afterEach, beforeEach, vi } from 'vitest';
import {
  type AssistantTurn,
  cancelInConversation,
  confirmInConversation,
  getMessages,
  getSuggestions,
  listConversations,
  listPendingConfirmations,
  sendMessage,
  undoLastAction,
} from '../../services/assistant';
import { renderWithProviders } from '../../test/render';
import { AssistantPage } from './AssistantPage';

vi.mock('../../services/assistant', () => ({
  listConversations: vi.fn(),
  listPendingConfirmations: vi.fn(),
  getSuggestions: vi.fn(),
  getMessages: vi.fn(),
  sendMessage: vi.fn(),
  confirmInConversation: vi.fn(),
  cancelInConversation: vi.fn(),
  undoLastAction: vi.fn(),
}));

const CONVERSATION = '6f0f7d55-7d0e-4c1b-9f43-5d8a5e9f0a11';

function turn(overrides: Partial<AssistantTurn> = {}): AssistantTurn {
  return {
    conversationId: CONVERSATION,
    state: 'answered',
    reply: {
      id: 'reply-1',
      content: 'Registrei R$ 50,00 em Mercado.',
      provider: 'fake',
      createdAt: '2026-10-09T12:00:00.000Z',
    },
    actions: [{ tool: 'create_transaction', status: 'ok', sync: 'SYNCED' }],
    confirmations: [],
    candidates: [],
    suggestions: ['Quanto gastei este mês?'],
    ...overrides,
  };
}

function apiError(status: number, code: string, message = 'Falhou.') {
  return new AxiosError('failed', String(status), undefined, undefined, {
    status,
    data: { code, message, details: null, requestId: 'r', timestamp: 't' },
  } as AxiosResponse);
}

function composer() {
  return screen.getByRole('textbox', { name: 'Mensagem para o assistente' });
}

function sendWithEnter(text: string) {
  fireEvent.change(composer(), { target: { value: text } });
  fireEvent.keyDown(composer(), { key: 'Enter' });
}

/** The whole reply, as screen readers receive it (the typing effect is aria-hidden). */
function spoken(text: string) {
  return screen.findByText(text, { selector: '.visually-hidden' });
}

describe('AssistantPage', () => {
  beforeEach(() => {
    vi.mocked(listConversations).mockResolvedValue([]);
    vi.mocked(listPendingConfirmations).mockResolvedValue([]);
    vi.mocked(getSuggestions).mockResolvedValue([
      'Quanto gastei este mês?',
      'Quais contas vencem esta semana?',
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('greets by name with the orb and suggestions when the conversation is empty', async () => {
    const { container } = renderWithProviders(<AssistantPage firstName="Ana" />);

    expect(
      screen.getByRole('heading', { name: 'Assistente financeiro' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Olá, Ana. Como posso ajudar?')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Pronto para ouvir');
    const orbs = container.querySelectorAll('canvas.voice-orb');
    expect(orbs.length).toBeGreaterThan(0);
    orbs.forEach((orb) => expect(orb).toHaveAttribute('aria-hidden', 'true'));
    const suggestions = await screen.findByRole('list', { name: 'Sugestões' });
    expect(within(suggestions).getAllByRole('button')).toHaveLength(2);
    expect(await screen.findByText('Nenhuma conversa ainda.')).toBeInTheDocument();
  });

  it('sends with Enter, shows the thinking state, then the reply with its tool feedback', async () => {
    let answer: (value: AssistantTurn) => void = () => {};
    vi.mocked(sendMessage).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { container } = renderWithProviders(<AssistantPage firstName={null} />);

    sendWithEnter('  gastei 50 no mercado  ');

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({ message: 'gastei 50 no mercado' }),
    );
    expect(composer()).toHaveValue('');
    expect(await screen.findByText('gastei 50 no mercado')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Pensando…');
    expect(container.querySelector('canvas.voice-orb')).toHaveAttribute(
      'data-state',
      'thinking',
    );
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();

    await act(async () => answer(turn()));

    expect(await spoken('Registrei R$ 50,00 em Mercado.')).toBeInTheDocument();
    const log = screen.getByRole('log', { name: 'Mensagens da conversa' });
    expect(within(log).getByText('Você')).toBeInTheDocument();
    // The reply "speaks" while it is written, then goes back to idle.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Pronto para ouvir'),
    );
    expect(
      within(log).getByText('Novo lançamento · feito · planilha atualizada'),
    ).toBeInTheDocument();
    // Follow-up suggestion from the turn; history is not refetched (cache was filled).
    expect(
      screen.getByRole('button', { name: 'Quanto gastei este mês?' }),
    ).toBeInTheDocument();
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('keeps Shift+Enter as a line break and ignores blank messages', async () => {
    renderWithProviders(<AssistantPage firstName={null} />);

    fireEvent.change(composer(), { target: { value: 'linha 1' } });
    fireEvent.keyDown(composer(), { key: 'Enter', shiftKey: true });
    // Sending would have cleared the box.
    expect(composer()).toHaveValue('linha 1');
    fireEvent.change(composer(), { target: { value: '   ' } });
    fireEvent.keyDown(composer(), { key: 'Enter' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  });

  it('sends a suggestion when it is clicked', async () => {
    vi.mocked(sendMessage).mockResolvedValue(turn());
    renderWithProviders(<AssistantPage firstName={null} />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Quais contas vencem esta semana?' }),
    );

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        message: 'Quais contas vencem esta semana?',
      }),
    );
  });

  it('explains a failed send, gives the text back and retries it', async () => {
    vi.mocked(sendMessage)
      .mockRejectedValueOnce(apiError(429, 'rate_limited'))
      .mockResolvedValueOnce(turn());
    renderWithProviders(<AssistantPage firstName={null} />);

    sendWithEnter('saldo?');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas mensagens em pouco tempo. Aguarde um instante e tente de novo.',
    );
    expect(composer()).toHaveValue('saldo?');
    expect(
      screen.queryByText('saldo?', { selector: '.bubble-text' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Algo deu errado');

    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    expect(await spoken('Registrei R$ 50,00 em Mercado.')).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('marks an answer that ended in error', async () => {
    vi.mocked(sendMessage).mockResolvedValue(
      turn({
        state: 'error',
        reply: { ...turn().reply, content: 'Não consegui responder agora.' },
        actions: [],
        error: { code: 'ai_unavailable' },
      }),
    );
    const { container } = renderWithProviders(<AssistantPage firstName={null} />);

    sendWithEnter('oi');

    expect(await spoken('Não consegui responder agora.')).toBeInTheDocument();
    expect(container.querySelector('.bubble--failed')).not.toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Algo deu errado'),
    );
  });

  it('loads a conversation with skeletons, then its messages and tool trace', async () => {
    let load: (value: Awaited<ReturnType<typeof getMessages>>) => void = () => {};
    vi.mocked(getMessages).mockReturnValue(
      new Promise((resolve) => {
        load = resolve;
      }),
    );
    vi.mocked(listConversations).mockResolvedValue([
      {
        id: CONVERSATION,
        title: 'Mercado',
        createdAt: '2026-10-09T11:00:00.000Z',
        updatedAt: '2026-10-09T11:05:00.000Z',
      },
    ]);
    const { container } = renderWithProviders(<AssistantPage firstName={null} />, {
      route: `/?c=${CONVERSATION}`,
    });

    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando a conversa…');
    await waitFor(() => expect(getMessages).toHaveBeenCalledWith(CONVERSATION));

    await act(async () =>
      load([
        {
          id: 'm1',
          role: 'USER',
          content: 'gastei 50',
          provider: null,
          toolName: null,
          toolCalls: [],
          toolStatus: null,
          createdAt: '2026-10-09T11:00:00.000Z',
        },
        {
          id: 'm2',
          role: 'TOOL',
          content: null,
          provider: null,
          toolName: 'create_transaction',
          toolCalls: [],
          toolStatus: 'ok',
          createdAt: '2026-10-09T11:00:01.000Z',
        },
        {
          id: 'm3',
          role: 'ASSISTANT',
          content: 'Feito.',
          provider: 'fake',
          toolName: null,
          toolCalls: [],
          toolStatus: null,
          createdAt: '2026-10-09T11:00:02.000Z',
        },
      ]),
    );

    const log = screen.getByRole('log');
    expect(within(log).getByText('gastei 50')).toBeInTheDocument();
    expect(within(log).getByText('Novo lançamento · feito')).toBeInTheDocument();
    // History is shown at once (no typing effect).
    expect(
      within(log).getByText('Feito.', { selector: '.bubble-text' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.skeleton')).toBeNull();
    expect(await screen.findByRole('link', { name: /Mercado/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('offers a way out when the conversation no longer exists', async () => {
    vi.mocked(getMessages).mockRejectedValue(apiError(404, 'not_found'));
    renderWithProviders(<AssistantPage firstName={null} />, {
      route: `/?c=${CONVERSATION}`,
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Essa conversa não existe mais.');
    expect(within(alert).getByRole('link', { name: 'Nova conversa' })).toHaveAttribute(
      'href',
      '/',
    );
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(2));
  });

  it('shows a pending confirmation with its summary and countdown, and confirms it', async () => {
    vi.mocked(getMessages).mockResolvedValue([]);
    vi.mocked(listPendingConfirmations).mockResolvedValue([
      {
        id: 'c1',
        tool: 'delete_transaction',
        conversationId: CONVERSATION,
        summary: {
          id: 't1',
          description: 'Mercado',
          amount: '75.00',
          currency: 'BRL',
          occurredOn: '2026-10-08',
        },
        expiresAt: new Date(Date.now() + 125_000).toISOString(),
        createdAt: new Date().toISOString(),
      },
      {
        id: 'other',
        tool: 'delete_account',
        conversationId: 'another-conversation',
        summary: {},
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(confirmInConversation).mockResolvedValue(
      turn({
        reply: { ...turn().reply, id: 'reply-2', content: 'Excluí o lançamento.' },
        actions: [{ tool: 'delete_transaction', status: 'ok' }],
      }),
    );
    renderWithProviders(<AssistantPage firstName={null} />, {
      route: `/?c=${CONVERSATION}`,
    });

    const card = await screen.findByRole('region', {
      name: 'Confirmar: Excluir lançamento',
    });
    expect(screen.queryByRole('region', { name: /Excluir conta financeira/ })).toBeNull();
    expect(within(card).getByText('Mercado')).toBeInTheDocument();
    expect(within(card).getByText(/R\$\s75,00/)).toBeInTheDocument();
    expect(within(card).getByText('8 de out. de 2026')).toBeInTheDocument();
    expect(within(card).getByText(/Expira em 2:0[45]/)).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() =>
      expect(confirmInConversation).toHaveBeenCalledWith(CONVERSATION, 'c1'),
    );
    expect(await spoken('Excluí o lançamento.')).toBeInTheDocument();
    expect(listPendingConfirmations).toHaveBeenCalledTimes(2);
  });

  it('cancels a confirmation and disables an expired one', async () => {
    vi.mocked(getMessages).mockResolvedValue([]);
    vi.mocked(listPendingConfirmations).mockResolvedValue([
      {
        id: 'c1',
        tool: 'delete_transaction',
        conversationId: CONVERSATION,
        summary: { description: 'Mercado' },
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(cancelInConversation).mockResolvedValue(
      turn({ reply: { ...turn().reply, id: 'r3', content: 'Tudo bem, não excluí.' } }),
    );
    renderWithProviders(<AssistantPage firstName={null} />, {
      route: `/?c=${CONVERSATION}`,
    });

    const card = await screen.findByRole('region', { name: /Confirmar/ });
    expect(within(card).getByText('Expirou. Peça a ação de novo.')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Confirmar' })).toBeDisabled();

    fireEvent.click(within(card).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() =>
      expect(cancelInConversation).toHaveBeenCalledWith(CONVERSATION, 'c1'),
    );
    expect(await spoken('Tudo bem, não excluí.')).toBeInTheDocument();
  });

  it('turns ambiguous matches into choices that answer the assistant', async () => {
    vi.mocked(sendMessage)
      .mockResolvedValueOnce(
        turn({
          state: 'needs_clarification',
          reply: { ...turn().reply, content: 'Encontrei dois. Qual deles?' },
          actions: [{ tool: 'delete_transaction', status: 'ambiguous' }],
          candidates: [
            { id: 'a1', description: 'Mercado', amount: '50.00', currency: 'BRL' },
            { id: 'b2', description: 'Mercado', amount: '75.00', currency: 'BRL' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        turn({ reply: { ...turn().reply, id: 'r2', content: 'Ok.' } }),
      );
    renderWithProviders(<AssistantPage firstName={null} />);

    sendWithEnter('apaga o mercado');
    await spoken('Encontrei dois. Qual deles?');
    const choice = await screen.findByRole('button', { name: /Mercado\s*R\$\s75,00/ });

    fireEvent.click(choice);

    await waitFor(() =>
      expect(sendMessage).toHaveBeenLastCalledWith({
        message: 'Quero “Mercado” (id b2).',
        conversationId: CONVERSATION,
      }),
    );
  });

  it('undoes the last change and reports when there is nothing left', async () => {
    vi.mocked(undoLastAction)
      .mockResolvedValueOnce({
        status: 'ok',
        tool: 'undo_last_action',
        data: { undone: [{ label: 'Mercado' }] },
      })
      .mockResolvedValueOnce({
        status: 'error',
        tool: 'undo_last_action',
        error: 'nothing_to_undo',
        message: 'Nada.',
      });
    renderWithProviders(<AssistantPage firstName={null} />);
    const undo = screen.getByRole('button', { name: 'Desfazer a última alteração' });

    fireEvent.click(undo);
    expect(await screen.findAllByText('Desfeito: Mercado.')).not.toHaveLength(0);

    await waitFor(() => expect(undo).toBeEnabled());
    fireEvent.click(undo);
    expect(await screen.findAllByText('Não há nada para desfazer.')).not.toHaveLength(0);
  });

  it('opens the conversation drawer from the keyboard and closes it with Escape', async () => {
    renderWithProviders(<AssistantPage firstName={null} />);
    const toggle = screen.getByRole('button', { name: 'Abrir conversas' });
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(panel).toHaveAttribute('inert');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveAttribute('inert');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));
    expect(toggle).toHaveFocus();
  });

  it('shows the conversation list as a column on wide screens', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === '(min-width: 900px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      renderWithProviders(<AssistantPage firstName={null} />);
      expect(screen.queryByRole('button', { name: 'Abrir conversas' })).toBeNull();
      expect(
        screen.getByRole('complementary', { name: 'Conversas' }),
      ).not.toHaveAttribute('inert');
    } finally {
      window.matchMedia = original;
    }
  });
});
