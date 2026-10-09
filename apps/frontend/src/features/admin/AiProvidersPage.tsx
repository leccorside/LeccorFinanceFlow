import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import type { MessageKey } from '../../i18n/catalog';
import { useI18n } from '../../i18n/context';
import {
  AI_PURPOSES,
  type AiConfiguration,
  type AiProvider,
  type AiPurpose,
  createAiConfiguration,
  deleteAiConfiguration,
  listAiProviders,
  type ProbeResult,
  reorderAiConfigurations,
  setProviderActive,
  testAiConfiguration,
  updateAiConfiguration,
} from '../../services/aiProviders';
import { apiErrorOf } from '../../services/api';

const QUERY_KEY = ['ai-providers'];

const KNOWN_ERRORS = new Set([
  'ai_priority_taken',
  'ai_configuration_exists',
  'ai_configuration_conflict',
  'encryption_unavailable',
  'ai_purpose_not_supported',
  'ai_reorder_mismatch',
  'validation_failed',
]);

const KNOWN_REASONS = new Set([
  'timeout',
  'unavailable',
  'rate_limited',
  'credential_rejected',
  'model_not_found',
  'invalid_response',
  'invalid_request',
  'content_blocked',
  'not_configured',
  'credential_unreadable',
]);

function errorKey(error: unknown): MessageKey {
  const code = apiErrorOf(error)?.code;
  return code && KNOWN_ERRORS.has(code)
    ? (`admin.ai.error.${code}` as MessageKey)
    : 'admin.ai.error.unknown';
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
}

/** Administration of AI providers: models, priorities, keys (write-only) and tests. */
export function AiProvidersPage() {
  const { t } = useI18n();
  const providers = useQuery({ queryKey: QUERY_KEY, queryFn: listAiProviders });

  return (
    <section className="admin-page" aria-labelledby="ai-title">
      <h1 id="ai-title">{t('admin.ai.title')}</h1>
      <p>{t('admin.ai.subtitle')}</p>
      {providers.isPending && <p role="status">{t('app.loading')}</p>}
      {providers.isError && (
        <p role="alert" className="alert">
          {t(
            apiErrorOf(providers.error)?.code === 'forbidden'
              ? 'admin.ai.forbidden'
              : 'admin.ai.error.load',
          )}
        </p>
      )}
      {providers.data && (
        <>
          {providers.data.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
          <PriorityOrder providers={providers.data} />
        </>
      )}
    </section>
  );
}

function ProviderCard({ provider }: { provider: AiProvider }) {
  const { t } = useI18n();
  const refresh = useRefresh();
  const toggle = useMutation({
    mutationFn: () => setProviderActive(provider.id, !provider.isActive),
    onSettled: refresh,
  });
  const titleId = `provider-${provider.type}`;

  return (
    <section className="card" aria-labelledby={titleId}>
      <div className="card-header">
        <h2 id={titleId}>{provider.displayName}</h2>
        <span className="badge" data-active={provider.isActive}>
          {t(provider.isActive ? 'admin.ai.active' : 'admin.ai.inactive')}
        </span>
        <button
          type="button"
          className="link-button"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate()}
        >
          {t(provider.isActive ? 'admin.ai.deactivate' : 'admin.ai.activate')}
        </button>
      </div>
      {provider.hasEnvironmentKey && <p className="notice">{t('admin.ai.envKey')}</p>}

      {provider.configurations.length === 0 ? (
        <p>{t('admin.ai.noConfigurations')}</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">{t('admin.ai.column.purpose')}</th>
              <th scope="col">{t('admin.ai.column.model')}</th>
              <th scope="col">{t('admin.ai.column.priority')}</th>
              <th scope="col">{t('admin.ai.column.key')}</th>
              <th scope="col">{t('admin.ai.column.status')}</th>
              <th scope="col">{t('admin.ai.column.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {provider.configurations.map((configuration) => (
              <ConfigurationRow
                key={configuration.id}
                provider={provider}
                configuration={configuration}
              />
            ))}
          </tbody>
        </table>
      )}
      <AddConfiguration provider={provider} />
    </section>
  );
}

function ConfigurationRow({
  provider,
  configuration,
}: {
  provider: AiProvider;
  configuration: AiConfiguration;
}) {
  const { t } = useI18n();
  const refresh = useRefresh();
  const [newKey, setNewKey] = useState('');
  const [result, setResult] = useState<ProbeResult | null>(null);
  const label = `${provider.displayName} · ${t(`admin.ai.purpose.${configuration.purpose}`)}`;

  const update = useMutation({
    mutationFn: (input: { isActive?: boolean; apiKey?: string | null }) =>
      updateAiConfiguration(configuration.id, input),
    onSuccess: () => setNewKey(''),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => deleteAiConfiguration(configuration.id),
    onSettled: refresh,
  });
  const probe = useMutation({
    mutationFn: () => testAiConfiguration(configuration.id),
    onSuccess: setResult,
  });

  const reason = (code: string | null) =>
    t(
      code && KNOWN_REASONS.has(code)
        ? (`admin.ai.reason.${code}` as MessageKey)
        : 'admin.ai.reason.unknown',
    );

  return (
    <tr>
      <td>{t(`admin.ai.purpose.${configuration.purpose}`)}</td>
      <td>
        <code>{configuration.model}</code>
      </td>
      <td>{configuration.priority}</td>
      <td>
        {t(`admin.ai.key.${configuration.keySource}`)}
        <form
          className="inline-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (newKey.trim()) update.mutate({ apiKey: newKey.trim() });
          }}
        >
          <label className="visually-hidden" htmlFor={`key-${configuration.id}`}>
            {t('admin.ai.replaceKey')} — {label}
          </label>
          <input
            id={`key-${configuration.id}`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('admin.ai.replaceKey')}
            value={newKey}
            onChange={(event) => setNewKey(event.target.value)}
          />
          <button type="submit" disabled={!newKey.trim() || update.isPending}>
            {t('admin.ai.saveKey')}
          </button>
          {configuration.keySource === 'stored' && (
            <button
              type="button"
              className="link-button"
              disabled={update.isPending}
              onClick={() => update.mutate({ apiKey: null })}
            >
              {t('admin.ai.removeKey')}
            </button>
          )}
        </form>
      </td>
      <td>{t(configuration.isActive ? 'admin.ai.active' : 'admin.ai.inactive')}</td>
      <td className="actions">
        <button
          type="button"
          disabled={probe.isPending}
          aria-label={`${t('admin.ai.test')} — ${label}`}
          onClick={() => probe.mutate()}
        >
          {probe.isPending ? t('admin.ai.testing') : t('admin.ai.test')}
        </button>
        <button
          type="button"
          className="link-button"
          disabled={update.isPending}
          onClick={() => update.mutate({ isActive: !configuration.isActive })}
        >
          {t(configuration.isActive ? 'admin.ai.deactivate' : 'admin.ai.activate')}
        </button>
        <button
          type="button"
          className="link-button danger"
          disabled={remove.isPending}
          aria-label={`${t('admin.ai.delete')} — ${label}`}
          onClick={() => remove.mutate()}
        >
          {t('admin.ai.delete')}
        </button>
        {result && (
          <p role="status" className={result.ok ? 'notice' : 'alert'}>
            {result.ok
              ? t('admin.ai.test.ok', { ms: result.latencyMs })
              : t('admin.ai.test.failed', { reason: reason(result.error) })}
          </p>
        )}
        {(update.isError || remove.isError) && (
          <p role="alert" className="alert">
            {t(errorKey(update.error ?? remove.error))}
          </p>
        )}
      </td>
    </tr>
  );
}

function AddConfiguration({ provider }: { provider: AiProvider }) {
  const { t } = useI18n();
  const refresh = useRefresh();
  const used = new Set(provider.configurations.map((item) => item.purpose));
  const available = provider.capabilities.filter((purpose) => !used.has(purpose));
  const [purpose, setPurpose] = useState<AiPurpose | ''>('');
  const [model, setModel] = useState(provider.defaultModel ?? '');
  const [apiKey, setApiKey] = useState('');
  const create = useMutation({
    mutationFn: () =>
      createAiConfiguration(provider.id, {
        purpose: (purpose || available[0]) as AiPurpose,
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      }),
    onSuccess: () => {
      setApiKey(''); // the key never stays in the page after it is sent
      setPurpose('');
    },
    onSettled: refresh,
  });

  if (available.length === 0) {
    return <p className="hint">{t('admin.ai.add.allUsed')}</p>;
  }
  const prefix = `add-${provider.type}`;
  return (
    <form
      className="admin-form"
      aria-label={`${t('admin.ai.add.title')} — ${provider.displayName}`}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (model.trim()) create.mutate();
      }}
    >
      <h3>{t('admin.ai.add.title')}</h3>
      <div className="field">
        <label htmlFor={`${prefix}-purpose`}>{t('admin.ai.column.purpose')}</label>
        <select
          id={`${prefix}-purpose`}
          value={purpose || available[0]}
          onChange={(event) => setPurpose(event.target.value as AiPurpose)}
        >
          {available.map((item) => (
            <option key={item} value={item}>
              {t(`admin.ai.purpose.${item}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-model`}>{t('admin.ai.column.model')}</label>
        <input
          id={`${prefix}-model`}
          value={model}
          required
          maxLength={100}
          spellCheck={false}
          onChange={(event) => setModel(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-key`}>{t('admin.ai.add.apiKey')}</label>
        <input
          id={`${prefix}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          aria-describedby={`${prefix}-key-hint`}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <small id={`${prefix}-key-hint`}>{t('admin.ai.add.apiKeyHint')}</small>
      </div>
      <button
        type="submit"
        className="button-primary"
        disabled={!model.trim() || create.isPending}
      >
        {t('admin.ai.add.submit')}
      </button>
      {create.isError && (
        <p role="alert" className="alert">
          {t(errorKey(create.error))}
        </p>
      )}
    </form>
  );
}

/** Fallback order per purpose, across providers: first is used, the others on failure. */
function PriorityOrder({ providers }: { providers: AiProvider[] }) {
  const { t } = useI18n();
  const refresh = useRefresh();
  const reorder = useMutation({
    mutationFn: ({ purpose, ids }: { purpose: AiPurpose; ids: string[] }) =>
      reorderAiConfigurations(purpose, ids),
    onSettled: refresh,
  });

  return (
    <section className="card" aria-labelledby="ai-order-title">
      <h2 id="ai-order-title">{t('admin.ai.order.title')}</h2>
      <p className="hint">{t('admin.ai.order.hint')}</p>
      {AI_PURPOSES.map((purpose) => {
        const items = providers
          .flatMap((provider) =>
            provider.configurations
              .filter((item) => item.purpose === purpose)
              .map((item) => ({ ...item, providerName: provider.displayName })),
          )
          .sort((a, b) => a.priority - b.priority);
        const move = (index: number, delta: number) => {
          const ids = items.map((item) => item.id);
          const [moved] = ids.splice(index, 1);
          ids.splice(index + delta, 0, moved as string);
          reorder.mutate({ purpose, ids });
        };
        return (
          <div key={purpose} className="order-group">
            <h3>{t(`admin.ai.purpose.${purpose}`)}</h3>
            {items.length === 0 ? (
              <p className="hint">{t('admin.ai.order.empty')}</p>
            ) : (
              <ol aria-label={t(`admin.ai.purpose.${purpose}`)}>
                {items.map((item, index) => (
                  <li key={item.id}>
                    <span>
                      {item.providerName} · <code>{item.model}</code>
                    </span>
                    <button
                      type="button"
                      disabled={index === 0 || reorder.isPending}
                      aria-label={t('admin.ai.order.up', { name: item.providerName })}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index === items.length - 1 || reorder.isPending}
                      aria-label={t('admin.ai.order.down', { name: item.providerName })}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
      {reorder.isError && (
        <p role="alert" className="alert">
          {t(errorKey(reorder.error))}
        </p>
      )}
    </section>
  );
}
