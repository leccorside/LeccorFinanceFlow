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

/** Message box: grows with the text, Enter sends and Shift+Enter breaks the line. */
export function Composer({
  value,
  onChange,
  onSend,
  busy,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  busy: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useI18n();
  const hintId = useId();
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;
  const text = value.trim();
  const canSend = text.length > 0 && value.length <= MAX_MESSAGE && !busy;

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
          className="icon-button"
          disabled
          title={t('assistant.mic')}
          aria-label={t('assistant.mic')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
          </svg>
        </button>
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
      </div>
      <p id={hintId} className="composer-hint">
        {t('assistant.input.hint')}
        {value.length > MAX_MESSAGE * 0.8 && (
          <> · {t('assistant.input.count', { count: value.length, max: MAX_MESSAGE })}</>
        )}
      </p>
    </form>
  );
}
