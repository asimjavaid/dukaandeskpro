import { useCallback, useEffect, useState, type ReactNode } from 'react';
import './license.css';
import { notifyReadOnly, setLicenceStatus, setReadOnly } from './readOnly';

export type LicenceStatus = {
  state: 'licensed' | 'trial' | 'expired' | 'clock_rollback' | 'integrity';
  reason?: string | null;
  locked: boolean;
  readOnly?: boolean;
  machineCode: string;
  daysLeft: number;
  hoursLeft?: number;
  showHoursLeft?: boolean;
  extDays?: number;
  trialEndsAt: string;
  buildDate?: string | null;
  updateCovered?: boolean;
  licence: { type?: string; edition: string; features: string[]; shop: string; issuedAt: string; updatesUntil?: string } | null;
};

const REASONS: Record<string, string> = {
  wrong_machine: 'This key was made for a different computer. Send the Machine Code shown above to get the right key.',
  bad_signature: 'This key is not valid. Please copy the whole key again exactly as sent.',
  bad_format: 'That does not look like a DukaanDesk Pro key. It starts with DR2.',
  no_public_key: 'This copy of DukaanDesk Pro cannot check keys. Please contact the seller.',
  KEY_REQUIRED: 'Paste the activation key first.',
  ext_used: 'This extension code has already been used on this computer.',
  ext_too_old: 'This extension code has expired. Ask your seller for a new one.',
  already_licensed: 'DukaanDesk Pro is already activated. Extension codes are only for the trial.',
  older_key: 'This key is older than the one already active. Your current licence is kept.',
};

// Any API call answered 402 (trial ran out mid-session / change refused in read-only) re-checks
// at once; a refused change (code READ_ONLY) also shows the read-only toast.
if (typeof window !== 'undefined' && !(window as unknown as { __ddLicFetch?: boolean }).__ddLicFetch) {
  (window as unknown as { __ddLicFetch?: boolean }).__ddLicFetch = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await orig(...args);
    if (res.status === 402) {
      window.dispatchEvent(new Event('dd:license-required'));
      res.clone().json().then((j: { code?: string }) => { if (j?.code === 'READ_ONLY') notifyReadOnly(); }).catch(() => undefined);
    }
    return res;
  };
}

async function fetchStatus(): Promise<LicenceStatus | null> {
  try {
    const r = await fetch('/license/status', { credentials: 'include' });
    return r.ok ? ((await r.json()) as LicenceStatus) : null;
  } catch {
    return null;
  }
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function statusLabel(s: LicenceStatus): { text: string; tone: 'ok' | 'warn' | 'bad' } {
  if (s.state === 'licensed') return { text: 'Licensed', tone: 'ok' };
  if (s.state === 'trial') return { text: 'Trial', tone: 'warn' };
  return { text: 'Read-only', tone: 'bad' };
}

function readOnlyWhy(s: LicenceStatus): string {
  if (s.state === 'integrity') return 'Some DukaanDesk Pro program files were changed or damaged. Reinstall DukaanDesk Pro from the original installer. Your data is safe.';
  if (s.state === 'clock_rollback') return "The computer's date is earlier than your last sales or backups. Set the correct date and time in Windows, then reopen DukaanDesk Pro.";
  if (s.reason === 'usage') return 'The trial hours are used up. Reports, exports and backups still work. Activate to sell and make changes again.';
  if (s.reason === 'update_not_covered') return 'This version is newer than your updates. Enter a renewal key, or reinstall the version you own.';
  return 'The trial has ended. Reports, exports and backups still work. Activate to sell and make changes again.';
}

/** The Licence screen: status, days/hours left, shop, updates-until, Machine Code + Copy, key box. */
export function ActivationPanel({ status, onActivated, onClose }: { status: LicenceStatus; onActivated: (s: LicenceStatus, kind?: string) => void; onClose?: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function activate() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/license/activate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; kind?: string; reason?: string; code?: string; status?: LicenceStatus; message?: { code?: string } } | null;
      if (j?.ok && j.status) {
        setKey('');
        onActivated(j.status, j.kind);
      } else setErr(REASONS[j?.reason ?? j?.message?.code ?? ''] ?? 'Activation failed. Please check the key.');
    } catch {
      setErr('Could not reach DukaanDesk Pro. Close and reopen the app, then try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(status.machineCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the code is user-select: all */
    }
  }

  const label = statusLabel(status);
  const lic = status.licence;
  const rows: Array<[string, string]> = [];
  if (status.state === 'trial') {
    rows.push(['Days left', `${status.daysLeft} of ${14 + (status.extDays ?? 0)}`]);
    if (status.showHoursLeft) rows.push(['Hours of use left', String(status.hoursLeft ?? 0)]);
  }
  if (lic?.shop) rows.push(['Shop', lic.shop]);
  if (lic) rows.push(['Edition', lic.edition ? lic.edition[0].toUpperCase() + lic.edition.slice(1) : 'Standard']);
  if (lic) rows.push(['Updates until', lic.updatesUntil ? fmtDate(lic.updatesUntil) : 'No limit']);
  if (lic?.issuedAt) rows.push(['Key issued', fmtDate(lic.issuedAt)]);
  if (status.buildDate) rows.push(['This version', fmtDate(status.buildDate)]);

  return (
    <div className="lic-panel" role="dialog" aria-labelledby="lic-h">
      <div className="lic-panel__head">
        <h2 id="lic-h">Licence</h2>
        <span className={`lic-badge lic-badge--${label.tone}`} data-licence-state={status.state}>{label.text}</span>
      </div>
      {status.locked ? <p className="lic-msg lic-msg--err">{readOnlyWhy(status)}</p> : null}
      {status.state === 'licensed' && status.updateCovered === false ? (
        <p className="lic-msg lic-msg--warn">This version was released after your updates ended. It keeps working; enter a renewal key to stay covered.</p>
      ) : null}
      {rows.length ? (
        <dl className="lic-facts">
          {rows.map(([k, v]) => (
            <div key={k} className="lic-facts__row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="field">
        <label>Machine Code</label>
        <div className="lic-code">
          <span className="lic-code__value" data-testid="machine-code">{status.machineCode}</span>
          <button type="button" className="btn btn--ghost" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      </div>
      <div className="field">
        <label htmlFor="lic-key">{status.state === 'licensed' ? 'Renewal or transfer key' : 'Activation or extension key'}</label>
        <textarea id="lic-key" className="lic-key" autoFocus value={key} spellCheck={false} placeholder="DR2.…" onChange={(e) => setKey(e.target.value)} />
      </div>
      {err ? <p className="lic-msg lic-msg--err" role="alert">{err}</p> : null}
      <div className="lic-actions">
        <button type="button" className="btn btn--teal" disabled={busy || !key.trim()} onClick={activate}>
          {busy ? 'Checking…' : 'Enter key'}
        </button>
        {onClose ? <button type="button" className="btn btn--ghost" onClick={onClose}>Close</button> : null}
      </div>
    </div>
  );
}

/**
 * Wraps the whole app.
 * Trial -> small "N days left" pill with an Activate button.
 * Trial over / clock set back -> READ-ONLY: the app stays open (reports, exports, backup,
 * restore), a read-only strip sits in the top bar with Activate, and refused changes show a toast.
 * The API enforces it (402 READ_ONLY on changes); this is the UX. Activating unlocks at once.
 */
export function LicenseGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LicenceStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [justActivated, setJustActivated] = useState(false);
  const [toast, setToast] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await fetchStatus();
    if (s) setStatus(s);
    setLoaded(true);
  }, []);

  useEffect(() => {
    setLicenceStatus(status as unknown as Record<string, unknown> | null);
  }, [status]);

  // Trial usage cap: tell the app server once a minute while someone is actually using DukaanDesk Pro.
  const inTrial = status?.state === 'trial';
  useEffect(() => {
    if (!inTrial) return;
    let last = Date.now();
    const mark = () => { last = Date.now(); };
    window.addEventListener('keydown', mark, true);
    window.addEventListener('pointerdown', mark, true);
    const id = window.setInterval(() => {
      if (Date.now() - last < 60_000) void fetch('/license/heartbeat', { credentials: 'include' }).catch(() => undefined);
    }, 60_000);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('keydown', mark, true);
      window.removeEventListener('pointerdown', mark, true);
    };
  }, [inTrial]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 5 * 60_000);
    const onLocked = () => void refresh();
    const onOpen = () => setShowPanel(true);
    let t = 0;
    const onRefused = () => {
      setToast(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setToast(false), 6000);
    };
    window.addEventListener('dd:license-required', onLocked);
    window.addEventListener('dd:open-activation', onOpen);
    window.addEventListener('dd:read-only', onRefused);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(t);
      window.removeEventListener('dd:license-required', onLocked);
      window.removeEventListener('dd:open-activation', onOpen);
      window.removeEventListener('dd:read-only', onRefused);
    };
  }, [refresh]);

  useEffect(() => {
    if (showPanel) setToast(false);
  }, [showPanel]);

  const readOnly = !!status?.locked;
  useEffect(() => {
    setReadOnly(readOnly);
  }, [readOnly]);

  function activated(s: LicenceStatus, kind?: string) {
    setStatus(s);
    setShowPanel(false);
    setToast(false);
    setNotice(kind === 'ext' ? `Trial extended. ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left.` : kind === 'transfer' ? 'DukaanDesk Pro activated on this computer.' : 'DukaanDesk Pro activated. Thank you!');
    setJustActivated(true);
    window.setTimeout(() => setJustActivated(false), 4000);
  }

  if (!loaded) return null;
  return (
    <>
      {children}
      {readOnly ? (
        <div className="lic-ro" role="status" data-readonly-banner>
          <span className="lic-ro__label">{status?.state === 'clock_rollback' ? 'Computer date looks wrong' : status?.state === 'integrity' ? 'Files changed' : status?.reason === 'update_not_covered' ? 'Update not covered' : 'Trial ended'}</span>
          <span className="lic-ro__text">Read-only</span>
          <button type="button" className="lic-ro__btn" onClick={() => setShowPanel(true)}>Activate</button>
        </div>
      ) : null}
      {readOnly && toast ? (
        <div className="lic-toast" role="alert">
          <span>Read-only. Activate DukaanDesk Pro to save changes.</span>
          <button type="button" className="btn btn--teal" onClick={() => { setToast(false); setShowPanel(true); }}>Activate</button>
        </div>
      ) : null}
      {status?.state === 'trial' ? (
        <div className="lic-banner" role="status" data-trial-pill>
          <span>
            Trial · {status.daysLeft} day{status.daysLeft === 1 ? '' : 's'} left
            {status.showHoursLeft ? <span className="lic-banner__hours"> · {status.hoursLeft} h of use left</span> : null}
          </span>
          <button type="button" className="btn btn--ghost" onClick={() => setShowPanel(true)}>Activate</button>
        </div>
      ) : null}
      {status?.state === 'licensed' && status.updateCovered === false ? (
        <div className="lic-banner" role="status">
          <span>Updates ended · this version needs renewal</span>
          <button type="button" className="btn btn--ghost" onClick={() => setShowPanel(true)}>Renew</button>
        </div>
      ) : null}
      {justActivated ? <div className="lic-banner lic-banner--ok">{notice}</div> : null}
      {showPanel && status ? (
        <div className="lic-modal" onClick={(e) => e.target === e.currentTarget && setShowPanel(false)} onKeyDown={(e) => e.key === 'Escape' && setShowPanel(false)}>
          <ActivationPanel status={status} onActivated={activated} onClose={() => setShowPanel(false)} />
        </div>
      ) : null}
    </>
  );
}
