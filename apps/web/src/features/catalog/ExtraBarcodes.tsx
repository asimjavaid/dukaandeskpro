import { useState } from 'react';
import { useI18n } from '../../i18n';

/** Extra barcodes on the product form: list with Remove, field + Add (Enter adds, does not submit). */
export function ExtraBarcodes({
  idp,
  codes,
  primary,
  onChange,
}: {
  idp: string;
  codes: string[];
  primary: string;
  onChange: (codes: string[]) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  function add() {
    const c = draft.trim();
    if (!c) return;
    if (c === primary.trim() || codes.includes(c)) {
      setMsg(t('bcAlready'));
      return;
    }
    onChange([...codes, c]);
    setDraft('');
    setMsg(null);
  }

  function remove(i: number) {
    const next = codes.filter((_, j) => j !== i);
    onChange(next);
    // keep keyboard users in the list: focus the next Remove, else the input
    requestAnimationFrame(() => {
      const el = document.getElementById(next.length ? `${idp}-xb-rm-${Math.min(i, next.length - 1)}` : `${idp}-xb-new`);
      el?.focus();
    });
  }

  return (
    <div className="field extra-barcodes" data-extra-barcodes>
      <label htmlFor={`${idp}-xb-new`}>{t('bcMore')}</label>
      {codes.length ? (
        <ul className="extra-barcodes__list">
          {codes.map((c, i) => (
            <li key={c} className="extra-barcodes__item">
              <span className="ltr-isolate extra-barcodes__code">{c}</span>
              <button
                type="button"
                id={`${idp}-xb-rm-${i}`}
                className="btn btn--ghost btn--sm extra-barcodes__rm"
                aria-label={t('bcRemove').replace('{code}', c)}
                onClick={() => remove(i)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="extra-barcodes__add">
        <input
          id={`${idp}-xb-new`}
          className="ltr-isolate"
          value={draft}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value);
            setMsg(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn btn--ghost btn--sm" onClick={add} disabled={!draft.trim()}>
          {t('bcAdd')}
        </button>
      </div>
      {msg ? (
        <p className="extra-barcodes__msg" role="alert">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
