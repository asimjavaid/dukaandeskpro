import { useEffect, useState } from 'react';
import { THEMES, getTheme, setTheme, type Theme } from './theme';

/** A / B / C colour theme buttons for the top bar. */
export function ThemeSwitcher() {
  const [cur, setCur] = useState<Theme>(() => getTheme());
  useEffect(() => {
    const on = (e: Event) => setCur((e as CustomEvent<Theme>).detail ?? getTheme());
    window.addEventListener('dd-theme', on);
    return () => window.removeEventListener('dd-theme', on);
  }, []);
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme" data-theme-switch>
      {THEMES.map((th) => (
        <button
          key={th.id}
          type="button"
          role="radio"
          aria-checked={cur === th.id}
          aria-label={`${th.label} ${th.name}`}
          title={th.name}
          className={`theme-switch__btn theme-switch__btn--${th.id}${cur === th.id ? ' is-active' : ''}`}
          data-theme-option={th.id}
          onClick={() => setTheme(th.id)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const i = THEMES.findIndex((x) => x.id === cur);
            const n = THEMES[(i + (e.key === 'ArrowRight' ? 1 : THEMES.length - 1)) % THEMES.length].id;
            setTheme(n);
            (e.currentTarget.parentElement?.querySelector(`[data-theme-option="${n}"]`) as HTMLElement | null)?.focus();
          }}
          tabIndex={cur === th.id ? 0 : -1}
        >
          <span className="theme-switch__swatch" aria-hidden="true" />
          <span className="theme-switch__label">{th.label}</span>
        </button>
      ))}
    </div>
  );
}
