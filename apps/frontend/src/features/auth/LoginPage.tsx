import { useSearchParams } from 'react-router-dom';
import type { MessageKey } from '../../i18n/catalog';
import { useI18n } from '../../i18n/context';
import { googleLoginUrl } from '../../services/auth';

const KNOWN_ERRORS = new Set([
  'access_denied',
  'invalid_state',
  'expired_state',
  'provider_error',
  'email_not_verified',
  'account_blocked',
  'account_conflict',
  'oauth_not_configured',
]);

/** Only same-origin relative paths are forwarded (the backend validates again). */
function safeRedirect(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/profile';
}

export function LoginPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const error = params.get('error');
  const errorKey: MessageKey | null = error
    ? KNOWN_ERRORS.has(error)
      ? (`login.error.${error}` as MessageKey)
      : 'login.error.unknown'
    : null;

  return (
    <section className="page page--narrow" aria-labelledby="login-title">
      <h1 id="login-title">{t('login.title')}</h1>
      <p>{t('login.body')}</p>
      {errorKey && (
        <p role="alert" className="alert">
          {t(errorKey)}
        </p>
      )}
      {/* A real navigation: the OAuth flow is a chain of redirects handled by the backend. */}
      <a
        className="button-primary"
        href={googleLoginUrl(safeRedirect(params.get('redirectTo')))}
      >
        {t('login.google')}
      </a>
    </section>
  );
}
