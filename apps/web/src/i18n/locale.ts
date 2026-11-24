export const LOCALE_STORAGE_KEY = 'dukaandesk_locale';

/** Removes the old EN/UR preference so earlier Urdu users land on English. */
export function clearStoredLocale(): void {
  try {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function applyDocumentLocale(): void {
  const html = document.documentElement;
  html.lang = 'en';
  html.dir = 'ltr';
}
