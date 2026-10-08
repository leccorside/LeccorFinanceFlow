import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { MessageKey } from '../../i18n/catalog';
import { useI18n } from '../../i18n/context';
import {
  type DisconnectResult,
  disconnectGoogle,
  getGoogleConnection,
  googleConnectUrl,
} from '../../services/google';

export function GoogleConnectionCard({
  returnMessage,
}: {
  returnMessage: MessageKey | null;
}) {
  const { t, dateTime } = useI18n();
  const queryClient = useQueryClient();
  const connection = useQuery({
    queryKey: ['google-connection'],
    queryFn: getGoogleConnection,
  });
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<DisconnectResult | null>(null);

  const disconnect = useMutation({
    mutationFn: () => disconnectGoogle(),
    onSuccess: (outcome) => {
      setResult(outcome);
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['google-connection'] });
    },
  });

  const status = connection.data?.status;
  const isError = returnMessage !== null && returnMessage !== 'google.connectedNow';

  return (
    <section className="card" aria-labelledby="google-title">
      <h2 id="google-title">{t('google.title')}</h2>
      <p>{t('google.description')}</p>

      {returnMessage && (
        <p role={isError ? 'alert' : 'status'} className={isError ? 'alert' : 'notice'}>
          {t(returnMessage)}
        </p>
      )}

      {connection.isPending && <p role="status">{t('app.loading')}</p>}
      {connection.isError && <p role="alert">{t('google.error.load')}</p>}

      {status && (
        <>
          <p className="connection-status" data-status={status}>
            <span
              className={
                status === 'ACTIVE' ? 'status-dot status-dot--online' : 'status-dot'
              }
              aria-hidden="true"
            />
            {t(`google.status.${status}`)}
          </p>
          {status === 'ACTIVE' && connection.data && (
            <dl className="connection-details">
              <dt>{t('google.account')}</dt>
              <dd>{connection.data.googleEmail}</dd>
              {connection.data.connectedAt && (
                <>
                  <dt>{t('google.connectedAt')}</dt>
                  <dd>{dateTime(connection.data.connectedAt)}</dd>
                </>
              )}
            </dl>
          )}

          {status !== 'ACTIVE' && (
            <a className="button-primary" href={googleConnectUrl('/profile')}>
              {status === 'NEEDS_REAUTH' ? t('google.reconnect') : t('google.connect')}
            </a>
          )}

          {status === 'ACTIVE' && !confirming && (
            <button
              type="button"
              className="button-secondary"
              onClick={() => setConfirming(true)}
            >
              {t('google.disconnect')}
            </button>
          )}

          {confirming && (
            <div
              className="confirm-box"
              role="group"
              aria-labelledby="google-confirm-text"
            >
              <p id="google-confirm-text">{t('google.disconnectConfirm')}</p>
              <div className="choice-row">
                <button
                  type="button"
                  className="button-danger"
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate()}
                >
                  {t('google.disconnectConfirmButton')}
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setConfirming(false)}
                >
                  {t('google.cancel')}
                </button>
              </div>
            </div>
          )}

          {disconnect.isError && <p role="alert">{t('google.error.disconnect')}</p>}
          {result && (
            <p role="status" className="notice">
              {t(
                result.remoteRevocation === 'failed'
                  ? 'google.disconnectedLocalOnly'
                  : 'google.disconnected',
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
