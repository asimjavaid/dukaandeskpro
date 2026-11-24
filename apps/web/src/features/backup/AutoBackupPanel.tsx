import { ConfirmModal } from '../shared/ConfirmModal';
import { useCallback, useEffect, useState } from 'react';
import { translateError, useI18n } from '../../i18n';
import { apiGet, apiPostRaw } from '../../lib/api';
import { fmtDateTime } from '../shared/dates';

type AutoStatus = {
  enabled: boolean;
  folder: string | null;
  keep_count: number;
  last_at: string | null;
  last_file: string | null;
  last_error: string | null;
  last_error_at: string | null;
  files: Array<{ name: string; size: number; modified_at: string }>;
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return fmtDateTime(d);
}

function kb(size: number): string {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

/** Automatic daily copy to a folder / USB, newest N kept. Owner only. */
export function AutoBackupPanel() {
  const { t } = useI18n();
  const [st, setSt] = useState<AutoStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [folder, setFolder] = useState('');
  const [keep, setKeep] = useState('14');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [dbFiles, setDbFiles] = useState<Array<{ name: string; path: string }>>([]);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restorePin, setRestorePin] = useState('');

  const loadDb = useCallback(() => {
    apiGet<{ enabled: boolean; files: Array<{ name: string; path: string }> }>('/backup/db')
      .then((r) => setDbFiles(r.enabled ? r.files : []))
      .catch(() => setDbFiles([]));
  }, []);
  useEffect(() => loadDb(), [loadDb]);

  async function restoreFull(file: string) {
    if (!/^\d{4,6}$/.test(restorePin)) return;
    setBusy(true);
    setError(null);
    setSavedFlash(null);
    const r = await apiPostRaw<{ ok?: boolean; code?: string; message?: { code?: string } }>('/backup/db/restore', { pin: restorePin, path: file });
    setBusy(false);
    setRestorePin('');
    setRestoring(null);
    if (!r.json?.ok) {
      setError(r.json?.code ?? r.json?.message?.code ?? 'restore_failed');
      return;
    }
    setSavedFlash(t('bkRestoreFullDone'));
    loadDb();
    window.setTimeout(() => window.location.reload(), 900);
  }

  const apply = useCallback((s: AutoStatus) => {
    setSt(s);
    setEnabled(s.enabled);
    setFolder(s.folder ?? '');
    setKeep(String(s.keep_count || 14));
  }, []);

  useEffect(() => {
    apiGet<AutoStatus>('/backup/auto')
      .then(apply)
      .catch(() => setError('backup_unavailable'));
  }, [apply]);

  const bridge = typeof window !== 'undefined' ? window.dukaandesk : undefined;
  const keepN = Number(keep);
  const keepOk = /^\d+$/.test(keep) && keepN >= 1 && keepN <= 365;
  const dirty =
    st != null && (enabled !== st.enabled || folder.trim() !== (st.folder ?? '') || keepN !== st.keep_count);

  async function save(next?: { enabled?: boolean }) {
    if (!keepOk) return;
    setBusy(true);
    setError(null);
    setSavedFlash(null);
    const r = await apiPostRaw<{ ok: boolean; error?: string; status?: AutoStatus }>('/backup/auto', {
      enabled: next?.enabled ?? enabled,
      folder: folder.trim() || null,
      keepCount: keepN,
    });
    setBusy(false);
    if (!r.json?.ok || !r.json.status) {
      setError(r.json?.error ?? 'error_generic');
      if (st) setEnabled(st.enabled);
      return;
    }
    apply(r.json.status);
    setSavedFlash(t('saved'));
  }

  async function runNow() {
    setBusy(true);
    setError(null);
    setSavedFlash(null);
    const r = await apiPostRaw<{ ok: boolean; error?: string; file?: string; status?: AutoStatus }>('/backup/auto/run');
    setBusy(false);
    if (!r.json?.ok) {
      setError(r.json?.error ?? 'error_generic');
      const s = await apiGet<AutoStatus>('/backup/auto').catch(() => null);
      if (s) setSt(s);
      return;
    }
    if (r.json.status) setSt(r.json.status);
    setSavedFlash(r.json.file ?? t('saved'));
    loadDb();
  }

  async function pick() {
    if (!bridge?.pickFolder) return;
    const r = await bridge.pickFolder(folder || null);
    if (r.ok && r.path) setFolder(r.path);
  }

  const errText = (code: string | null) =>
    translateError(t, code, {
      folder_not_absolute: 'errFolderNotAbsolute',
      folder_not_writable: 'errFolderNotWritable',
      folder_required: 'errFolderRequired',
      invalid_keep_count: 'errKeepCount',
      backup_busy: 'errBackupBusy',
      backup_failed: 'errAutoBackupFailed',
      not_a_db_copy: 'errNotDbCopy',
      restore_failed: 'errRestoreFailed',
      safety_backup_failed: 'errRestoreFailed',
      bad_pin: 'backupBadPin',
    });

  const lastFailed = st?.last_error && (!st.last_at || (st.last_error_at ?? '') > st.last_at);

  return (
    <section className="backup-panel backup-auto" aria-labelledby="backup-auto-title" data-auto-backup>
      <h3 id="backup-auto-title" className="backup-panel__title">
        {t('bkAutoTitle')}
      </h3>

      {st ? (
        lastFailed ? (
          <div className="backup-status backup-status--danger" role="alert">
            <span className="backup-status__icon" aria-hidden="true">!</span>
            <span className="backup-status__text">
              {t('bkAutoLastFailed')} {fmtTime(st.last_error_at)}
              <span className="backup-status__sub">{errText(st.last_error)}</span>
            </span>
          </div>
        ) : st.last_at ? (
          <div className="backup-status backup-status--ok" role="status">
            <span className="backup-status__icon" aria-hidden="true">✓</span>
            <span className="backup-status__text">
              {t('bkAutoLast')} {fmtTime(st.last_at)}
              {st.last_file ? <span className="backup-status__sub ltr-isolate">{st.last_file}</span> : null}
            </span>
          </div>
        ) : (
          <div className="backup-status backup-status--warn" role="status">
            <span className="backup-status__icon" aria-hidden="true">!</span>
            <span className="backup-status__text">{t('bkAutoNever')}</span>
          </div>
        )
      ) : null}

      <form
        className="backup-panel__form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="backup-check" htmlFor="backup-auto-on">
          <input
            id="backup-auto-on"
            type="checkbox"
            checked={enabled}
            disabled={busy || !st}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>{t('bkAutoEnable')}</span>
        </label>
        <div className="field">
          <label htmlFor="backup-auto-folder">{t('bkAutoFolder')}</label>
          <div className="backup-auto__folder">
            <input
              id="backup-auto-folder"
              dir="ltr"
              value={folder}
              placeholder="E:\DukaanDesk-backups"
              disabled={busy}
              onChange={(e) => setFolder(e.target.value)}
            />
            {bridge?.pickFolder ? (
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void pick()}>
                {t('bkAutoChoose')}
              </button>
            ) : null}
          </div>
        </div>
        <div className="field backup-auto__keep">
          <label htmlFor="backup-auto-keep">{t('bkAutoKeep')}</label>
          <input
            id="backup-auto-keep"
            inputMode="numeric"
            value={keep}
            disabled={busy}
            aria-invalid={!keepOk}
            onChange={(e) => setKeep(e.target.value.replace(/\D/g, '').slice(0, 3))}
          />
        </div>
        <div className="nav-row">
          <button type="submit" className="btn btn--teal" disabled={busy || !dirty || !keepOk}>
            {t('save')}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || !st?.folder || dirty}
            onClick={() => void runNow()}
            data-auto-run
          >
            {t('bkAutoRunNow')}
          </button>
        </div>
      </form>

      {error ? (
        <p className="backup-msg backup-msg--error" role="alert">
          {error === 'backup_unavailable' ? t('backupUnavailable') : errText(error)}
        </p>
      ) : savedFlash ? (
        <p className="backup-msg" role="status">
          {savedFlash}
        </p>
      ) : null}

      {st && st.files.length > 0 ? (
        <div className="catalog-table-wrap" style={{ marginTop: 12 }}>
          <table className="catalog-table parties-table">
            <thead>
              <tr>
                <th scope="col" className="catalog-table__col-product">
                  {t('bkAutoFile')}
                </th>
                <th scope="col">{t('tillTime')}</th>
                <th scope="col" className="catalog-table__num">
                  {t('bkAutoSize')}
                </th>
                {dbFiles.length ? <th scope="col" aria-label={t('bkRestoreFull')} /> : null}
              </tr>
            </thead>
            <tbody>
              {st.files.map((f) => (
                <tr key={f.name}>
                  <td className="catalog-table__col-product">
                    <span className="catalog-table__name ltr-isolate">{f.name}</span>
                  </td>
                  <td>
                    <span className="ltr-isolate">{fmtTime(f.modified_at)}</span>
                  </td>
                  <td className="catalog-table__num">
                    <span className="ltr-isolate">{kb(f.size)}</span>
                  </td>
                  {dbFiles.length ? (
                    <td className="catalog-table__num">
                      {(() => {
                        const full = dbFiles.find((x) => x.name === f.name);
                        if (!full) return null;
                        return (
                          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { setRestoring(full.path); setRestorePin(''); }} data-db-restore={f.name}>
                            {t('bkRestoreFull')}
                          </button>
                        );
                      })()}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {restoring ? (
        <ConfirmModal
          title={t('bkRestoreFull')}
          message={`${t('bkRestoreFullAsk')} ${restoring.split(/[\\/]/).pop() ?? ''}`}
          confirmLabel={t('bkRestoreFull')}
          cancelLabel={t('cancel')}
          busy={busy}
          confirmDisabled={!/^\d{4,6}$/.test(restorePin)}
          onConfirm={() => void restoreFull(restoring)}
          onCancel={() => setRestoring(null)}
        >
          <form
            data-db-restore-form
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d{4,6}$/.test(restorePin)) void restoreFull(restoring);
            }}
          >
            <div className="field">
              <label htmlFor="bk-restore-pin">{t('pin')}</label>
              <input
                id="bk-restore-pin"
                autoFocus
                type="password"
                inputMode="numeric"
                value={restorePin}
                onChange={(e) => setRestorePin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>
            <button type="submit" hidden />
          </form>
        </ConfirmModal>
      ) : null}
    </section>
  );
}
