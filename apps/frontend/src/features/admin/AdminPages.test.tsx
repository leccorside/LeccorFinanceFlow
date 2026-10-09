import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import { afterEach, beforeEach, vi } from 'vitest';
import {
  type AdminOverview,
  type AdminUser,
  getAudit,
  getOverview,
  getSettings,
  listUsers,
  setUserAdmin,
  setUserStatus,
  type SettingValues,
  updateSettings,
} from '../../services/admin';
import { renderWithProviders } from '../../test/render';
import { AdminOverviewPage } from './AdminOverviewPage';
import { AdminSettingsPage } from './AdminSettingsPage';
import { AdminUsersPage } from './AdminUsersPage';

vi.mock('../../services/admin', () => ({
  getOverview: vi.fn(),
  getAudit: vi.fn().mockResolvedValue([]),
  listUsers: vi.fn(),
  setUserStatus: vi.fn(),
  setUserAdmin: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

const overview: AdminOverview = {
  windowDays: 30,
  users: { total: 42, active: 40, blocked: 2, admins: 3, newInWindow: 5 },
  google: { connected: 30, needsReauth: 1, revoked: 4 },
  spreadsheets: { active: 28, total: 31 },
  assistant: { conversations: 120, messagesInWindow: 900, enabled: true },
  reports: { generatedInWindow: 17 },
  ai: { activeProviders: 2, activeConfigurations: 3 },
  usage: {
    rows: [
      {
        kind: 'AI_CHAT',
        provider: 'OPENAI',
        model: 'gpt-test',
        requests: 800,
        failures: 0,
        inputUnits: 1_250_000,
        outputUnits: 300_000,
        estimatedCostUsd: '6.125000',
      },
      {
        kind: 'AI_CHAT',
        provider: 'GEMINI',
        model: 'gemini-test',
        requests: 40,
        failures: 40,
        inputUnits: 0,
        outputUnits: 0,
        estimatedCostUsd: null,
      },
    ],
    estimatedCostUsd: '6.125000',
    unpriced: 1,
  },
  voice: {
    transcription: {
      enabled: true,
      providers: [{ provider: 'openai', keyConfigured: true, model: null }],
    },
    speech: { enabled: false, providers: [] },
  },
};

function user(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'u1',
    email: 'ana@example.com',
    name: 'Ana Souza',
    status: 'ACTIVE',
    roles: ['USER'],
    adminFromEnvironment: false,
    isSelf: false,
    googleConnection: 'ACTIVE',
    spreadsheets: 1,
    lastLoginAt: '2026-10-09T12:00:00.000Z',
    createdAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

const settings: SettingValues = {
  'signups.enabled': true,
  'assistant.enabled': true,
  'voice.transcription.enabled': true,
  'voice.speech.enabled': true,
  'usage.prices': [],
};

function apiError(status: number, code: string) {
  return new AxiosError('failed', String(status), undefined, undefined, {
    status,
    data: { code, message: 'x', details: null, requestId: 'r', timestamp: 't' },
  } as AxiosResponse);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminOverviewPage', () => {
  it('shows the platform counters, usage with estimated cost and voice status (no keys)', async () => {
    vi.mocked(getOverview).mockResolvedValue(overview);
    renderWithProviders(<AdminOverviewPage />);

    expect(
      await screen.findByRole('heading', { name: 'Visão geral da plataforma' }),
    ).toBeInTheDocument();
    const card = (label: string) =>
      screen.getByText(label, { selector: 'dt' }).closest('.stat-card') as HTMLElement;
    expect(within(card('Usuários')).getByText('42')).toBeInTheDocument();
    expect(
      within(card('Usuários')).getByText(/40 ativos · 2 bloqueados · 3 admins/),
    ).toBeInTheDocument();
    expect(within(card('Contas Google conectadas')).getByText('30')).toBeInTheDocument();
    expect(within(card('Consumo estimado')).getByText('US$ 6,125')).toBeInTheDocument();

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByText('gpt-test')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('1.250.000')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('sem preço')).toBeInTheDocument();

    expect(screen.getByText('chave configurada')).toBeInTheDocument();
    expect(
      screen.getByText('Nenhum provedor configurado no servidor.'),
    ).toBeInTheDocument();
  });

  it('lists recent administrative actions, including ones on deleted accounts', async () => {
    vi.mocked(getOverview).mockResolvedValue(overview);
    vi.mocked(getAudit).mockResolvedValue([
      {
        id: 'a3',
        action: 'settings.update',
        details: { keys: ['voice.enabled', 'assistant.enabled'] },
        actor: 'root@example.com',
        target: null,
        createdAt: '2026-10-09T15:00:00.000Z',
      },
      {
        id: 'a2',
        action: 'user.admin',
        details: { admin: true },
        actor: 'root@example.com',
        target: 'bia@example.com',
        createdAt: '2026-10-09T14:00:00.000Z',
      },
      {
        id: 'a1',
        action: 'user.status',
        details: { status: 'BLOCKED' },
        actor: null,
        target: null,
        createdAt: '2026-10-09T13:00:00.000Z',
      },
    ]);
    renderWithProviders(<AdminOverviewPage />);

    const section = (
      await screen.findByRole('heading', { name: 'Ações administrativas recentes' })
    ).closest('section') as HTMLElement;
    const items = await within(section).findAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(
      'Configurações alteradas: voice.enabled, assistant.enabled',
    );
    expect(items[1]).toHaveTextContent('bia@example.com virou administrador');
    expect(items[1]).toHaveTextContent('root@example.com');
    expect(items[2]).toHaveTextContent('(conta excluída) → Bloqueado');
  });

  it('reports a load failure with retry', async () => {
    vi.mocked(getOverview)
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce(overview);
    renderWithProviders(<AdminOverviewPage />);
    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }));
    expect(
      await screen.findByRole('heading', { name: 'Visão geral da plataforma' }),
    ).toBeInTheDocument();
  });
});

describe('AdminUsersPage', () => {
  beforeEach(() => {
    vi.mocked(listUsers).mockResolvedValue({
      items: [
        user(),
        user({
          id: 'me',
          email: 'root@example.com',
          name: null,
          roles: ['ADMIN', 'USER'],
          isSelf: true,
          adminFromEnvironment: true,
        }),
        user({
          id: 'u2',
          email: 'bia@example.com',
          name: null,
          roles: ['ADMIN', 'USER'],
        }),
      ],
      total: 3,
    });
  });

  it('offers only the allowed actions: nothing on yourself, no demotion of ADMIN_EMAILS', async () => {
    renderWithProviders(<AdminUsersPage />);
    const items = await screen.findAllByRole('listitem');
    expect(
      within(items[0] as HTMLElement).getByRole('button', {
        name: 'Bloquear: ana@example.com',
      }),
    ).toBeInTheDocument();
    expect(
      within(items[0] as HTMLElement).getByRole('button', {
        name: 'Tornar admin: ana@example.com',
      }),
    ).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).queryAllByRole('button')).toHaveLength(0);
    expect(
      within(items[1] as HTMLElement).getByText('admin por ADMIN_EMAILS'),
    ).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText('você')).toBeInTheDocument();
    expect(
      within(items[2] as HTMLElement).getByRole('button', {
        name: 'Remover admin: bia@example.com',
      }),
    ).toBeInTheDocument();
  });

  it('asks for confirmation before blocking and reports the result', async () => {
    vi.mocked(setUserStatus).mockResolvedValue(user({ status: 'BLOCKED' }));
    renderWithProviders(<AdminUsersPage />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Bloquear: ana@example.com' }),
    );
    const confirm = screen.getByRole('group', { name: /Bloquear ana@example.com\?/ });
    expect(setUserStatus).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(setUserStatus).toHaveBeenCalledWith('u1', 'BLOCKED'));
    expect(
      (await screen.findAllByText('Alteração salva para ana@example.com.')).length,
    ).toBeGreaterThan(0);
    expect(listUsers).toHaveBeenCalledTimes(2);
  });

  it('explains refusals from the API', async () => {
    vi.mocked(setUserAdmin).mockRejectedValue(apiError(422, 'admin_from_environment'));
    renderWithProviders(<AdminUsersPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Remover admin: bia@example.com' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Este admin vem de ADMIN_EMAILS',
    );
    expect(setUserAdmin).toHaveBeenCalledWith('u2', false);
  });

  it('searches and filters', async () => {
    renderWithProviders(<AdminUsersPage />);
    await screen.findAllByRole('listitem');
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Buscar por nome ou e-mail' }),
      {
        target: { value: '  ana ' },
      },
    );
    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'BLOCKED' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() =>
      expect(listUsers).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        q: 'ana',
        status: 'BLOCKED',
      }),
    );
  });
});

describe('AdminSettingsPage', () => {
  beforeEach(() => {
    vi.mocked(getSettings).mockResolvedValue({ values: settings, definitions: [] });
  });

  it('turns features on and off and saves', async () => {
    vi.mocked(updateSettings).mockResolvedValue({
      values: { ...settings, 'signups.enabled': false },
      definitions: [],
    });
    renderWithProviders(<AdminSettingsPage />);
    const signups = await screen.findByRole('checkbox', {
      name: 'Aceitar novos cadastros',
    });
    expect(signups).toBeChecked();
    expect(signups).toHaveAccessibleDescription(/só quem já tem conta/);

    fireEvent.click(signups);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        ...settings,
        'signups.enabled': false,
      }),
    );
    expect(await screen.findByText('Configurações salvas.')).toBeInTheDocument();
  });

  it('edits prices and refuses invalid numbers before sending', async () => {
    // Like the API: answers with what was saved.
    vi.mocked(updateSettings).mockImplementation(async (changes) => ({
      values: { ...settings, ...changes },
      definitions: [],
    }));
    renderWithProviders(<AdminSettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar preço' }));
    fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: 'gpt-test' } });
    fireEvent.change(screen.getByLabelText('Entrada'), { target: { value: '2,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Confira os preços');
    expect(screen.getByLabelText('Entrada')).toHaveAttribute('aria-invalid', 'true');
    expect(updateSettings).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Entrada'), { target: { value: '2.50' } });
    fireEvent.change(screen.getByLabelText('Saída'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        ...settings,
        'usage.prices': [
          {
            kind: 'AI_CHAT',
            provider: 'OPENAI',
            model: 'gpt-test',
            input: '2.50',
            output: '10',
          },
        ],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remover preço de gpt-test' }));
    expect(screen.queryByLabelText('Modelo')).toBeNull();
  });
});
