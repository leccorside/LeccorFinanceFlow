import { createContext, useContext } from 'react';
import type { Locale, MessageKey } from './catalog';

export interface RegionalSettings {
  locale: Locale;
  timeZone: string;
  currency: string;
}

export interface I18nValue extends RegionalSettings {
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  money: (amount: string | number, currency?: string) => string;
  dateTime: (instant: string | Date) => string;
  calendarDate: (date: string) => string;
  /** Applies the regional settings of the signed-in user's profile. */
  setRegional: (settings: Partial<RegionalSettings>) => void;
}

export const I18nContext = createContext<I18nValue | null>(null);

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used inside <I18nProvider>');
  }
  return value;
}
