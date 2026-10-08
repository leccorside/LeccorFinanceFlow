import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { matchLocale, translate } from './catalog';
import { I18nContext, type I18nValue, type RegionalSettings } from './context';
import { formatCalendarDate, formatDateTime, formatMoney } from './format';

function browserDefaults(): RegionalSettings {
  return {
    locale: matchLocale(
      typeof navigator === 'undefined' ? undefined : navigator.language,
    ),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
    currency: 'BRL',
  };
}

/**
 * Before login the browser language/time zone are used; after login the profile's
 * locale, currency and time zone take over (see useApplyProfileRegion).
 */
export function I18nProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: Partial<RegionalSettings>;
}) {
  const [settings, setSettings] = useState<RegionalSettings>(() => ({
    ...browserDefaults(),
    ...initial,
  }));

  useEffect(() => {
    document.documentElement.lang = settings.locale;
  }, [settings.locale]);

  const setRegional = useCallback((next: Partial<RegionalSettings>) => {
    setSettings((current) => ({ ...current, ...next }));
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      ...settings,
      t: (key, params) => translate(settings.locale, key, params),
      money: (amount, currency) =>
        formatMoney(amount, currency ?? settings.currency, settings.locale),
      dateTime: (instant) => formatDateTime(instant, settings.locale, settings.timeZone),
      calendarDate: (date) => formatCalendarDate(date, settings.locale),
      setRegional,
    }),
    [settings, setRegional],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
