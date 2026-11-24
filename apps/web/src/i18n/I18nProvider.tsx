import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { type Locale, type MessageKey, translate } from './dictionary';
import { applyDocumentLocale, clearStoredLocale } from './locale';

type I18nContextValue = {
  locale: Locale;
  dir: 'ltr';
  t: (key: MessageKey) => string;
};

const t = (key: MessageKey) => translate('en', key);
const VALUE: I18nContextValue = { locale: 'en', dir: 'ltr', t };

const I18nContext = createContext<I18nContextValue>(VALUE);

/** The UI is English-only. Any old stored Urdu preference is cleared on load. */
export function I18nProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    clearStoredLocale();
    applyDocumentLocale();
  }, []);
  return <I18nContext.Provider value={VALUE}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
