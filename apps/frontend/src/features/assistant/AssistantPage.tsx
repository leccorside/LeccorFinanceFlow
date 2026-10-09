import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n/context';
import { apiErrorOf } from '../../services/api';
import { getProfile } from '../../services/profile';
import { getVoiceCapabilities, transcribe } from '../../services/voice';
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
import {
  candidateName,
  type ChatItem,
  errorKey,
  itemFromTurn,
  itemsFromHistory,
} from './chat-model';
import { Composer } from './Composer';
import { ConfirmationCard } from './ConfirmationCard';
import { ConversationPanel } from './ConversationPanel';
import { MessageItem } from './MessageItem';
import { useMediaQuery } from './motion';
import { recordingSupported, useRecorder } from './voice/useRecorder';
import { useSpeech } from './voice/useSpeech';
import { type OrbState, VoiceOrb } from './VoiceOrb';

const messagesKey = (id: string) => ['assistant', 'messages', id] as const;
const CONVERSATIONS_KEY = ['assistant', 'conversations'] as const;
const CONFIRMATIONS_KEY = ['assistant', 'confirmations'] as const;

let localIds = 0;
const localId = (prefix: string) => `${prefix}-${Date.now()}-${(localIds += 1)}`;

/** Replies stored by the API (local placeholders cannot be read aloud). */
const STORED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function MessageSkeleton() {
  return (
    <ul className="chat-list" aria-hidden="true">
      {['skeleton--right', 'skeleton--left', 'skeleton--left skeleton--short'].map(
        (cls) => (
          <li key={cls} className={`skeleton ${cls}`} />
        ),
      )}
    </ul>
  );
}

/**
 * The main experience: one conversation with the assistant, no financial forms. Messages
 * are kept in the query cache per conversation (live turns are appended there, so a reply
 * does not trigger a refetch that would cut its animation).
 */
export function AssistantPage({ firstName }: { firstName: string | null }) {
  const i18n = useI18n();
  const { t } = i18n;
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const conversationId = params.get('c');
  const wide = useMediaQuery('(min-width: 900px)');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [freshItems, setFreshItems] = useState<ChatItem[]>([]);
  /**
   * Synchronous mirror of freshItems: a reply can arrive before React re-renders (fast
   * answers, a voice message sent from another callback), and must not lose the message
   * that was just added.
   */
  const freshRef = useRef<ChatItem[]>([]);
  const setFresh = (next: ChatItem[]) => {
    freshRef.current = next;
    setFreshItems(next);
  };
  const [writingId, setWritingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ text: string; message: string } | null>(null);
  const [turnSuggestions, setTurnSuggestions] = useState<string[]>([]);
  const [statusNote, setStatusNote] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  /** Conversation just created by a reply: switching to it must not cut that reply. */
  const [adopted, setAdopted] = useState<string | null>(null);
  const [viewed, setViewed] = useState(conversationId);

  const history = useQuery({
    queryKey: messagesKey(conversationId ?? ''),
    queryFn: async () => itemsFromHistory(await getMessages(conversationId ?? '')),
    enabled: conversationId !== null,
    staleTime: Infinity,
  });
  const conversations = useQuery({
    queryKey: CONVERSATIONS_KEY,
    queryFn: listConversations,
  });
  const pending = useQuery({
    queryKey: CONFIRMATIONS_KEY,
    queryFn: listPendingConfirmations,
  });
  const suggestions = useQuery({
    queryKey: ['assistant', 'suggestions'],
    queryFn: getSuggestions,
    staleTime: 5 * 60_000,
  });

  const capabilities = useQuery({
    queryKey: ['voice', 'capabilities'],
    queryFn: getVoiceCapabilities,
    staleTime: 10 * 60_000,
  });
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const [voiceNote, setVoiceNote] = useState('');
  const speech = useSpeech({
    rate: profile.data?.voice.speakingRate ?? 1,
    onError: () => setVoiceNote(t('assistant.voice.speechFailed')),
  });
  const canSpeak = capabilities.data?.speech === true;

  const items = conversationId ? (history.data ?? []) : freshItems;

  // A different conversation starts quiet (state adjusted during render, as React advises).
  if (viewed !== conversationId) {
    setViewed(conversationId);
    setDrawerOpen(false);
    if (conversationId === null || conversationId !== adopted) {
      setWritingId(null);
      setFailure(null);
      setTurnSuggestions([]);
    }
  }

  const append = (target: string | null, added: ChatItem[]) => {
    if (target) {
      queryClient.setQueryData<ChatItem[]>(messagesKey(target), (old) => [
        ...(old ?? []),
        ...added,
      ]);
    } else {
      setFresh([...freshRef.current, ...added]);
    }
  };

  const remove = (target: string | null, id: string) => {
    if (target) {
      queryClient.setQueryData<ChatItem[]>(messagesKey(target), (old) =>
        (old ?? []).filter((item) => item.id !== id),
      );
    } else {
      setFresh(freshRef.current.filter((item) => item.id !== id));
    }
  };

  /** Shows a turn's reply (new conversation: moves the local messages into its cache). */
  const receive = (turn: AssistantTurn, from: string | null, byVoice = false) => {
    const reply = itemFromTurn(turn);
    if (
      canSpeak &&
      STORED_ID.test(turn.reply.id) &&
      (byVoice || profile.data?.voice.autoSpeak)
    ) {
      void speech.play(turn.reply.id);
    }
    if (from === null) {
      queryClient.setQueryData<ChatItem[]>(messagesKey(turn.conversationId), [
        ...freshRef.current,
        reply,
      ]);
      setFresh([]);
      setAdopted(turn.conversationId);
      setParams({ c: turn.conversationId });
    } else {
      append(from, [reply]);
    }
    setWritingId(reply.id);
    setTurnSuggestions(turn.suggestions);
    void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
    void queryClient.invalidateQueries({ queryKey: CONFIRMATIONS_KEY });
  };

  const send = useMutation({
    mutationFn: (vars: {
      text: string;
      target: string | null;
      tempId: string;
      byVoice?: boolean;
    }) =>
      sendMessage({
        message: vars.text,
        ...(vars.target ? { conversationId: vars.target } : {}),
      }),
    onMutate: ({ text, target, tempId }) => {
      setFailure(null);
      setStatusNote('');
      append(target, [
        { kind: 'user', id: tempId, content: text, createdAt: new Date().toISOString() },
      ]);
    },
    onSuccess: (turn, { target, byVoice }) => receive(turn, target, byVoice),
    onError: (error, { text, target, tempId }) => {
      remove(target, tempId);
      setDraft((current) => current || text);
      setFailure({ text, message: t(errorKey(apiErrorOf(error)?.code)) });
    },
  });

  const submit = (text: string, byVoice = false) => {
    if (send.isPending) return;
    if (!byVoice) setDraft('');
    send.mutate({ text, target: conversationId, tempId: localId('user'), byVoice });
  };

  // Voice: record → transcribe → the transcript goes to the assistant like typed text.
  const transcription = useMutation({
    mutationFn: transcribe,
    onMutate: () => {
      setFailure(null);
      setVoiceNote('');
    },
    onSuccess: ({ text }) => submit(text, true),
    // The recording is gone (never kept): the way forward is to speak again or type.
    onError: (error) =>
      setFailure({ text: '', message: t(errorKey(apiErrorOf(error)?.code)) }),
  });
  const maxAudioBytes = capabilities.data?.maxAudioBytes ?? Infinity;
  const recorder = useRecorder({
    maxSeconds: capabilities.data?.maxAudioSeconds ?? 120,
    onRecorded: (audio) => {
      if (audio.size > maxAudioBytes) {
        setFailure({ text: '', message: t('assistant.error.payload_too_large') });
        return;
      }
      transcription.mutate(audio);
    },
  });
  const startRecording = () => {
    speech.stop(); // never record the assistant's own voice
    setFailure(null);
    setVoiceNote('');
    void recorder.start();
  };
  const voiceAvailable =
    capabilities.data?.transcription === true && recordingSupported();

  const decide = useMutation({
    mutationFn: (vars: { id: string; conversation: string; accept: boolean }) =>
      vars.accept
        ? confirmInConversation(vars.conversation, vars.id)
        : cancelInConversation(vars.conversation, vars.id),
    onSuccess: (turn, { conversation }) => receive(turn, conversation, false),
    onError: (error, { conversation }) => {
      void queryClient.invalidateQueries({ queryKey: CONFIRMATIONS_KEY });
      append(conversation, [
        {
          kind: 'notice',
          id: localId('notice'),
          tone: 'error',
          content: apiErrorOf(error)?.message ?? t('assistant.sendError'),
          createdAt: new Date().toISOString(),
        },
      ]);
    },
  });

  const undo = useMutation({
    mutationFn: undoLastAction,
    onSuccess: (outcome) => {
      let content: string;
      let tone: 'info' | 'error' = 'info';
      if (outcome.status === 'ok') {
        const undone = (outcome.data as { undone?: { label?: string }[] }).undone ?? [];
        content = t('assistant.undo.done', {
          label:
            undone
              .map((entry) => entry.label)
              .filter(Boolean)
              .join(', ') || '—',
        });
      } else if ('error' in outcome && outcome.error === 'nothing_to_undo') {
        content = t('assistant.undo.nothing_to_undo');
      } else {
        tone = 'error';
        content = t('assistant.undo.failed', {
          reason: ('message' in outcome && outcome.message) || '—',
        });
      }
      setStatusNote(content);
      append(conversationId, [
        {
          kind: 'notice',
          id: localId('notice'),
          tone,
          content,
          createdAt: new Date().toISOString(),
        },
      ]);
    },
    onError: (error) => {
      const content = t('assistant.undo.failed', {
        reason: apiErrorOf(error)?.message ?? '—',
      });
      setStatusNote(content);
      append(conversationId, [
        {
          kind: 'notice',
          id: localId('notice'),
          tone: 'error',
          content,
          createdAt: new Date().toISOString(),
        },
      ]);
    },
  });

  const confirmations = (pending.data ?? []).filter(
    (item) => conversationId !== null && item.conversationId === conversationId,
  );
  const busy = send.isPending || decide.isPending || transcription.isPending;
  const lastItem = items.at(-1);
  const lastFailed = lastItem?.kind === 'assistant' && lastItem.failed === true;
  const recording = recorder.status === 'recording';
  const orbState: OrbState = recording
    ? 'listening'
    : transcription.isPending
      ? 'transcribing'
      : send.isPending || decide.isPending
        ? 'thinking'
        : speech.speakingId || writingId
          ? 'speaking'
          : failure || lastFailed || recorder.error
            ? 'error'
            : 'idle';
  // Real spectrum: the microphone while listening, the voice while it speaks.
  const orbAnalyser = recording ? recorder.analyser : speech.analyser;
  const loadingHistory = conversationId !== null && history.isPending;
  const empty = !loadingHistory && !history.isError && items.length === 0;
  const chips = empty ? (suggestions.data ?? []) : turnSuggestions.slice(0, 3);

  const onWritten = (id: string) =>
    setWritingId((current) => (current === id ? null : current));

  const pickCandidate = (record: Record<string, unknown>) => {
    const name = candidateName(record);
    const id = typeof record.id === 'string' ? record.id : '';
    submit(t('assistant.candidates.message', { name, id }));
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    toggleRef.current?.focus();
  };

  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') recorder.cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recording, recorder]);

  // Escape closes the drawer and gives focus back to its button.
  useEffect(() => {
    if (!drawerOpen || wide) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDrawerOpen(false);
      toggleRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, wide]);

  const greeting = firstName
    ? t('assistant.greeting', { name: firstName })
    : t('assistant.greetingAnonymous');

  return (
    <div
      className="assistant-layout"
      data-drawer={drawerOpen && !wide ? 'open' : 'closed'}
    >
      <ConversationPanel
        id={panelId}
        conversations={conversations}
        activeId={conversationId}
        hidden={!wide && !drawerOpen}
        onNavigate={() => setDrawerOpen(false)}
      />
      {drawerOpen && !wide && (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label={t('assistant.closeConversations')}
          onClick={closeDrawer}
        />
      )}

      <section className="chat" aria-labelledby={`${panelId}-title`}>
        <h1 id={`${panelId}-title`} className="visually-hidden">
          {t('assistant.title')}
        </h1>
        <header className="chat-header">
          {!wide && (
            <button
              ref={toggleRef}
              type="button"
              className="icon-button"
              aria-expanded={drawerOpen}
              aria-controls={panelId}
              aria-label={
                drawerOpen
                  ? t('assistant.closeConversations')
                  : t('assistant.openConversations')
              }
              onClick={() => setDrawerOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z" />
              </svg>
            </button>
          )}
          <div className="chat-presence">
            <AnimatePresence initial={false}>
              {!empty && (
                <motion.span
                  key="mini-orb"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                >
                  <VoiceOrb state={orbState} size={44} analyser={orbAnalyser} />
                </motion.span>
              )}
            </AnimatePresence>
            <div>
              <span className="chat-presence-name">{t('assistant.name')}</span>
              <span className="chat-presence-state" role="status" data-state={orbState}>
                {loadingHistory
                  ? t('assistant.loadingMessages')
                  : t(`assistant.state.${orbState}`)}
              </span>
            </div>
          </div>
          {speech.speakingId && (
            <button
              type="button"
              className="icon-button icon-button--live"
              aria-label={t('assistant.listenStop')}
              title={t('assistant.listenStop')}
              onClick={speech.stop}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="7" y="7" width="10" height="10" rx="2" />
              </svg>
            </button>
          )}
          <button
            type="button"
            className="ghost-button"
            disabled={undo.isPending || busy}
            onClick={() => undo.mutate()}
            title={t('assistant.undoLabel')}
            aria-label={t('assistant.undoLabel')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62A7.95 7.95 0 0 1 12.5 10.5c3.54 0 6.55 2.31 7.6 5.5l2.37-.78A10.5 10.5 0 0 0 12.5 8Z" />
            </svg>
            <span className="ghost-button-text">{t('assistant.undo')}</span>
          </button>
        </header>

        <div className="visually-hidden" aria-live="polite">
          {statusNote}
        </div>

        <div className="chat-scroll">
          <div className="chat-scroll-inner">
            {empty && (
              <motion.div
                className="chat-hero"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45 }}
              >
                <VoiceOrb
                  state={orbState}
                  size={wide ? 240 : 180}
                  analyser={orbAnalyser}
                  className="voice-orb--hero"
                />
                <h2 className="chat-hero-title">{greeting}</h2>
                <p className="chat-hero-intro">{t('assistant.intro')}</p>
              </motion.div>
            )}

            {loadingHistory && <MessageSkeleton />}

            {history.isError && (
              <div className="alert chat-alert" role="alert">
                <p>
                  {apiErrorOf(history.error)?.code === 'not_found'
                    ? t('assistant.error.not_found')
                    : t('assistant.loadError')}
                </p>
                <div className="alert-actions">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void history.refetch()}
                  >
                    {t('assistant.retry')}
                  </button>
                  <Link to="/" className="button-secondary">
                    {t('assistant.newConversation')}
                  </Link>
                </div>
              </div>
            )}

            {items.length > 0 && (
              <ul className="chat-list" role="log" aria-label={t('assistant.log')}>
                {items.map((item) => (
                  <MessageItem
                    key={item.id}
                    item={item}
                    animate={item.id === writingId}
                    onWritten={onWritten}
                    onPickCandidate={pickCandidate}
                    disabled={busy}
                    speech={
                      canSpeak && STORED_ID.test(item.id)
                        ? {
                            speaking: speech.speakingId === item.id,
                            loading: speech.loadingId === item.id,
                            onToggle: () =>
                              speech.speakingId === item.id
                                ? speech.stop()
                                : void speech.play(item.id),
                          }
                        : null
                    }
                  />
                ))}
                {send.isPending && (
                  <li className="chat-row chat-row--assistant">
                    <div className="bubble bubble--assistant bubble--thinking">
                      <span className="thinking-dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                      <span className="visually-hidden">
                        {t('assistant.state.thinking')}
                      </span>
                    </div>
                  </li>
                )}
              </ul>
            )}

            {confirmations.map((confirmation) => (
              <ConfirmationCard
                key={confirmation.id}
                confirmation={confirmation}
                busy={decide.isPending}
                onConfirm={() =>
                  decide.mutate({
                    id: confirmation.id,
                    conversation: confirmation.conversationId ?? '',
                    accept: true,
                  })
                }
                onCancel={() =>
                  decide.mutate({
                    id: confirmation.id,
                    conversation: confirmation.conversationId ?? '',
                    accept: false,
                  })
                }
              />
            ))}
          </div>
        </div>

        <footer className="chat-footer">
          {failure && (
            <div className="alert chat-alert" role="alert">
              <p>{failure.message}</p>
              {failure.text && (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => {
                    setDraft('');
                    send.mutate({
                      text: failure.text,
                      target: conversationId,
                      tempId: localId('user'),
                    });
                  }}
                >
                  {t('assistant.retry')}
                </button>
              )}
            </div>
          )}
          {recorder.error && (
            <div className="alert chat-alert" role="alert">
              <p>{t(`assistant.voice.${recorder.error}`)}</p>
              <button
                type="button"
                className="button-secondary"
                onClick={recorder.clearError}
              >
                {t('assistant.voice.dismiss')}
              </button>
            </div>
          )}
          {voiceNote && (
            <p className="voice-note" role="status">
              {voiceNote}
            </p>
          )}
          {chips.length > 0 && !busy && !recording && (
            <ul className="suggestion-chips" aria-label={t('assistant.suggestions')}>
              {chips.map((suggestion) => (
                <li key={suggestion}>
                  <button type="button" onClick={() => submit(suggestion)}>
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={submit}
            busy={busy}
            inputRef={inputRef}
            voice={{
              available: voiceAvailable,
              unavailableReason: !recordingSupported()
                ? t('assistant.mic.unsupported')
                : capabilities.data && !capabilities.data.transcription
                  ? t('assistant.mic.unavailable')
                  : null,
              status: transcription.isPending ? 'transcribing' : recorder.status,
              elapsed: recorder.elapsed,
              maxSeconds: capabilities.data?.maxAudioSeconds ?? 120,
              onStart: startRecording,
              onStop: recorder.stop,
              onCancel: recorder.cancel,
            }}
          />
        </footer>
      </section>
    </div>
  );
}
