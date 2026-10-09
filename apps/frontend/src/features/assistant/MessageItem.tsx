import { motion } from 'framer-motion';
import { useI18n } from '../../i18n/context';
import {
  candidateName,
  type ChatItem,
  describeRecord,
  label,
  toolLabel,
} from './chat-model';
import { useTypewriter } from './motion';

interface MessageItemProps {
  item: ChatItem;
  /** The newest reply is written progressively (and makes the orb "speak"). */
  animate: boolean;
  onWritten: (id: string) => void;
  onPickCandidate: (record: Record<string, unknown>) => void;
  disabled: boolean;
}

/** Equalizer shown next to a reply while it is being written. */
function Equalizer() {
  return (
    <span className="eq" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function AssistantBubble({
  item,
  animate,
  onWritten,
  onPickCandidate,
  disabled,
}: MessageItemProps & { item: Extract<ChatItem, { kind: 'assistant' }> }) {
  const i18n = useI18n();
  const { t, dateTime } = i18n;
  const { visible, writing } = useTypewriter(item.content, animate, () =>
    onWritten(item.id),
  );
  const candidates = item.candidates ?? [];

  return (
    <article
      className={
        item.failed
          ? 'bubble bubble--assistant bubble--failed'
          : 'bubble bubble--assistant'
      }
      aria-label={t('assistant.name')}
    >
      <header className="bubble-meta">
        <span className="bubble-author">{t('assistant.name')}</span>
        {writing && <Equalizer />}
        <time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time>
      </header>
      {/* Screen readers get the whole answer once; the typing effect is visual only. */}
      <p className="visually-hidden">{item.content}</p>
      <p className="bubble-text" aria-hidden="true">
        {visible}
        {writing && <span className="caret" />}
      </p>
      {!writing && (item.actions?.length ?? 0) > 0 && (
        <ul className="action-chips">
          {item.actions?.map((action, index) => (
            <li
              key={`${action.tool}-${index}`}
              className={`action-chip action-chip--${action.status}`}
            >
              <span className="action-chip-dot" aria-hidden="true" />
              {toolLabel(t, action.tool)} · {label(t, 'assistant.action', action.status)}
              {action.sync && action.sync !== 'NO_SPREADSHEET' && (
                <> · {label(t, 'assistant.sync', action.sync)}</>
              )}
            </li>
          ))}
        </ul>
      )}
      {!writing && candidates.length > 0 && (
        <div className="candidates">
          <p className="candidates-title">{t('assistant.candidates.title')}</p>
          <ul>
            {candidates.map((candidate, index) => {
              const name = candidateName(candidate);
              const details = describeRecord(i18n, candidate).filter(
                (row) => row.key !== 'description' && row.key !== 'name',
              );
              return (
                <li key={typeof candidate.id === 'string' ? candidate.id : index}>
                  <button
                    type="button"
                    className="candidate"
                    disabled={disabled}
                    onClick={() => onPickCandidate(candidate)}
                  >
                    <strong>{name}</strong>
                    {details.length > 0 && (
                      <span>{details.map((row) => row.value).join(' · ')}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </article>
  );
}

export function MessageItem(props: MessageItemProps) {
  const { t, dateTime } = useI18n();
  const { item } = props;

  let content;
  if (item.kind === 'user') {
    content = (
      <article className="bubble bubble--user" aria-label={t('assistant.you')}>
        <header className="bubble-meta">
          <span className="bubble-author">{t('assistant.you')}</span>
          <time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time>
        </header>
        <p className="bubble-text">{item.content}</p>
      </article>
    );
  } else if (item.kind === 'assistant') {
    content = <AssistantBubble {...props} item={item} />;
  } else if (item.kind === 'tool') {
    content = (
      <p className={`tool-trace action-chip--${item.status ?? 'ok'}`}>
        <span className="action-chip-dot" aria-hidden="true" />
        {toolLabel(t, item.tool)}
        {item.status && <> · {label(t, 'assistant.action', item.status)}</>}
      </p>
    );
  } else {
    content = (
      <p className={`chat-notice chat-notice--${item.tone}`} role="status">
        {item.content}
      </p>
    );
  }

  return (
    <motion.li
      className={`chat-row chat-row--${item.kind}`}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {content}
    </motion.li>
  );
}
