import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/context';
import type { ConversationSummary } from '../../services/assistant';

/**
 * Conversation history. A fixed column on wide screens, a drawer on small ones (then
 * `hidden` takes it out of the tab order and of the accessibility tree while closed).
 */
export function ConversationPanel({
  id,
  conversations,
  activeId,
  hidden,
  onNavigate,
}: {
  id: string;
  conversations: UseQueryResult<ConversationSummary[]>;
  activeId: string | null;
  hidden: boolean;
  onNavigate: () => void;
}) {
  const { t, dateTime } = useI18n();
  const list = conversations.data ?? [];

  return (
    <aside
      id={id}
      className="conversation-panel"
      aria-label={t('assistant.conversations')}
      inert={hidden}
      data-hidden={hidden}
    >
      <Link to="/" className="new-conversation" onClick={onNavigate}>
        <span aria-hidden="true">＋</span> {t('assistant.newConversation')}
      </Link>
      <h2 className="panel-title">{t('assistant.conversations')}</h2>
      {conversations.isPending && (
        <ul className="conversation-list" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <li key={index} className="skeleton skeleton--line" />
          ))}
        </ul>
      )}
      {conversations.isError && (
        <div className="panel-error" role="alert">
          <p>{t('assistant.loadError')}</p>
          <button
            type="button"
            className="link-button"
            onClick={() => void conversations.refetch()}
          >
            {t('assistant.retry')}
          </button>
        </div>
      )}
      {conversations.isSuccess && list.length === 0 && (
        <p className="panel-empty">{t('assistant.noConversations')}</p>
      )}
      {list.length > 0 && (
        <ul className="conversation-list">
          {list.map((conversation) => (
            <li key={conversation.id}>
              <Link
                to={`/?c=${conversation.id}`}
                aria-current={conversation.id === activeId ? 'page' : undefined}
                onClick={onNavigate}
              >
                <span className="conversation-title">
                  {conversation.title ?? t('assistant.untitled')}
                </span>
                <time dateTime={conversation.updatedAt}>
                  {dateTime(conversation.updatedAt)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
