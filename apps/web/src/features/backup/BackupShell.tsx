import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { UrHint, translateError, useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/dictionary';
import { apiGet, apiPostRaw, getSessionToken } from '../../lib/api';
import { BACKUP_STALE_DAYS, parseServerTime } from '../notifications/alerts';
import { AutoBackupPanel } from './AutoBackupPanel';
import { ConfirmModal } from '../shared/ConfirmModal';
import { STORE_TIME_ZONE, formatStoreDateTime } from '../shared/discount';
import { PageHeader } from '../shared/PageHeader';

type BackupStatus = {
  last_export_at: string | null;
  last_restore_at?: string | null;
  data_region_disclosed: string;
  product: string;
  schema_version: number;
  min_schema_version?: number;
};

type Props = {
  displayName: string;
};

/** A copy file the owner picked (or pasted), checked and ready to restore. */
type PickedCopy = {
  bundle: unknown;
  exportedAt: number | null;
  size: number;
  name: string | null;
  items: number;
  customers: number;
  sales: number;
  /** Older copy without purchases / suppliers / expenses (left as they are). */
  partial: boolean;
};

type SaveResult =
  | { ok: true; at: number; size: number; filename: string; filePath?: string }
  | { ok: false; code: string };

const DAY_MS = 86_400_000;
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // Karachi: fixed UTC+05:00, no DST.
const PIN_RE = /^[0-9]{4,6}$/;
const BACKUP_PRODUCT = 'DukaanDesk';
const BACKUP_FORMAT = 'dukaandesk-store-export';

/** Backup-only error codes → plain-word messages (shared codes use ERROR_TO_KEY). */
const BACKUP_ERRORS: Partial<Record<string, MessageKey>> = {
  copy_id_required: 'backupExportFailed',
  bad_pin: 'backupBadPin',
  invalid_pin: 'backupBadPin',
  pin_required: 'backupBadPin',
  export_failed: 'backupExportFailed',
  backup_unavailable: 'backupUnavailable',
  file_unreadable: 'bkFileUnreadable',
  invalid_backup_bundle: 'bkFileUnreadable',
  invalid_backup_product: 'bkNotACopy',
  invalid_backup_format: 'bkNotACopy',
  invalid_backup_schema_version: 'bkWrongVersion',
  save_first_cancelled: 'bkSaveFirstStopped',
  restore_failed: 'backupRestoreFailed',
};

function pktDay(ms: number): number {
  return Math.floor((ms + PKT_OFFSET_MS) / DAY_MS);
}

function intlLocale(locale: string): string {
  return locale === 'ur' ? 'ur-PK' : 'en-PK';
}

/** "Today, 3:12 pm" / "Yesterday, 9:10 pm" / "5 Oct 2026, 9:10 pm" in shop time. */
function friendlyWhen(
  ms: number,
  locale: string,
  t: (key: MessageKey) => string,
): string {
  const diff = pktDay(Date.now()) - pktDay(ms);
  if (diff === 0 || diff === 1) {
    let time = '';
    try {
      time = new Intl.DateTimeFormat(intlLocale(locale), {
        timeStyle: 'short',
        timeZone: STORE_TIME_ZONE,
        numberingSystem: 'latn',
      }).format(ms);
    } catch {
      time = new Date(ms).toISOString().slice(11, 16);
    }
    return fill(t(diff === 0 ? 'bkToday' : 'bkYesterday'), { time });
  }
  return formatStoreDateTime(new Date(ms).toISOString(), locale);
}

function fill(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** Like fill(), but each value is a <bdi> so dates / numbers read right inside Urdu. */
function fillNode(template: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/(\{[a-z]+\})/g);
  return parts.map((part, i) => {
    const m = /^\{([a-z]+)\}$/.exec(part);
    if (m && m[1] in vars) return <bdi key={i}>{vars[m[1]]}</bdi>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** dukaandesk-copy-2026-10-08-1512.json (shop time) so copies sort and never clash. */
function copyFileName(beforeRestore: boolean): string {
  const stamp = new Date(Date.now() + PKT_OFFSET_MS)
    .toISOString()
    .slice(0, 16)
    .replace('T', '-')
    .replace(':', '');
  return `dukaandesk-copy-${beforeRestore ? 'before-restore-' : ''}${stamp}.json`;
}

function nestCode(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const j = json as Record<string, unknown>;
  if (typeof j.code === 'string') return j.code;
  if (j.message && typeof j.message === 'object' && j.message !== null) {
    const m = j.message as Record<string, unknown>;
    if (typeof m.code === 'string') return m.code;
  }
  return undefined;
}

function countOf(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

/** Check a copy file before restore so mistakes show up right away, in plain words. */
function readCopy(
  text: string,
  name: string | null,
  versions: { min: number; max: number } | null,
): { ok: true; copy: PickedCopy } | { ok: false; code: string } {
  let bundle: unknown;
  try {
    bundle = JSON.parse(text);
  } catch {
    return { ok: false, code: 'file_unreadable' };
  }
  if (!bundle || typeof bundle !== 'object') return { ok: false, code: 'file_unreadable' };
  const b = bundle as Record<string, unknown>;
  const h = b.header as Record<string, unknown> | undefined;
  if (!h || typeof h !== 'object') return { ok: false, code: 'invalid_backup_product' };
  if (h.product !== BACKUP_PRODUCT) return { ok: false, code: 'invalid_backup_product' };
  if (h.format !== BACKUP_FORMAT) return { ok: false, code: 'invalid_backup_format' };
  const v = h.schema_version;
  if (
    versions &&
    (typeof v !== 'number' || !Number.isInteger(v) || v < versions.min || v > versions.max)
  ) {
    return { ok: false, code: 'invalid_backup_schema_version' };
  }
  const exportedAt =
    typeof h.exported_at === 'string' ? parseServerTime(h.exported_at) : null;
  return {
    ok: true,
    copy: {
      bundle,
      exportedAt,
      size: new Blob([text]).size,
      name,
      items: countOf(b.products),
      customers: countOf(b.parties),
      sales: countOf(b.sales),
      partial: !Array.isArray(b.purchase_invoices) || !Array.isArray(b.expenses),
    },
  };
}

/** Ask the API for a copy (Owner PIN) and save it: desktop save dialog, or browser download. */
async function saveCopy(pin: string, beforeRestore: boolean): Promise<SaveResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getSessionToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers['x-dd-session'] = token;
  }
  let res: Response;
  try {
    res = await fetch('/backup/export', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ pin }),
    });
  } catch {
    return { ok: false, code: 'export_failed' };
  }
  if (!res.ok) {
    return { ok: false, code: res.status === 401 ? 'bad_pin' : 'export_failed' };
  }
  try {
    const copyId = res.headers.get('X-Backup-Copy-Id');
    const text = await res.text();
    const size = new Blob([text]).size;
    const filename = copyFileName(beforeRestore);
    const bridge = window.dukaandesk;
    let filePath: string | undefined;
    if (bridge?.saveTextFile) {
      const saved = await bridge.saveTextFile(filename, text);
      if (!saved?.saved) return { ok: false, code: 'save_cancelled' };
      filePath = saved.filePath;
    } else {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
    // The file is saved — only now record "Last saved" (best effort).
    if (copyId) {
      await apiPostRaw('/backup/saved', { copy_id: copyId }).catch(() => undefined);
    }
    return { ok: true, at: Date.now(), size, filename, filePath };
  } catch {
    return { ok: false, code: 'export_failed' };
  }
}

function PinField({
  id,
  value,
  onChange,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="field backup-pin">
      <label htmlFor={id}>{t('bkPin')}</label>
      <input
        id={id}
        className="ltr-isolate"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        dir="ltr"
        maxLength={6}
        autoFocus={autoFocus}
      />
    </div>
  );
}

export function BackupShell({ displayName }: Props) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Save a copy
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Extract<SaveResult, { ok: true }> | null>(null);
  const [pathCopied, setPathCopied] = useState(false);

  // Restore from a copy
  const [picked, setPicked] = useState<PickedCopy | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoredWhen, setRestoredWhen] = useState<string | null>(null);
  const [restoredSafety, setRestoredSafety] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restorePin, setRestorePin] = useState('');
  const [saveFirst, setSaveFirst] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await apiGet<BackupStatus>('/backup');
      setStatus(s);
      setStatusError(null);
    } catch {
      setStatusError('backup_unavailable');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const err = (code: string | null) => translateError(t, code, BACKUP_ERRORS);
  const when = (ms: number | null) => (ms == null ? '—' : friendlyWhen(ms, locale, t));

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!PIN_RE.test(pin) || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(null);
    setPathCopied(false);
    const r = await saveCopy(pin, false);
    setSaving(false);
    if (!r.ok) {
      // Closing the save window is not an error — nothing to say.
      if (r.code !== 'save_cancelled') setSaveError(r.code);
      return;
    }
    setPin('');
    setSaved(r);
    await refresh();
  }

  async function onCopyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 2000);
    } catch {
      /* clipboard blocked — the path is still on screen */
    }
  }

  function acceptCopy(text: string, name: string | null) {
    setRestoreError(null);
    setRestoredWhen(null);
    setRestoredSafety(null);
    const r = readCopy(
      text,
      name,
      status
        ? { min: status.min_schema_version ?? 1, max: status.schema_version }
        : null,
    );
    if (!r.ok) {
      setPicked(null);
      setPickError(r.code);
      return false;
    }
    setPickError(null);
    setPicked(r.copy);
    return true;
  }

  function onPickFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      acceptCopy(typeof reader.result === 'string' ? reader.result : '', file.name);
      if (fileRef.current) fileRef.current.value = '';
    };
    reader.onerror = () => {
      setPicked(null);
      setPickError('file_unreadable');
    };
    reader.readAsText(file);
  }

  function openConfirm() {
    setRestorePin('');
    setSaveFirst(true);
    setModalError(null);
    setConfirmOpen(true);
  }

  async function onConfirmRestore() {
    if (!picked || !PIN_RE.test(restorePin) || restoring) return;
    setRestoring(true);
    setModalError(null);
    try {
      let safety: string | null = null;
      if (saveFirst) {
        const s = await saveCopy(restorePin, true);
        if (!s.ok) {
          setModalError(s.code === 'save_cancelled' ? 'save_first_cancelled' : s.code);
          return;
        }
        safety = s.filePath ?? s.filename;
      }

      const res = await apiPostRaw<{ ok?: boolean; code?: string }>('/backup/restore', {
        pin: restorePin,
        bundle: picked.bundle,
      });
      if (!res.ok) {
        const code = res.status === 401 ? 'bad_pin' : nestCode(res.json) ?? 'restore_failed';
        if (code === 'bad_pin' || code === 'invalid_pin') {
          setModalError('bad_pin');
          return;
        }
        setConfirmOpen(false);
        setRestoreError(BACKUP_ERRORS[code] ? code : 'restore_failed');
        return;
      }

      setConfirmOpen(false);
      setRestoredWhen(when(picked.exportedAt));
      setRestoredSafety(safety);
      setPicked(null);
      await refresh();
    } catch {
      setConfirmOpen(false);
      setRestoreError('restore_failed');
    } finally {
      setRestoring(false);
      setRestorePin('');
    }
  }

  // Status line
  const lastExport = parseServerTime(status?.last_export_at ?? null);
  const ageDays = lastExport == null ? null : Math.floor((Date.now() - lastExport) / DAY_MS);
  const stale = ageDays == null || ageDays >= BACKUP_STALE_DAYS;

  let statusNode: ReactNode;
  if (statusError) {
    statusNode = (
      <div className="backup-status backup-status--danger" role="alert">
        <span className="backup-status__icon" aria-hidden="true">!</span>
        <span className="backup-status__text">{err(statusError)}</span>
        <button type="button" className="btn btn--ghost backup-status__retry" onClick={() => void refresh()}>
          {t('bkTryAgain')}
        </button>
      </div>
    );
  } else if (!status) {
    statusNode = (
      <div className="backup-status" role="status">
        <span className="backup-status__text muted">{t('bkChecking')}</span>
      </div>
    );
  } else if (stale) {
    statusNode = (
      <div className="backup-status backup-status--warn" role="status">
        <span className="backup-status__icon" aria-hidden="true">!</span>
        <span className="backup-status__text">
          <strong>
            {ageDays == null
              ? t('bkNeverSaved')
              : fillNode(t('bkStale'), { n: ageDays })}
          </strong>
          {lastExport != null ? (
            <span className="backup-status__sub">
              {fillNode(t('bkLastSaved'), { when: when(lastExport) })}
            </span>
          ) : null}
        </span>
      </div>
    );
  } else {
    statusNode = (
      <div className="backup-status backup-status--ok" role="status">
        <span className="backup-status__icon" aria-hidden="true">✓</span>
        <span className="backup-status__text">
          <strong>{fillNode(t('bkLastSaved'), { when: when(lastExport) })}</strong>
        </span>
      </div>
    );
  }

  return (
    <div className="card backup">
      <PageHeader
        title={<>{t('backup')}<UrHint k="backup" /></>}
        subtitle={displayName}
      />

      {statusNode}

      <div className="backup-grid">
        {/* ── Save a copy ── */}
        <section className="backup-panel" aria-labelledby="backup-save-title">
          <h3 id="backup-save-title" className="backup-panel__title">
            {t('bkSaveTitle')}
          </h3>

          <form className="backup-panel__form" onSubmit={onSave}>
            <PinField id="backup-pin" value={pin} onChange={setPin} />
            <button
              type="submit"
              className="btn btn--teal backup-panel__cta"
              disabled={saving || !PIN_RE.test(pin)}
              aria-busy={saving}
            >
              {saving ? t('bkSaving') : t('bkSaveNow')}
            </button>
          </form>

          {saveError ? (
            <p className="backup-msg backup-msg--error" role="alert">
              {err(saveError)}
            </p>
          ) : null}

          {saved ? (
            <div className="backup-done" role="status">
              <p className="backup-done__head">
                <strong>{t('bkSaved')}</strong>
                <span className="muted">
                  {' · '}
                  <bdi>{when(saved.at)}</bdi>
                  {' · '}
                  <bdi>{formatSize(saved.size)}</bdi>
                </span>
              </p>
              <p className="muted backup-done__where">
                {saved.filePath ? t('bkSavedTo') : t('bkSavedDownloads')}
              </p>
              <div className="backup-done__path">
                <code className="ltr-isolate" dir="ltr">
                  {saved.filePath ?? saved.filename}
                </code>
                {saved.filePath ? (
                  <button
                    type="button"
                    className="btn btn--ghost backup-done__copy"
                    onClick={() => void onCopyPath(saved.filePath!)}
                  >
                    {pathCopied ? t('bkPathCopied') : t('bkCopyPath')}
                  </button>
                ) : null}
              </div>
              <p className="muted backup-done__tip">{t('bkUsbTip')}</p>
            </div>
          ) : null}
        </section>

        {/* ── Restore from a copy ── */}
        <section className="backup-panel" aria-labelledby="backup-restore-title">
          <h3 id="backup-restore-title" className="backup-panel__title">
            {t('bkRestoreTitle')}
          </h3>

          <input
            ref={fileRef}
            id="backup-restore-file"
            type="file"
            accept="application/json,.json"
            className="backup-file-input"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />

          {picked ? (
            <div className="backup-copy">
              <p className="backup-copy__when">
                <strong>{fillNode(t('bkCopyFrom'), { when: when(picked.exportedAt) })}</strong>
              </p>
              <p className="muted backup-copy__meta">
                {fillNode(t('bkCopyCounts'), {
                  items: picked.items,
                  customers: picked.customers,
                  sales: picked.sales,
                })}
                {' · '}
                <bdi>{formatSize(picked.size)}</bdi>
              </p>
              {picked.name ? (
                <p className="muted backup-copy__file">
                  <code className="ltr-isolate" dir="ltr">{picked.name}</code>
                </p>
              ) : null}
              <div className="backup-copy__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--danger"
                  onClick={openConfirm}
                >
                  {t('bkRestoreBtn')}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => fileRef.current?.click()}
                >
                  {t('bkChangeFile')}
                </button>
              </div>
            </div>
          ) : (
            <div className="backup-pick">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => fileRef.current?.click()}
              >
                {t('bkChooseFile')}
              </button>
            </div>
          )}

          {pickError || restoreError ? (
            <p className="backup-msg backup-msg--error" role="alert">
              {err(pickError ?? restoreError)}
            </p>
          ) : null}

          {restoredWhen ? (
            <div className="backup-done" role="status">
              <p className="backup-done__head">
                <strong>{fillNode(t('bkRestored'), { when: restoredWhen })}</strong>
              </p>
              {restoredSafety ? (
                <>
                  <p className="muted backup-done__where">{t('bkRestoredSafety')}</p>
                  <div className="backup-done__path">
                    <code className="ltr-isolate" dir="ltr">{restoredSafety}</code>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <AutoBackupPanel />

      {confirmOpen && picked ? (
        <ConfirmModal
          title={t('bkConfirmTitle')}
          message={fill(t('bkConfirmMsg'), {
            when: `\u2068${when(picked.exportedAt)}\u2069`,
          })}
          confirmLabel={restoring ? t('bkRestoring') : t('bkConfirmYes')}
          cancelLabel={t('cancel')}
          busy={restoring}
          confirmDisabled={!PIN_RE.test(restorePin)}
          onConfirm={() => void onConfirmRestore()}
          onCancel={() => setConfirmOpen(false)}
        >
          <ul className="backup-modal__notes muted">
            <li>{t('bkConfirmKeep')}</li>
            {picked.partial ? <li>{t('bkOldCopyNote')}</li> : null}
          </ul>
          <label className="backup-check" htmlFor="backup-save-first">
            <input
              id="backup-save-first"
              type="checkbox"
              checked={saveFirst}
              disabled={restoring}
              onChange={(e) => setSaveFirst(e.target.checked)}
            />
            <span>{t('bkSaveFirst')}</span>
          </label>
          <PinField id="backup-restore-pin" value={restorePin} onChange={setRestorePin} autoFocus />
          {modalError ? (
            <p className="backup-msg backup-msg--error" role="alert">
              {err(modalError)}
            </p>
          ) : null}
        </ConfirmModal>
      ) : null}
    </div>
  );
}
