import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { type MessageKey, SUPPORTED_LOCALES } from '../../i18n/catalog';
import { useI18n } from '../../i18n/context';
import {
  COMMON_CURRENCIES,
  formatCalendarDate,
  formatDateTime,
  formatMoney,
  supportedTimeZones,
} from '../../i18n/format';
import { apiErrorOf } from '../../services/api';
import {
  getProfile,
  type Profile,
  type ProfileUpdate,
  updateProfile,
} from '../../services/profile';
import { useSearchParams } from 'react-router-dom';
import { GoogleConnectionCard } from './GoogleConnectionCard';
import { returnMessageKey } from './google-return';
import { SpreadsheetsCard } from './SpreadsheetsCard';
import {
  diffProfile,
  fieldErrorsFrom,
  type ProfileField,
  type ProfileFormState,
  toFormState,
} from './profile-form';

const SPEAKING_RATES = [0.75, 0.9, 1, 1.1, 1.25, 1.5];
const PREVIEW_AMOUNT = '1234.56';
const PREVIEW_DUE_DATE = '2026-12-10';

type Status =
  { kind: 'idle' } | { kind: 'saved' } | { kind: 'unchanged' } | { kind: 'error' };

export function ProfilePage() {
  const { t, setRegional } = useI18n();
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  // Lives here because the form re-mounts after each save (new server copy).
  const [justSaved, setJustSaved] = useState(false);
  // Return of the Google consent flow: /profile?google=connected or ?googleError=<code>.
  const [params] = useSearchParams();
  const googleMessage = returnMessageKey(params.get('google'), params.get('googleError'));

  if (profile.isPending) {
    return <p role="status">{t('app.loading')}</p>;
  }
  if (profile.isError) {
    return <p role="alert">{t('profile.error.load')}</p>;
  }

  return (
    <ProfileForm
      // Re-mount with fresh state whenever the server copy changes.
      key={profile.data.updatedAt ?? 'new'}
      profile={profile.data}
      justSaved={justSaved}
      onEdit={() => setJustSaved(false)}
      onSaved={(updated) => {
        setJustSaved(true);
        queryClient.setQueryData(['profile'], updated);
        void queryClient.invalidateQueries({ queryKey: ['me'] });
        setRegional({
          locale: updated.locale,
          timeZone: updated.timeZone,
          currency: updated.currency,
        });
      }}
    >
      <GoogleConnectionCard returnMessage={googleMessage} />
      <SpreadsheetsCard />
    </ProfileForm>
  );
}

function ProfileForm({
  profile,
  justSaved,
  onEdit,
  onSaved,
  children,
}: {
  children?: ReactNode;
  profile: Profile;
  justSaved: boolean;
  onEdit: () => void;
  onSaved: (profile: Profile) => void;
}) {
  const { t } = useI18n();
  const original = useMemo(() => toFormState(profile), [profile]);
  const [form, setForm] = useState<ProfileFormState>(original);
  const [invalid, setInvalid] = useState<Set<ProfileField>>(new Set());
  const [status, setStatus] = useState<Status>(
    justSaved ? { kind: 'saved' } : { kind: 'idle' },
  );
  const timeZones = useMemo(() => supportedTimeZones(), []);
  const currencies = useMemo(
    () =>
      COMMON_CURRENCIES.includes(form.currency)
        ? COMMON_CURRENCIES
        : [form.currency, ...COMMON_CURRENCIES],
    [form.currency],
  );

  const save = useMutation({
    mutationFn: (update: ProfileUpdate) => updateProfile(update),
    onSuccess: (updated) => {
      setInvalid(new Set());
      onSaved(updated);
    },
    onError: (error) => {
      setInvalid(fieldErrorsFrom(apiErrorOf(error)?.details));
      setStatus({ kind: 'error' });
    },
  });

  function set<K extends ProfileField>(field: K, value: ProfileFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setStatus({ kind: 'idle' });
    onEdit();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const update = diffProfile(original, form);
    if (Object.keys(update).length === 0) {
      setStatus({ kind: 'unchanged' });
      return;
    }
    save.mutate(update);
  }

  const field = (
    name: ProfileField,
    label: MessageKey,
    control: (props: ControlProps) => ReactNode,
    hint?: MessageKey,
  ) => (
    <Field
      name={name}
      label={t(label)}
      hint={hint ? t(hint) : undefined}
      invalid={invalid.has(name)}
      error={t('profile.error.field')}
    >
      {control}
    </Field>
  );

  return (
    <section className="page" aria-labelledby="profile-title">
      <header className="page-header">
        <h1 id="profile-title">{t('profile.title')}</h1>
        <p>{t('profile.subtitle')}</p>
      </header>

      <form className="profile-form" onSubmit={submit} noValidate>
        <fieldset>
          <legend>{t('profile.section.personal')}</legend>
          <div className="field">
            <label htmlFor="profile-email">{t('profile.email')}</label>
            <input
              id="profile-email"
              value={profile.email}
              readOnly
              aria-describedby="profile-email-hint"
            />
            <small id="profile-email-hint">{t('profile.emailHint')}</small>
          </div>
          {field('firstName', 'profile.firstName', (props) => (
            <input
              {...props}
              autoComplete="given-name"
              maxLength={100}
              value={form.firstName}
              onChange={(e) => set('firstName', e.target.value)}
            />
          ))}
          {field('lastName', 'profile.lastName', (props) => (
            <input
              {...props}
              autoComplete="family-name"
              maxLength={100}
              value={form.lastName}
              onChange={(e) => set('lastName', e.target.value)}
            />
          ))}
          {field(
            'phone',
            'profile.phone',
            (props) => (
              <input
                {...props}
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="+5511999998888"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            ),
            'profile.phoneHint',
          )}
          {field('photoUrl', 'profile.photoUrl', (props) => (
            <input
              {...props}
              type="url"
              inputMode="url"
              placeholder="https://"
              value={form.photoUrl}
              onChange={(e) => set('photoUrl', e.target.value)}
            />
          ))}
        </fieldset>

        <fieldset>
          <legend>{t('profile.section.regional')}</legend>
          {field('locale', 'profile.locale', (props) => (
            <select
              {...props}
              value={form.locale}
              onChange={(e) =>
                set('locale', e.target.value as ProfileFormState['locale'])
              }
            >
              {SUPPORTED_LOCALES.map((locale) => (
                <option key={locale} value={locale} lang={locale}>
                  {t(`locale.${locale}`)}
                </option>
              ))}
            </select>
          ))}
          {field('currency', 'profile.currency', (props) => (
            <select
              {...props}
              value={form.currency}
              onChange={(e) => set('currency', e.target.value)}
            >
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          ))}
          {field('timeZone', 'profile.timeZone', (props) => (
            <select
              {...props}
              value={form.timeZone}
              onChange={(e) => set('timeZone', e.target.value)}
            >
              {(timeZones.includes(form.timeZone)
                ? timeZones
                : [form.timeZone, ...timeZones]
              ).map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          ))}
        </fieldset>

        <fieldset>
          <legend>{t('profile.section.voice')}</legend>
          <div className="field" role="radiogroup" aria-labelledby="voice-gender-label">
            <span id="voice-gender-label" className="field-label">
              {t('profile.voice.gender')}
            </span>
            <div className="choice-row">
              {(['FEMALE', 'MALE'] as const).map((gender) => (
                <label key={gender} className="choice">
                  <input
                    type="radio"
                    name="voice-gender"
                    value={gender}
                    checked={form.gender === gender}
                    onChange={() => set('gender', gender)}
                  />
                  {t(gender === 'FEMALE' ? 'profile.voice.female' : 'profile.voice.male')}
                </label>
              ))}
            </div>
          </div>
          <label className="choice">
            <input
              type="checkbox"
              checked={form.autoSpeak}
              onChange={(e) => set('autoSpeak', e.target.checked)}
            />
            {t('profile.voice.autoSpeak')}
          </label>
          {field('speakingRate', 'profile.voice.rate', (props) => (
            <select
              {...props}
              value={form.speakingRate}
              onChange={(e) => set('speakingRate', Number(e.target.value))}
            >
              {(SPEAKING_RATES.includes(form.speakingRate)
                ? SPEAKING_RATES
                : [form.speakingRate, ...SPEAKING_RATES]
              ).map((rate) => (
                <option key={rate} value={rate}>
                  {rate.toLocaleString(form.locale)}×
                </option>
              ))}
            </select>
          ))}
        </fieldset>

        <fieldset>
          <legend>{t('profile.section.preferences')}</legend>
          {field('theme', 'profile.theme', (props) => (
            <select
              {...props}
              value={form.theme}
              onChange={(e) => set('theme', e.target.value as ProfileFormState['theme'])}
            >
              <option value="system">{t('profile.theme.system')}</option>
              <option value="light">{t('profile.theme.light')}</option>
              <option value="dark">{t('profile.theme.dark')}</option>
            </select>
          ))}
          {field('weekStartsOn', 'profile.weekStartsOn', (props) => (
            <select
              {...props}
              value={form.weekStartsOn}
              onChange={(e) =>
                set('weekStartsOn', e.target.value as ProfileFormState['weekStartsOn'])
              }
            >
              <option value="monday">{t('profile.week.monday')}</option>
              <option value="sunday">{t('profile.week.sunday')}</option>
            </select>
          ))}
        </fieldset>

        <aside className="preview" aria-labelledby="preview-title">
          <h2 id="preview-title">{t('profile.section.preview')}</h2>
          <dl>
            <dt>{t('profile.preview.money')}</dt>
            <dd data-testid="preview-money">
              {formatMoney(PREVIEW_AMOUNT, form.currency, form.locale)}
            </dd>
            <dt>{t('profile.preview.now')}</dt>
            <dd data-testid="preview-now">
              {formatDateTime(new Date(), form.locale, form.timeZone)}
            </dd>
            <dt>{t('profile.preview.date')}</dt>
            <dd data-testid="preview-date">
              {formatCalendarDate(PREVIEW_DUE_DATE, form.locale)}
            </dd>
          </dl>
        </aside>

        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={save.isPending}>
            {save.isPending ? t('profile.saving') : t('profile.save')}
          </button>
          <p
            role="status"
            aria-live="polite"
            className={`form-status form-status--${status.kind}`}
          >
            {status.kind === 'saved' && t('profile.saved')}
            {status.kind === 'unchanged' && t('profile.noChanges')}
            {status.kind === 'error' && t('profile.error.save')}
          </p>
        </div>
      </form>
      {children}
    </section>
  );
}

interface ControlProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby'?: string;
}

function Field({
  name,
  label,
  hint,
  invalid,
  error,
  children,
}: {
  name: ProfileField;
  label: string;
  hint: string | undefined;
  invalid: boolean;
  error: string;
  children: (props: ControlProps) => ReactNode;
}) {
  const id = `profile-${name}`;
  const describedBy = [hint ? `${id}-hint` : null, invalid ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={invalid ? 'field field--invalid' : 'field'}>
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        'aria-invalid': invalid,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {invalid && (
        <small id={`${id}-error`} className="field-error">
          {error}
        </small>
      )}
    </div>
  );
}
