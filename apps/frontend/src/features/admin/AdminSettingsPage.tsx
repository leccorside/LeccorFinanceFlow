import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import type { MessageKey } from '../../i18n/catalog';
import { useI18n } from '../../i18n/context';
import {
  getSettings,
  type PriceEntry,
  type SettingValues,
  type UsageKind,
  updateSettings,
} from '../../services/admin';

const PRICE = /^\d{1,6}(\.\d{1,6})?$/;
const KINDS: UsageKind[] = ['AI_CHAT', 'VOICE_SPEECH', 'VOICE_TRANSCRIPTION'];
type Toggle = Exclude<keyof SettingValues, 'usage.prices'>;
const TOGGLES: [Toggle, MessageKey, MessageKey | null][] = [
  ['signups.enabled', 'admin.settings.signups', 'admin.settings.signupsHint'],
  ['assistant.enabled', 'admin.settings.assistant', 'admin.settings.assistantHint'],
  ['voice.transcription.enabled', 'admin.settings.transcription', null],
  ['voice.speech.enabled', 'admin.settings.speech', null],
];

function SettingsForm({ initial }: { initial: SettingValues }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const idPrefix = useId();
  const [values, setValues] = useState<SettingValues>(initial);
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: (changes: SettingValues) => updateSettings(changes),
    onSuccess: (view) => {
      setValues(view.values);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  const prices = values['usage.prices'];
  const setPrices = (next: PriceEntry[]) =>
    setValues((current) => ({ ...current, 'usage.prices': next }));
  const editPrice = (index: number, patch: Partial<PriceEntry>) =>
    setPrices(prices.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const ok = prices.every(
      (entry) =>
        entry.provider.trim() &&
        entry.model.trim() &&
        PRICE.test(entry.input) &&
        PRICE.test(entry.output),
    );
    setInvalid(!ok);
    if (ok) save.mutate(values);
  };

  return (
    <form className="admin-settings" onSubmit={submit} noValidate>
      <fieldset className="card">
        <legend>{t('admin.settings.features')}</legend>
        {TOGGLES.map(([key, label, hint]) => (
          <div key={key} className="toggle-row">
            <label className="choice">
              <input
                type="checkbox"
                checked={values[key]}
                aria-describedby={hint ? `${idPrefix}-${key}` : undefined}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [key]: event.target.checked }))
                }
              />
              {t(label)}
            </label>
            {hint && (
              <small id={`${idPrefix}-${key}`} className="hint">
                {t(hint)}
              </small>
            )}
          </div>
        ))}
      </fieldset>

      <fieldset className="card">
        <legend>{t('admin.settings.prices')}</legend>
        <p className="hint">{t('admin.settings.pricesHint')}</p>
        {prices.map((entry, index) => {
          const id = `${idPrefix}-price-${index}`;
          return (
            <div key={index} className="price-row">
              <div className="field">
                <label htmlFor={`${id}-kind`}>{t('admin.settings.priceKind')}</label>
                <select
                  id={`${id}-kind`}
                  value={entry.kind}
                  onChange={(event) =>
                    editPrice(index, { kind: event.target.value as UsageKind })
                  }
                >
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`admin.usage.kind.${kind}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`${id}-provider`}>{t('admin.usage.provider')}</label>
                <input
                  id={`${id}-provider`}
                  value={entry.provider}
                  onChange={(event) => editPrice(index, { provider: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`${id}-model`}>{t('admin.usage.model')}</label>
                <input
                  id={`${id}-model`}
                  value={entry.model}
                  onChange={(event) => editPrice(index, { model: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`${id}-input`}>{t('admin.settings.priceInput')}</label>
                <input
                  id={`${id}-input`}
                  inputMode="decimal"
                  value={entry.input}
                  aria-invalid={invalid && !PRICE.test(entry.input)}
                  onChange={(event) => editPrice(index, { input: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`${id}-output`}>{t('admin.settings.priceOutput')}</label>
                <input
                  id={`${id}-output`}
                  inputMode="decimal"
                  value={entry.output}
                  aria-invalid={invalid && !PRICE.test(entry.output)}
                  onChange={(event) => editPrice(index, { output: event.target.value })}
                />
              </div>
              <button
                type="button"
                className="link-button danger"
                aria-label={t('admin.settings.removePrice', {
                  model: entry.model || '—',
                })}
                onClick={() => setPrices(prices.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="button-secondary"
          onClick={() =>
            setPrices([
              ...prices,
              { kind: 'AI_CHAT', provider: 'OPENAI', model: '', input: '0', output: '0' },
            ])
          }
        >
          {t('admin.settings.addPrice')}
        </button>
      </fieldset>

      <div className="form-actions">
        <button type="submit" className="button-primary" disabled={save.isPending}>
          {t('admin.settings.save')}
        </button>
        <div aria-live="polite">
          {save.isSuccess && <p className="notice">{t('admin.settings.saved')}</p>}
        </div>
        {invalid && (
          <p className="form-status form-status--error" role="alert">
            {t('admin.settings.invalid')}
          </p>
        )}
        {save.isError && (
          <p className="form-status form-status--error" role="alert">
            {t('admin.settings.error')}
          </p>
        )}
      </div>
    </form>
  );
}

/** Global switches and the prices used to estimate consumption. */
export function AdminSettingsPage() {
  const { t } = useI18n();
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: getSettings });
  return (
    <div className="admin-page">
      <header className="page-header">
        <h1>{t('admin.settings.title')}</h1>
      </header>
      {settings.isPending && <p role="status">{t('app.loading')}</p>}
      {settings.isError && (
        <p className="alert" role="alert">
          {t('admin.loadError')}
        </p>
      )}
      {settings.data && <SettingsForm initial={settings.data.values} />}
    </div>
  );
}
