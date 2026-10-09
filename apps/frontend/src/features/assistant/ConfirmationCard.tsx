import { motion } from 'framer-motion';
import { useEffect, useId, useState } from 'react';
import { useI18n } from '../../i18n/context';
import type { PendingConfirmation } from '../../services/assistant';
import { describeRecord, toolLabel } from './chat-model';

function remaining(expiresAt: string, now: number): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

/**
 * A destructive action waiting for the user's explicit "yes", with what will happen and a
 * live countdown. The buttons call the API directly: the model can never confirm.
 */
export function ConfirmationCard({
  confirmation,
  busy,
  onConfirm,
  onCancel,
}: {
  confirmation: PendingConfirmation;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const titleId = useId();
  const [now, setNow] = useState(() => Date.now());
  const seconds = remaining(confirmation.expiresAt, now);
  const expired = seconds === 0;

  useEffect(() => {
    if (expired) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expired]);

  const rows = describeRecord(i18n, confirmation.summary);
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <motion.section
      className="confirm-card"
      aria-labelledby={titleId}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="confirm-card-glow" aria-hidden="true" />
      <h2 id={titleId}>
        {t('assistant.confirm.title', { action: toolLabel(t, confirmation.tool) })}
      </h2>
      {rows.length > 0 && (
        <dl className="confirm-details">
          {rows.map((row) => (
            <div key={row.key}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className={expired ? 'confirm-timer confirm-timer--expired' : 'confirm-timer'}>
        {expired
          ? t('assistant.confirm.expired')
          : t('assistant.confirm.expiresIn', { time })}
      </p>
      <div className="confirm-actions">
        <button
          type="button"
          className="button-danger"
          disabled={busy || expired}
          onClick={onConfirm}
        >
          {t('assistant.confirm.yes')}
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          {t('assistant.confirm.no')}
        </button>
      </div>
    </motion.section>
  );
}
