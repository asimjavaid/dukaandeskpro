import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';

const SELL: Array<[string, string]> = [
  ['Type / scan', 'Find item, Enter adds'],
  ['↑ ↓', 'Move in the list'],
  ['+ −', 'Change qty of the highlighted row'],
  ['*', 'Type weight (kg / L row)'],
  ['/', 'Type Rs worth (kg / L row)'],
  ['Enter (empty box)', 'Open payment'],
  ['Esc', 'Back / clear'],
];
const PAY: Array<[string, string]> = [
  ['Enter', 'Pay (cash / digital)'],
  ['Ctrl + Enter', 'Add to khata'],
  ['F8', 'Add to khata'],
  ['F6', 'Cash → JazzCash → Easypaisa → Bank'],
  ['F7', 'Bill discount'],
  ['F9', 'Read weighing scale'],
  ['Esc', 'Back to the bill'],
];
const GENERAL: Array<[string, string]> = [
  ['F1', 'This sheet'],
  ['Esc', 'Close a window'],
];

/** F1 anywhere: keyboard shortcuts. */
export function ShortcutsSheet() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F1') {
        e.preventDefault();
        e.stopImmediatePropagation();
        returnFocusRef.current = document.activeElement as HTMLElement | null;
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // While open, the sheet owns the keyboard: Escape closes only the sheet, and Enter / F6–F9
  // never reach the Sell checkout behind it (capture phase runs before screen handlers).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Tab') return;
      if (e.key === 'Escape' || e.key === 'F1') {
        e.preventDefault();
        setOpen(false);
      }
      // Default actions (Enter/Space on the focused Close button) still run.
      e.stopImmediatePropagation();
    }
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      // Put the cursor back where the cashier was (e.g. Sell search / cash box).
      const el = returnFocusRef.current;
      if (el && document.contains(el)) el.focus();
    };
  }, [open]);
  if (!open) return null;
  const block = (title: string, rows: Array<[string, string]>) => (
    <section>
      <h4>{title}</h4>
      <dl>
        {rows.map(([k, d]) => (
          <div key={k + d} style={{ display: 'contents' }}>
            <dt>
              <kbd className="pos-kbd">{k}</kbd>
            </dt>
            <dd>{d}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
  return (
    <div className="pos-modal-backdrop" onClick={() => setOpen(false)}>
      <div
        className="pos-modal"
        style={{ maxWidth: 760, width: '92vw' }}
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcutsTitle')}
        data-shortcuts-sheet
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{t('shortcutsTitle')}</h3>
        <div className="shortcuts-grid">
          {block(t('shortcutsSell'), SELL)}
          {block(t('shortcutsPay'), PAY)}
          {block(t('shortcutsGeneral'), GENERAL)}
        </div>
        <div className="pos-modal__actions">
          <button type="button" className="btn btn--ghost" autoFocus onClick={() => setOpen(false)}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}
