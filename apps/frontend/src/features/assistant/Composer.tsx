import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
} from 'react';
import { useI18n } from '../../i18n/context';

export const MAX_MESSAGE = 2000;

export type VoiceInputStatus = 'idle' | 'requesting' | 'recording' | 'transcribing';

export interface VoiceInput {
  /** Server transcription on and the browser can record. */
  available: boolean;
  /** Why the microphone is off (shown as its label), when not available. */
  unavailableReason: string | null;
  status: VoiceInputStatus;
  elapsed: number;
  maxSeconds: number;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
    </svg>
  );
}

/**
 * Message box: grows with the text, Enter sends and Shift+Enter breaks the line. While the
 * box is empty the microphone is the main action (voice first, above all on phones); while
 * recording, the box turns into the recording strip with "stop and send" and "discard".
 */
export function Composer({
  value,
  onChange,
  onSend,
  busy,
  inputRef,
  voice,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  busy: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  voice: VoiceInput;
}) {
  const { t } = useI18n();
  const hintId = useId();
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;
  const text = value.trim();
  const canSend = text.length > 0 && value.length <= MAX_MESSAGE && !busy;
  const recording = voice.status === 'recording';
  const voiceFirst = voice.available && text.length === 0;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [value, ref]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (canSend) onSend(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  if (recording) {
    return (
      <div className="composer composer--recording">
        <div className="recording-strip">
          <span className="recording-dot" aria-hidden="true" />
          <span className="recording-label">{t('assistant.state.listening')}</span>
          <span className="recording-bars" aria-hidden="true">
            {Array.from({ length: 12 }, (_, index) => (
              <span key={index} />
            ))}
          </span>
          <span className="recording-time">
            <span aria-hidden="true">
              {clock(voice.elapsed)} / {clock(voice.maxSeconds)}
            </span>
          </span>
        </div>
        <div className="composer-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={t('assistant.mic.cancel')}
            title={t('assistant.mic.cancel')}
            onClick={voice.onCancel}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z" />
            </svg>
          </button>
          <button
            type="button"
            className="mic-button mic-button--primary mic-button--live"
            aria-label={t('assistant.mic.stop')}
            aria-pressed="true"
            // Focus follows the control that replaced the text box.
            autoFocus
            onClick={voice.onStop}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="2" />
            </svg>
          </button>
        </div>
        <p className="composer-hint">{t('assistant.mic.hint')}</p>
      </div>
    );
  }

  const micLabel = !voice.available
    ? (voice.unavailableReason ?? t('assistant.mic'))
    : voice.status === 'transcribing'
      ? t('assistant.state.transcribing')
      : t('assistant.mic');

  return (
    <form className="composer" onSubmit={submit}>
      <label className="visually-hidden" htmlFor={`${hintId}-input`}>
        {t('assistant.input.label')}
      </label>
      <textarea
        id={`${hintId}-input`}
        ref={ref}
        rows={1}
        value={value}
        maxLength={MAX_MESSAGE}
        placeholder={t('assistant.input.placeholder')}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="composer-actions">
        <button
          type="button"
          className={voiceFirst ? 'mic-button mic-button--primary' : 'mic-button'}
          disabled={!voice.available || busy || voice.status !== 'idle'}
          title={micLabel}
          aria-label={micLabel}
          aria-pressed="false"
          onClick={voice.onStart}
        >
          <MicIcon />
        </button>
        {!voiceFirst && (
          <button
            type="submit"
            className="send-button"
            disabled={!canSend}
            aria-label={t('assistant.send')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3.4 20.4 21 12 3.4 3.6 3.39 10.2 15 12 3.39 13.8Z" />
            </svg>
          </button>
        )}
      </div>
      <p id={hintId} className="composer-hint">
        {voice.available ? t('assistant.input.hintVoice') : t('assistant.input.hint')}
        {value.length > MAX_MESSAGE * 0.8 && (
          <> · {t('assistant.input.count', { count: value.length, max: MAX_MESSAGE })}</>
        )}
      </p>
    </form>
  );
}
