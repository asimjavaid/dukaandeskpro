/** Colour theme, kept per PC / browser. B (charcoal + teal) is the default. */
export type Theme = 'a' | 'b' | 'c';
export const THEMES: Array<{ id: Theme; label: string; name: string }> = [
  { id: 'a', label: 'A', name: 'Slate' },
  { id: 'b', label: 'B', name: 'Charcoal' },
  { id: 'c', label: 'C', name: 'Indigo' },
];
export const THEME_KEY = 'dd-theme';

function parse(v: string | null | undefined): Theme {
  return v === 'a' || v === 'c' ? v : 'b';
}

export function getTheme(): Theme {
  try {
    return parse(localStorage.getItem(THEME_KEY));
  } catch {
    return 'b';
  }
}

export function applyTheme(t: Theme = getTheme()) {
  document.documentElement.setAttribute('data-theme', t);
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private mode */
  }
  applyTheme(t);
  window.dispatchEvent(new CustomEvent('dd-theme', { detail: t }));
}

/** Follow changes made in other windows (customer display, other tabs). */
export function watchTheme(): () => void {
  const on = (e: StorageEvent) => {
    if (e.key === THEME_KEY) {
      const t = parse(e.newValue);
      applyTheme(t);
      window.dispatchEvent(new CustomEvent('dd-theme', { detail: t }));
    }
  };
  window.addEventListener('storage', on);
  return () => window.removeEventListener('storage', on);
}
