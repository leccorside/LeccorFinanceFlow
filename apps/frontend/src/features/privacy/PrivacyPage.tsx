import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MessageKey } from '../../i18n/catalog';
import { useI18n } from '../../i18n/context';
import { api } from '../../services/api';
import type { PendingConfirmation, ToolOutcome } from '../../services/assistant';
import {
  cancelDeletion,
  confirmDeletion,
  type DeletionScope,
  PRIVACY_EXPORT_URL,
  requestDeletion,
} from '../../services/privacy';
import { ConfirmationCard } from '../assistant/ConfirmationCard';
import { GoogleConnectionCard } from '../profile/GoogleConnectionCard';

const SCOPES: { scope: DeletionScope; title: MessageKey; text: MessageKey }[] = [
  {
    scope: 'conversations',
    title: 'privacy.delete.conversations',
    text: 'privacy.delete.conversationsText',
  },
  {
    scope: 'financial_data',
    title: 'privacy.delete.financial',
    text: 'privacy.delete.financialText',
  },
  {
    scope: 'account',
    title: 'privacy.delete.account',
    text: 'privacy.delete.accountText',
  },
];

const RETENTION: MessageKey[] = [
  'privacy.retention.own',
  'privacy.retention.reports',
  'privacy.retention.sessions',
  'privacy.retention.confirmations',
  'privacy.retention.usage',
  'privacy.retention.audit',
];

type Notice = { tone: 'ok' | 'error'; key: MessageKey } | null;

/**
 * The user's privacy rights in one place: download everything, disconnect Google, and
 * delete conversations, financial data or the whole account. Every deletion is a two-step
 * flow: the server prepares a confirmation and only the explicit "yes" button runs it.
 */
export function PrivacyPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState<
    (PendingConfirmation & { scope: DeletionScope }) | null
  >(null);
  const [notice, setNotice] = useState<Notice>(null);

  const ask = useMutation({
    mutationFn: (scope: DeletionScope) => requestDeletion(scope),
    onSuccess: (outcome, scope) => {
      if (outcome.status === 'confirmation_required') {
        setNotice(null);
        setPending({
          ...outcome.confirmation,
          tool: outcome.tool,
          conversationId: null,
          createdAt: new Date().toISOString(),
          scope,
        });
      } else {
        setNotice({ tone: 'error', key: 'privacy.error' });
      }
    },
    onError: () => setNotice({ tone: 'error', key: 'privacy.error' }),
  });

  const finish = (outcome: ToolOutcome, scope: DeletionScope) => {
    setPending(null);
    if (outcome.status !== 'ok') {
      setNotice({ tone: 'error', key: 'privacy.error' });
      return;
    }
    if (scope === 'account') {
      // The session no longer exists: forget everything cached and go to the landing page.
      api.resetSession();
      queryClient.clear();
      queryClient.setQueryData(['me'], null);
      void navigate('/?accountDeleted=1', { replace: true });
      return;
    }
    void queryClient.invalidateQueries();
    setNotice({
      tone: 'ok',
      key:
        scope === 'conversations'
          ? 'privacy.done.conversations'
          : 'privacy.done.financial',
    });
  };

  const confirm = useMutation({
    mutationFn: (target: { id: string; scope: DeletionScope }) =>
      confirmDeletion(target.id),
    onSuccess: (outcome, target) => finish(outcome, target.scope),
    onError: () => {
      setPending(null);
      setNotice({ tone: 'error', key: 'privacy.error' });
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelDeletion(id),
    onSettled: () => {
      setPending(null);
      setNotice({ tone: 'ok', key: 'privacy.cancelled' });
    },
  });

  const busy = ask.isPending || confirm.isPending || cancel.isPending;

  return (
    <div className="privacy-page">
      <header className="page-header">
        <h1>{t('privacy.title')}</h1>
        <p className="hint">{t('privacy.subtitle')}</p>
      </header>

      <section className="card" aria-labelledby="privacy-export">
        <h2 id="privacy-export">{t('privacy.export.title')}</h2>
        <p>{t('privacy.export.text')}</p>
        <a className="button-primary" href={PRIVACY_EXPORT_URL} download>
          {t('privacy.export.button')}
        </a>
      </section>

      <GoogleConnectionCard returnMessage={null} />

      <section className="card" aria-labelledby="privacy-delete">
        <h2 id="privacy-delete">{t('privacy.delete.title')}</h2>
        <p className="hint">{t('privacy.delete.hint')}</p>
        {notice && (
          <p
            className={notice.tone === 'ok' ? 'ok-text' : 'alert'}
            role={notice.tone === 'ok' ? 'status' : 'alert'}
          >
            {t(notice.key)}
          </p>
        )}
        {pending ? (
          <ConfirmationCard
            confirmation={pending}
            busy={busy}
            onConfirm={() => confirm.mutate({ id: pending.id, scope: pending.scope })}
            onCancel={() => cancel.mutate(pending.id)}
          />
        ) : (
          <ul className="privacy-deletions">
            {SCOPES.map((item) => (
              <li key={item.scope}>
                <div>
                  <h3>{t(item.title)}</h3>
                  <p className="hint">{t(item.text)}</p>
                </div>
                <button
                  type="button"
                  className="button-danger"
                  disabled={busy}
                  onClick={() => ask.mutate(item.scope)}
                >
                  {t(item.title)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="privacy-retention">
        <h2 id="privacy-retention">{t('privacy.retention.title')}</h2>
        <ul className="privacy-retention">
          {RETENTION.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
