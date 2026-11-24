import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

type Props = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  /** Confirm button style. Default danger (deletes); primary for settings changes. */
  tone?: 'danger' | 'primary';
  /** Extra content under the message (e.g. a PIN field). Optional. */
  children?: ReactNode;
  /** Keep Confirm disabled until extra inputs are valid. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional middle choice (e.g. "Only this one"). */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Wider dialog for previews with a table. */
  wide?: boolean;
};

/** Confirm before a delete. Backdrop and Escape cancel; nothing is deleted until Confirm. */
export function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel,
  busy,
  tone = 'danger',
  children,
  confirmDisabled,
  onConfirm,
  onCancel,
  secondaryLabel,
  onSecondary,
  wide,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Capture + preventDefault: the screen behind (e.g. a form's own Escape = Back) must not also react.
      e.preventDefault();
      if (!busy) onCancel();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onCancel]);

  // CM1: move focus into the dialog (first field, else Cancel), keep Tab inside, give focus back on close.
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const box = dialogRef.current;
    if (box && !box.contains(document.activeElement)) {
      const field = box.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])',
      );
      (field ?? cancelRef.current ?? box).focus();
    }
    return () => {
      if (before && document.contains(before)) before.focus();
    };
  }, []);

  function trapTab(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const els = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (els.length === 0) {
      e.preventDefault();
      return;
    }
    const first = els[0];
    const last = els[els.length - 1];
    const cur = document.activeElement;
    if (e.shiftKey && (cur === first || !dialogRef.current.contains(cur))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (cur === last || !dialogRef.current.contains(cur))) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="pos-modal-backdrop" onClick={() => { if (!busy) onCancel(); }}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={wide ? 'pos-modal pos-modal--wide' : 'pos-modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-modal-title">{title}</h3>
        {message ? <p>{message}</p> : null}
        {children}
        <div className="pos-modal__actions">
          <button
            type="button"
            className={tone === 'primary' ? 'btn btn--teal' : 'btn btn--ghost btn--danger'}
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          {secondaryLabel && onSecondary ? (
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={onSecondary} data-confirm-secondary>
              {secondaryLabel}
            </button>
          ) : null}
          {cancelLabel ? (
            <button
              ref={cancelRef}
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={onCancel}
              data-confirm-cancel
            >
              {cancelLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
