import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { isMessageKey } from '../../i18n/catalog';
import { useI18n } from '../../i18n/context';
import {
  type AdminOverview,
  type AuditEvent,
  getAudit,
  getOverview,
  type VoiceChainStatus,
} from '../../services/admin';

function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'attention';
}) {
  return (
    <div className={tone ? `stat-card stat-card--${tone}` : 'stat-card'}>
      <dt>{label}</dt>
      <dd>
        <span className="stat-value">{value}</span>
        {detail && <span className="stat-detail">{detail}</span>}
      </dd>
    </div>
  );
}

function VoiceChain({ title, chain }: { title: string; chain: VoiceChainStatus }) {
  const { t } = useI18n();
  return (
    <div className="admin-voice-chain">
      <h3>
        {title}{' '}
        <span className={chain.enabled ? 'badge badge--on' : 'badge badge--off'}>
          {chain.enabled ? t('admin.voice.on') : t('admin.voice.off')}
        </span>
      </h3>
      {chain.providers.length === 0 ? (
        <p className="hint">{t('admin.voice.none')}</p>
      ) : (
        <ol>
          {chain.providers.map((provider) => (
            <li key={provider.provider}>
              <strong>{provider.provider}</strong> ·{' '}
              {provider.model ?? t('admin.voice.defaultModel')} ·{' '}
              <span className={provider.keyConfigured ? 'ok-text' : 'danger-text'}>
                {provider.keyConfigured ? t('admin.voice.key') : t('admin.voice.noKey')}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Who changed what: status, admin role and settings. Only e-mails and keys, never values. */
function AuditTrail() {
  const { t, dateTime } = useI18n();
  const audit = useQuery({ queryKey: ['admin', 'audit'], queryFn: getAudit });

  const describe = (event: AuditEvent): string => {
    if (event.action === 'user.status') {
      const statusKey = `admin.users.status.${String(event.details.status)}`;
      return t('admin.audit.status', {
        target: event.target ?? t('admin.audit.removed'),
        status: isMessageKey(statusKey) ? t(statusKey) : String(event.details.status),
      });
    }
    if (event.action === 'user.admin') {
      return t(event.details.admin ? 'admin.audit.promoted' : 'admin.audit.demoted', {
        target: event.target ?? t('admin.audit.removed'),
      });
    }
    if (event.action === 'settings.update') {
      const keys = Array.isArray(event.details.keys) ? event.details.keys : [];
      return t('admin.audit.settings', { keys: keys.join(', ') });
    }
    return event.action;
  };

  return (
    <section className="card" aria-labelledby="admin-audit">
      <h2 id="admin-audit">{t('admin.audit.title')}</h2>
      {audit.isPending ? (
        <p role="status">{t('app.loading')}</p>
      ) : audit.isError ? (
        <p className="alert" role="alert">
          {t('admin.loadError')}
        </p>
      ) : audit.data.length === 0 ? (
        <p className="hint">{t('admin.audit.empty')}</p>
      ) : (
        <ol className="admin-audit">
          {audit.data.map((event) => (
            <li key={event.id}>
              <span>{describe(event)}</span>
              <span className="hint">
                {event.actor ?? t('admin.audit.removed')} · {dateTime(event.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Platform counters, consumption with estimated cost and voice status. No secrets shown. */
export function AdminOverviewPage() {
  const { t, locale } = useI18n();
  const titleId = useId();
  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: getOverview });
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const usd = (value: string) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 6,
    }).format(value as unknown as number);

  if (overview.isPending) return <p role="status">{t('app.loading')}</p>;
  if (overview.isError) {
    return (
      <div className="alert" role="alert">
        <p>{t('admin.loadError')}</p>
        <button
          type="button"
          className="button-secondary"
          onClick={() => void overview.refetch()}
        >
          {t('admin.retry')}
        </button>
      </div>
    );
  }
  const data: AdminOverview = overview.data;
  const days = data.windowDays;

  return (
    <div className="admin-page">
      <header className="page-header">
        <h1>{t('admin.overview.title')}</h1>
        <p className="hint">{t('admin.overview.window', { days })}</p>
      </header>
      <dl className="stat-grid">
        <Stat
          label={t('admin.stat.users')}
          value={number(data.users.total)}
          detail={`${t('admin.stat.usersDetail', {
            active: number(data.users.active),
            blocked: number(data.users.blocked),
            admins: number(data.users.admins),
          })} · ${t('admin.stat.newUsers', { count: number(data.users.newInWindow), days })}`}
        />
        <Stat
          label={t('admin.stat.google')}
          value={number(data.google.connected)}
          detail={t('admin.stat.googleDetail', {
            reauth: number(data.google.needsReauth),
            revoked: number(data.google.revoked),
          })}
        />
        <Stat
          label={t('admin.stat.spreadsheets')}
          value={number(data.spreadsheets.total)}
          detail={t('admin.stat.spreadsheetsDetail', {
            active: number(data.spreadsheets.active),
          })}
        />
        <Stat
          label={t('admin.stat.assistant')}
          value={number(data.assistant.messagesInWindow)}
          detail={
            data.assistant.enabled
              ? t('admin.stat.assistantDetail', {
                  conversations: number(data.assistant.conversations),
                })
              : t('admin.stat.assistantPaused')
          }
          {...(data.assistant.enabled ? {} : { tone: 'attention' as const })}
        />
        <Stat
          label={t('admin.stat.reports')}
          value={number(data.reports.generatedInWindow)}
        />
        <Stat
          label={t('admin.stat.ai')}
          value={number(data.ai.activeProviders)}
          detail={t('admin.stat.aiDetail', {
            configurations: number(data.ai.activeConfigurations),
          })}
        />
        <Stat
          label={t('admin.stat.cost')}
          value={usd(data.usage.estimatedCostUsd)}
          detail={t('admin.stat.costDetail', { unpriced: number(data.usage.unpriced) })}
        />
      </dl>

      <section className="card" aria-labelledby={titleId}>
        <h2 id={titleId}>{t('admin.usage.title')}</h2>
        {data.usage.rows.length === 0 ? (
          <p className="hint">{t('admin.usage.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">{t('admin.usage.kind')}</th>
                  <th scope="col">{t('admin.usage.provider')}</th>
                  <th scope="col">{t('admin.usage.model')}</th>
                  <th scope="col">{t('admin.usage.requests')}</th>
                  <th scope="col">{t('admin.usage.failures')}</th>
                  <th scope="col">{t('admin.usage.input')}</th>
                  <th scope="col">{t('admin.usage.output')}</th>
                  <th scope="col">{t('admin.usage.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {data.usage.rows.map((row) => {
                  const kindKey = `admin.usage.kind.${row.kind}`;
                  return (
                    <tr key={`${row.kind}-${row.provider}-${row.model}`}>
                      <td>{isMessageKey(kindKey) ? t(kindKey) : row.kind}</td>
                      <td>{row.provider}</td>
                      <td>{row.model}</td>
                      <td className="num">{number(row.requests)}</td>
                      <td className={row.failures > 0 ? 'num danger-text' : 'num'}>
                        {number(row.failures)}
                      </td>
                      <td className="num">{number(row.inputUnits)}</td>
                      <td className="num">{number(row.outputUnits)}</td>
                      <td className="num">
                        {row.estimatedCostUsd === null ? (
                          <span className="hint">{t('admin.usage.noPrice')}</span>
                        ) : (
                          usd(row.estimatedCostUsd)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">{t('admin.usage.note')}</p>
      </section>

      <section className="card" aria-labelledby={`${titleId}-voice`}>
        <h2 id={`${titleId}-voice`}>{t('admin.voice.title')}</h2>
        <div className="admin-voice">
          <VoiceChain
            title={t('admin.voice.transcription')}
            chain={data.voice.transcription}
          />
          <VoiceChain title={t('admin.voice.speech')} chain={data.voice.speech} />
        </div>
        <p className="hint">{t('admin.voice.env')}</p>
      </section>

      <AuditTrail />
    </div>
  );
}
