import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import { afterEach, beforeEach, vi } from 'vitest';
import {
  type AssistantTurn,
  getSuggestions,
  listConversations,
  listPendingConfirmations,
  sendMessage,
} from '../../services/assistant';
import { getProfile, type Profile } from '../../services/profile';
import { getVoiceCapabilities, speak, transcribe } from '../../services/voice';
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
vi.mock('../../services/voice', () => ({
  getVoiceCapabilities: vi.fn(),
  transcribe: vi.fn(),
  speak: vi.fn(),
}));
vi.mock('../../services/profile', () => ({ getProfile: vi.fn() }));

const CONVERSATION = '6f0f7d55-7d0e-4c1b-9f43-5d8a5e9f0a11';
const REPLY_ID = '0192f000-0000-7000-8000-00000000abcd';

function profile(voice: Partial<Profile['voice']> = {}): Profile {
  return {
    email: 'ana@example.com',
    firstName: 'Ana',
    lastName: null,
    photoUrl: null,
    phone: null,
    locale: 'pt-BR',
    currency: 'BRL',
    timeZone: 'America/Sao_Paulo',
    preferences: { theme: 'dark', weekStartsOn: 'monday', confirmSimpleDeletes: true },
    voice: { gender: 'FEMALE', autoSpeak: false, speakingRate: 1.25, ...voice },
    updatedAt: null,
  };
}

function turn(content = 'Você gastou R$ 3.487,20 neste mês.'): AssistantTurn {
  return {
    conversationId: CONVERSATION,
    state: 'answered',
    reply: {
      id: REPLY_ID,
      content,
      provider: 'fake',
      createdAt: '2026-10-09T12:00:00.000Z',
    },
    actions: [{ tool: 'get_financial_summary', status: 'ok' }],
    confirmations: [],
    candidates: [],
    suggestions: [],
  };
}

function apiError(status: number, code: string) {
  return new AxiosError('failed', String(status), undefined, undefined, {
    status,
    data: { code, message: 'x', details: null, requestId: 'r', timestamp: 't' },
  } as AxiosResponse);
}

// ───────────── Browser audio fakes ─────────────

const tracks: { stop: ReturnType<typeof vi.fn> }[] = [];
const getUserMedia = vi.fn();

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (type: string) => type.startsWith('audio/webm');
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['voz'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

class FakeAudioContext {
  state = 'running';
  destination = {};
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  createAnalyser() {
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 128,
      getByteFrequencyData: vi.fn(),
      connect: vi.fn(),
    };
  }
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
  createMediaElementSource() {
    return { connect: vi.fn() };
  }
}

let now = 1_000_000;
const play = vi.fn(async () => undefined);
const pause = vi.fn();

function micButton() {
  return screen.getByRole('button', { name: 'Falar' });
}

async function record(seconds: number) {
  await waitFor(() => expect(micButton()).toBeEnabled());
  fireEvent.click(micButton());
  const stop = await screen.findByRole('button', { name: 'Parar e enviar' });
  now += seconds * 1000;
  return stop;
}

describe('voice in the chat', () => {
  beforeEach(() => {
    vi.mocked(listConversations).mockResolvedValue([]);
    vi.mocked(listPendingConfirmations).mockResolvedValue([]);
    vi.mocked(getSuggestions).mockResolvedValue([]);
    vi.mocked(getProfile).mockResolvedValue(profile());
    vi.mocked(getVoiceCapabilities).mockResolvedValue({
      transcription: true,
      speech: true,
      maxAudioBytes: 1_000_000,
      maxAudioSeconds: 120,
      audioTypes: ['audio/webm'],
    });
    vi.mocked(speak).mockResolvedValue(new Blob(['ID3'], { type: 'audio/mpeg' }));
    tracks.length = 0;
    FakeMediaRecorder.instances = [];
    getUserMedia.mockImplementation(async () => {
      const track = { stop: vi.fn() };
      tracks.push(track);
      return { getTracks: () => [track] };
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    HTMLMediaElement.prototype.play = play;
    HTMLMediaElement.prototype.pause = pause;
    URL.createObjectURL = vi.fn(() => 'blob:voice');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('puts the microphone first while the box is empty', async () => {
    renderWithProviders(<AssistantPage firstName="Ana" />);

    await waitFor(() => expect(micButton()).toBeEnabled());
    expect(micButton()).toHaveClass('mic-button--primary');
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Mensagem para o assistente' }),
      {
        target: { value: 'oi' },
      },
    );
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled();
    expect(micButton()).not.toHaveClass('mic-button--primary');
  });

  it('listens, interprets, executes and answers out loud (simulated end to end)', async () => {
    let finishTranscription: (value: {
      text: string;
      provider: string;
    }) => void = () => {};
    vi.mocked(transcribe).mockReturnValue(
      new Promise((resolve) => {
        finishTranscription = resolve;
      }),
    );
    vi.mocked(sendMessage).mockResolvedValue(turn());
    const { container } = renderWithProviders(<AssistantPage firstName="Ana" />);
    const orb = () => container.querySelector('canvas.voice-orb');

    const stop = await record(2);

    // Listening: mic opened with clean-up filters; orb and status follow.
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Ouvindo…');
    expect(orb()).toHaveAttribute('data-state', 'listening');
    expect(stop).toHaveAttribute('aria-pressed', 'true');
    expect(stop).toHaveFocus();

    fireEvent.click(stop);

    // Interpreting: the recording goes up once, and the microphone is released.
    await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
    const audio = vi.mocked(transcribe).mock.calls[0]?.[0] as Blob;
    expect(audio.type).toBe('audio/webm');
    expect(tracks[0]?.stop).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Interpretando…');
    expect(orb()).toHaveAttribute('data-state', 'transcribing');

    await act(async () =>
      finishTranscription({ text: 'quanto gastei este mês?', provider: 'openai' }),
    );

    // Executing: the transcript is a normal message (same rules, confirmations included).
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({ message: 'quanto gastei este mês?' }),
    );
    expect(await screen.findByText('quanto gastei este mês?')).toBeInTheDocument();

    // Answering out loud, at the profile's speed.
    await waitFor(() => expect(speak).toHaveBeenCalledWith(REPLY_ID));
    await waitFor(() => expect(play).toHaveBeenCalled());
    const element = play.mock.contexts[0] as HTMLAudioElement;
    expect(element.playbackRate).toBe(1.25);
    expect(orb()).toHaveAttribute('data-state', 'speaking');
    expect(
      await screen.findByRole('button', { name: 'Parar a fala', pressed: true }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Parar a fala' })[0] as HTMLElement,
    );
    expect(pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:voice');
  });

  it('explains a blocked microphone and keeps the text path open', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    vi.mocked(sendMessage).mockResolvedValue(turn('Oi!'));
    renderWithProviders(<AssistantPage firstName={null} />);

    await waitFor(() => expect(micButton()).toBeEnabled());
    fireEvent.click(micButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O microfone foi bloqueado. Libere o acesso nas configurações do navegador ou continue escrevendo.',
    );
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Mensagem para o assistente' }),
      {
        target: { value: 'oi' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ message: 'oi' }));
  });

  it('turns the microphone off with the reason when voice is not possible', async () => {
    vi.mocked(getVoiceCapabilities).mockResolvedValue({
      transcription: false,
      speech: false,
      maxAudioBytes: 1,
      maxAudioSeconds: 1,
      audioTypes: [],
    });
    const view = renderWithProviders(<AssistantPage firstName={null} />);
    expect(
      await screen.findByRole('button', {
        name: 'Voz indisponível neste ambiente. Use o texto.',
      }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument();
    view.unmount();

    vi.unstubAllGlobals(); // no MediaRecorder
    renderWithProviders(<AssistantPage firstName={null} />);
    expect(
      await screen.findByRole('button', {
        name: 'Este navegador não grava áudio. Use o texto.',
      }),
    ).toBeDisabled();
  });

  it('falls back to text when the voice service is down (the audio is not kept)', async () => {
    vi.mocked(transcribe).mockRejectedValue(apiError(503, 'voice_unavailable'));
    renderWithProviders(<AssistantPage firstName={null} />);

    fireEvent.click(await record(2));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'A voz não respondeu agora. Continue por texto e tente de novo depois.',
    );
    expect(within(alert).queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(micButton()).toBeEnabled());
  });

  it('refuses a tap that is too short and audio above the size limit, without uploading', async () => {
    vi.mocked(getVoiceCapabilities).mockResolvedValue({
      transcription: true,
      speech: true,
      maxAudioBytes: 2,
      maxAudioSeconds: 120,
      audioTypes: ['audio/webm'],
    });
    renderWithProviders(<AssistantPage firstName={null} />);

    fireEvent.click(await record(0.2));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A gravação ficou curta demais.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Entendi' }));

    fireEvent.click(await record(3));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A gravação passou do tamanho permitido.',
    );
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('discards the recording with Escape and releases the microphone', async () => {
    renderWithProviders(<AssistantPage firstName={null} />);
    await record(3);

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(micButton()).toBeInTheDocument());
    expect(tracks[0]?.stop).toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stops by itself at the maximum duration and sends what was said', async () => {
    vi.mocked(getVoiceCapabilities).mockResolvedValue({
      transcription: true,
      speech: false,
      maxAudioBytes: 1_000_000,
      maxAudioSeconds: 1,
      audioTypes: ['audio/webm'],
    });
    vi.mocked(transcribe).mockResolvedValue({ text: 'oi', provider: 'openai' });
    vi.mocked(sendMessage).mockResolvedValue(turn('Olá!'));
    renderWithProviders(<AssistantPage firstName={null} />);

    await record(1.5);

    await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ message: 'oi' }));
    // Speech is off in this environment: nothing is read aloud.
    expect(speak).not.toHaveBeenCalled();
  });

  it('reads typed answers aloud only when the profile asks for it', async () => {
    vi.mocked(sendMessage).mockResolvedValue(turn('Saldo ok.'));
    const quiet = renderWithProviders(<AssistantPage firstName={null} />);
    await waitFor(() => expect(micButton()).toBeEnabled());
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Mensagem para o assistente' }),
      {
        target: { value: 'saldo?' },
      },
    );
    fireEvent.keyDown(
      screen.getByRole('textbox', { name: 'Mensagem para o assistente' }),
      {
        key: 'Enter',
      },
    );
    await screen.findByText('Saldo ok.', { selector: '.visually-hidden' });
    expect(speak).not.toHaveBeenCalled();
    quiet.unmount();

    vi.mocked(getProfile).mockResolvedValue(profile({ autoSpeak: true }));
    renderWithProviders(<AssistantPage firstName={null} />);
    await waitFor(() => expect(micButton()).toBeEnabled());
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Mensagem para o assistente' }),
      {
        target: { value: 'saldo?' },
      },
    );
    fireEvent.keyDown(
      screen.getByRole('textbox', { name: 'Mensagem para o assistente' }),
      {
        key: 'Enter',
      },
    );
    await waitFor(() => expect(speak).toHaveBeenCalledWith(REPLY_ID));
  });

  it('replays a reply on demand and says so when it cannot be read aloud', async () => {
    vi.mocked(sendMessage).mockResolvedValue(turn('Feito.'));
    vi.mocked(speak).mockRejectedValue(apiError(503, 'voice_unavailable'));
    renderWithProviders(<AssistantPage firstName={null} />);
    await waitFor(() => expect(micButton()).toBeEnabled());
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Mensagem para o assistente' }),
      {
        target: { value: 'ok' },
      },
    );
    fireEvent.keyDown(
      screen.getByRole('textbox', { name: 'Mensagem para o assistente' }),
      {
        key: 'Enter',
      },
    );

    const listen = await screen.findByRole('button', { name: 'Ouvir resposta' });
    expect(listen).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(listen);

    await waitFor(() => expect(speak).toHaveBeenCalledWith(REPLY_ID));
    expect(
      await screen.findByText(
        'Não consegui ler a resposta em voz alta; ela está no chat.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Feito.', { selector: '.visually-hidden' }),
    ).toBeInTheDocument();
  });
});
