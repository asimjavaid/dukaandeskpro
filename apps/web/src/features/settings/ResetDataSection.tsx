import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { apiPostRaw } from '../../lib/api';
import { ConfirmModal } from '../shared/ConfirmModal';
import { clearOpenSales } from '../pos/openSalesStore';

const WORD = 'RESET';
const DONE_KEY = 'dd-reset-done';

type ResetOk = { ok: true; backup_file: string };
type ResetErr = { code?: string; reason?: string; message?: unknown };

/** Owner only (Settings is owner only; the API checks too). Testing helper: wipe activity, keep products/users/settings. */
export function ResetDataSection() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    // Shown once after the reload that follows a reset.
    const f = sessionStorage.getItem(DONE_KEY);
    if (f) {
      sessionStorage.removeItem(DONE_KEY);
      setDone(f);
    }
  }, []);

  const ready = word.trim().toUpperCase() === WORD;

  function close() {
    if (busy) return;
    setOpen(false);
    setWord('');
  }

  async function run() {
    if (!ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiPostRaw<ResetOk & ResetErr>('/settings/reset-data', { confirm: WORD });
      if (!r.ok || !r.json?.ok) {
        const j = r.json as ResetErr | null;
        const reason = j?.code ?? (typeof j?.message === 'string' ? j.message : `HTTP ${r.status}`);
        setErr(t('rsFailed').replace('{reason}', reason));
        setBusy(false);
        setOpen(false);
        setWord('');
        return;
      }
      // Fresh start on this device: drop kept Sell bills and the customer screen state, then reload.
      clearOpenSales();
      try {
        localStorage.removeItem('dd-display-state');
        sessionStorage.setItem(DONE_KEY, r.json.backup_file);
      } catch {
        /* ignore */
      }
      window.location.reload();
    } catch (e) {
      setErr(t('rsFailed').replace('{reason}', e instanceof Error ? e.message : String(e)));
      setBusy(false);
      setOpen(false);
      setWord('');
    }
  }

  return (
    <section className="settings-section settings-section--danger" data-reset-data>
      <h3 className="settings-section__title">{t('rsTitle')}</h3>
      <div className="settings-section__body">
        <p className="muted" style={{ margin: 0 }}>{t('rsKeeps')}</p>
        <div>
          <button type="button" className="btn btn--danger-solid" id="reset-data-open" onClick={() => { setErr(null); setDone(null); setOpen(true); }}>
            {t('rsButton')}
          </button>
        </div>
        {done ? (
          <p className="muted ltr-isolate" role="status" style={{ margin: 0 }} data-reset-done>
            {t('rsDone').replace('{file}', done)}
          </p>
        ) : null}
        {err ? (
          <p className="settings-alert" role="alert">{err}</p>
        ) : null}
      </div>
      {open ? (
        <ConfirmModal
          title={t('rsModalTitle')}
          message={t('rsModalMsg')}
          confirmLabel={busy ? t('rsBusy') : t('rsConfirm')}
          cancelLabel={t('cancel')}
          busy={busy}
          confirmDisabled={!ready}
          onConfirm={() => void run()}
          onCancel={close}
        >
          <div className="field">
            <label htmlFor="reset-data-word">{t('rsTypeLabel')}</label>
            <input
              id="reset-data-word"
              className="ltr-isolate reset-data__word"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={word}
              disabled={busy}
              onChange={(e) => setWord(e.target.value.slice(0, 10))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void run();
                }
              }}
            />
          </div>
        </ConfirmModal>
      ) : null}
    </section>
  );
}
