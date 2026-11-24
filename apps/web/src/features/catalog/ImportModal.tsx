import { useEffect, useState } from 'react';
import { translateError, useI18n } from '../../i18n';
import { apiPostRaw } from '../../lib/api';
import { readSheetFile, rowsToImport } from './sheetRead';

type RowResult = { row: number; name: string; status: 'add' | 'skip_exists' | 'error'; error?: string };
type Result = { ok: boolean; to_add: number; skipped: number; errors: number; added?: number; results: RowResult[]; error?: string };

/** Excel / CSV product import: check first, then add. */
export function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [check, setCheck] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    setCheck(null);
    setDone(null);
    setFileName(file.name);
    try {
      const parsed = rowsToImport(await readSheetFile(file));
      if (!parsed.columns.includes('name') || !parsed.columns.includes('price')) {
        setErr('import_need_columns');
        setRows(null);
        return;
      }
      setRows(parsed.rows);
      await run(parsed.rows, true);
    } catch {
      setErr('import_bad_file');
    }
  }

  async function run(r: Record<string, string>[], dryRun: boolean) {
    setBusy(true);
    const res = await apiPostRaw<Result & { message?: { error?: string } }>('/catalog/import', { rows: r, dryRun }).catch(() => null);
    setBusy(false);
    if (!res?.json?.ok) {
      setErr(res?.json?.message?.error ?? res?.json?.error ?? 'import_failed');
      return;
    }
    if (dryRun) setCheck(res.json);
    else {
      setDone(res.json);
      onDone();
    }
  }

  const problems = (check?.results ?? []).filter((r) => r.status !== 'add').slice(0, 50);

  return (
    <div className="pos-modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="pos-modal" style={{ maxWidth: 680, width: '92vw' }} role="dialog" aria-modal="true" data-import-modal onClick={(e) => e.stopPropagation()}>
        <h3>{t('importTitle')}</h3>
        <p className="muted">{t('importColumns')}</p>
        <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} data-import-file />
        {fileName && rows ? <p className="muted">{fileName} · {rows.length}</p> : null}
        {err ? <p className="pos-alert" role="alert">{translateError(t, err)}</p> : null}
        {check && !done ? (
          <>
            <p data-import-check>
              <span className="chip chip--success">{t('importToAdd').replace('{n}', String(check.to_add))}</span>{' '}
              <span className="chip chip--neutral">{t('importSkipped').replace('{n}', String(check.skipped))}</span>{' '}
              {check.errors ? <span className="chip chip--danger">{t('importErrors').replace('{n}', String(check.errors))}</span> : null}
            </p>
            {problems.length ? (
              <div className="catalog-table-wrap" style={{ maxHeight: 240, overflow: 'auto' }}>
                <table className="catalog-table parties-table">
                  <tbody>
                    {problems.map((p) => (
                      <tr key={p.row}>
                        <td className="ltr-isolate">{p.row + 1}</td>
                        <td>{p.name || '—'}</td>
                        <td className="muted">{p.status === 'skip_exists' ? t('importExists') : p.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}
        {done ? <p className="chip chip--success" role="status" data-import-done>{t('importAdded').replace('{n}', String(done.added ?? 0))}</p> : null}
        <div className="pos-modal__actions">
          {!done ? (
            <button type="button" className="btn btn--teal" disabled={busy || !rows || !check || check.to_add === 0} onClick={() => rows && void run(rows, false)} data-import-go>
              {t('importGo').replace('{n}', String(check?.to_add ?? 0))}
            </button>
          ) : null}
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}
