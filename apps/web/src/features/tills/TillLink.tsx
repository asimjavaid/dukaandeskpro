import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { UrHint, translateError, useI18n } from '../../i18n';
import { getTillKey, setTillKey } from '../../lib/api';

/**
 * Lite network link.
 * - Till-only PC (served by till-link): connect to the main PC (found on the LAN or typed), then pair.
 * - Every PC: checks the main PC every 3 s. Down = full-screen block (no selling); the screen
 *   underneath stays mounted, so the open bill is kept. Back = block lifts.
 */
const POLL_MS = 3000;
const TIMEOUT_MS = 2500;

// Any call that cannot reach the main PC raises the block at once (the heartbeat clears it).
if (typeof window !== 'undefined' && !(window as { __ddLinkWrap?: boolean }).__ddLinkWrap) {
  (window as { __ddLinkWrap?: boolean }).__ddLinkWrap = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    try {
      const res = await orig(...args);
      if (res.status === 502 || res.status === 504) window.dispatchEvent(new Event('dd:link-failed'));
      return res;
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) window.dispatchEvent(new Event('dd:link-failed'));
      throw e;
    }
  };
}

type Found = { host: string; port: number; name?: string };
type Phase = 'checking' | 'connect' | 'pair' | 'ready';

async function getJson<T>(path: string, init?: RequestInit): Promise<{ status: number; json: T | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS + (init?.method === 'POST' ? 4000 : 0));
  try {
    const key = getTillKey();
    const r = await fetch(path, {
      ...init,
      signal: ctl.signal,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'x-dd-till': key } : {}), ...(init?.headers ?? {}) },
    });
    let json: T | null = null;
    try {
      json = (await r.json()) as T;
    } catch {
      json = null;
    }
    return { status: r.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/** Till PC link state for the top bar and the screens (offline selling). */
export type LinkState = {
  tillMode: boolean;
  online: boolean;
  /** Main PC down but this till sells from its copy. */
  offline: boolean;
  queued: number;
  rejected: number;
  syncing: boolean;
};
const NO_LINK: LinkState = { tillMode: false, online: true, offline: false, queued: 0, rejected: 0, syncing: false };
const LinkCtx = createContext<LinkState>(NO_LINK);
export const useLink = () => useContext(LinkCtx);

type OfflineState = { online: boolean; ready: boolean; queued: number; rejected: number; syncing: boolean };

type TillMe = { till: { id: string; code: number; name: string } | null; keyRejected: boolean; mode: string };

export function TillLink({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [tillMode, setTillMode] = useState(false);
  const [server, setServer] = useState<string | null>(null);
  const [down, setDown] = useState(false);
  const [tries, setTries] = useState(0);
  const [link, setLink] = useState<LinkState>(NO_LINK);
  const mounted = useRef(false); // App has been shown once: later problems overlay it, never unmount it

  // First look: are we a till-only PC?
  useEffect(() => {
    let off = false;
    (async () => {
      let st: { tillMode?: boolean; server?: string | null } | null = null;
      try {
        const r = await getJson<{ tillMode?: boolean; server?: string | null }>('/__till/status');
        st = r.status === 200 ? r.json : null;
      } catch {
        st = null;
      }
      if (off) return;
      if (!st?.tillMode) {
        setPhase('ready');
        return;
      }
      setTillMode(true);
      setServer(st.server ?? null);
      if (!st.server) {
        setPhase('connect');
        return;
      }
      setPhase(getTillKey() ? 'ready' : 'pair');
    })();
    return () => {
      off = true;
    };
  }, []);

  if (phase === 'ready') mounted.current = true;

  // Heartbeat. Till PC: the till-link's own state (local, fast) + who-am-I while the main PC answers.
  useEffect(() => {
    if (phase !== 'ready') return;
    let off = false;
    let wasOnline = true;
    let n = 0;
    const beat = async () => {
      n += 1;
      if (tillMode) {
        let st: OfflineState | null = null;
        try {
          const r = await getJson<OfflineState>('/__till/offline/state');
          st = r.status === 200 ? r.json : null;
        } catch {
          st = null;
        }
        if (off) return;
        const online = Boolean(st?.online);
        if (online && (n % 2 === 1 || !wasOnline)) {
          try {
            const me = await getJson<TillMe>('/tills/me');
            if (!off && me.status === 200 && me.json && !(me.json as { offline?: boolean }).offline && (me.json.keyRejected || !me.json.till)) {
              setTillKey(null);
              setPhase('pair');
              return;
            }
          } catch {
            /* next beat */
          }
        }
        if (online && !wasOnline) window.dispatchEvent(new CustomEvent('dd:reconnected'));
        wasOnline = online;
        const ready = Boolean(st?.ready);
        setLink({
          tillMode: true,
          online,
          offline: !online && ready,
          queued: st?.queued ?? 0,
          rejected: st?.rejected ?? 0,
          syncing: Boolean(st?.syncing),
        });
        // Never had a copy of the shop: nothing to sell from → block as before.
        setDown(!online && !ready);
        setTries((x) => (online ? 0 : x + 1));
        return;
      }
      let ok = false;
      try {
        const r = await getJson('/health');
        ok = r.status === 200;
      } catch {
        ok = false;
      }
      if (off) return;
      setDown((was) => {
        if (was && ok) window.dispatchEvent(new CustomEvent('dd:reconnected'));
        return !ok;
      });
      setTries((x) => (ok ? 0 : x + 1));
    };
    void beat();
    const id = window.setInterval(() => void beat(), tillMode ? 2000 : POLL_MS);
    // A failed call: check at once (main PC: block now; till: switch to offline selling).
    const onFail = () => {
      if (tillMode) void beat();
      else setDown(true);
    };
    window.addEventListener('dd:link-failed', onFail);
    return () => {
      off = true;
      window.clearInterval(id);
      window.removeEventListener('dd:link-failed', onFail);
    };
  }, [phase, tillMode]);

  // While blocked, no key reaches the screens underneath.
  useEffect(() => {
    if (!down || phase !== 'ready') return;
    const stop = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', stop, true);
    (document.activeElement as HTMLElement | null)?.blur?.();
    return () => window.removeEventListener('keydown', stop, true);
  }, [down, phase]);

  const onConnected = useCallback((s: string) => {
    setServer(s);
    setPhase(getTillKey() ? 'ready' : 'pair');
  }, []);

  if (phase === 'checking') return null;
  if (phase === 'connect') return <ConnectScreen onConnected={onConnected} />;
  if (phase === 'pair' && !mounted.current) return <PairScreen server={server} onPaired={() => setPhase('ready')} onChange={() => setPhase('connect')} />;

  return (
    <LinkCtx.Provider value={link}>
      {children}
      {phase === 'pair' ? (
        <div className="link-block" data-link-pair>
          <PairScreen server={server} onPaired={() => setPhase('ready')} onChange={() => setPhase('connect')} />
        </div>
      ) : down ? (
        <DownOverlay server={server} tries={tries} />
      ) : null}
    </LinkCtx.Provider>
  );
}

/** Top bar on a till PC: Offline / sending / not sent, with the queue count. */
export function LinkStatus() {
  const { t } = useI18n();
  const l = useLink();
  if (!l.tillMode) return null;
  if (l.offline) {
    return (
      <span className="chip chip--warn link-status" data-link-status="offline">
        {t('linkOffline')}
        {l.queued > 0 ? <b className="link-status__n ltr-isolate">{l.queued}</b> : null}
      </span>
    );
  }
  if (l.rejected > 0) {
    return (
      <span className="chip chip--danger link-status" data-link-status="rejected">
        {t('linkNotSent')} <b className="link-status__n ltr-isolate">{l.rejected}</b>
      </span>
    );
  }
  if (l.queued > 0) {
    return (
      <span className="chip chip--info link-status" data-link-status="syncing">
        {t('linkSyncing')} <b className="link-status__n ltr-isolate">{l.queued}</b>
      </span>
    );
  }
  return (
    <span className="chip link-status link-status--ok" data-link-status="synced">
      {t('linkSynced')}
    </span>
  );
}

function DownOverlay({ server, tries }: { server: string | null; tries: number }) {
  const { t } = useI18n();
  return (
    <div className="link-block" role="alertdialog" aria-modal="true" aria-labelledby="link-down-title" data-link-down>
      <div className="link-card link-card--down">
        <h2 id="link-down-title">
          {t('linkDownTitle')}
          <UrHint k="linkDownTitle" />
        </h2>
        {server ? <p className="link-addr ltr-isolate">{server}</p> : null}
        <p className="muted">
          {t('linkRetrying')}
          {'.'.repeat((tries % 3) + 1)}
        </p>
        <p className="chip chip--warn">{t('linkBillKept')}</p>
      </div>
    </div>
  );
}

function ConnectScreen({ onConnected }: { onConnected: (server: string) => void }) {
  const { t } = useI18n();
  const [found, setFound] = useState<Found[] | null>(null);
  const [sel, setSel] = useState(0);
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addrRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async () => {
    setFound(null);
    try {
      const r = await getJson<{ found: Found[] }>('/__till/discover', { method: 'POST' });
      setFound(r.json?.found ?? []);
      setSel(0);
    } catch {
      setFound([]);
    }
  }, []);

  useEffect(() => {
    void search();
    addrRef.current?.focus();
  }, [search]);

  async function connect(server: string) {
    if (!server.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await getJson<{ ok: boolean; server?: string; error?: string }>('/__till/server', {
        method: 'POST',
        body: JSON.stringify({ server }),
      });
      if (r.json?.ok && r.json.server) onConnected(r.json.server);
      else setError(r.json?.error ?? 'server_unreachable');
    } catch {
      setError('server_unreachable');
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    const list = found ?? [];
    if (e.key === 'ArrowDown' && list.length) {
      e.preventDefault();
      setSel((i) => Math.min(list.length - 1, i + 1));
    } else if (e.key === 'ArrowUp' && list.length) {
      e.preventDefault();
      setSel((i) => Math.max(0, i - 1));
    } else if (e.key === 'F5') {
      e.preventDefault();
      void search();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (addr.trim()) void connect(addr);
      else if (list[sel]) void connect(`${list[sel].host}:${list[sel].port}`);
    }
  }

  return (
    <div className="link-page" onKeyDown={onKey} data-link-connect>
      <div className="link-card">
        <h2>
          {t('linkConnectTitle')}
          <UrHint k="linkConnectTitle" />
        </h2>
        <div className="link-found">
          <div className="link-found__head">
            <span>{t('linkFound')}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void search()} disabled={found === null}>
              {t('linkSearch')} <kbd className="pos-kbd">F5</kbd>
            </button>
          </div>
          {found === null ? (
            <p className="muted">{t('linkSearching')}…</p>
          ) : found.length === 0 ? (
            <p className="muted">{t('linkNoneFound')}</p>
          ) : (
            <ul className="link-list" role="listbox">
              {found.map((f, i) => (
                <li key={`${f.host}:${f.port}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === sel}
                    className={`link-list__item${i === sel ? ' is-selected' : ''}`}
                    onClick={() => void connect(`${f.host}:${f.port}`)}
                  >
                    <span className="link-list__name">{f.name ?? 'DukaanDesk Pro'}</span>
                    <span className="link-addr ltr-isolate">
                      {f.host}:{f.port}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label htmlFor="link-addr">{t('linkAddress')}</label>
        <input
          id="link-addr"
          ref={addrRef}
          className="input ltr-isolate"
          value={addr}
          placeholder="192.168.1.10"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setAddr(e.target.value)}
        />
        {error ? <p className="form-error" role="alert">{translateError(t, error)}</p> : null}
        <button type="button" className="btn btn--teal btn--block" disabled={busy || (!addr.trim() && !(found ?? [])[sel])} onClick={() => void connect(addr.trim() || (found?.[sel] ? `${found[sel].host}:${found[sel].port}` : ''))}>
          {t('linkConnect')} <kbd className="pos-kbd">Enter</kbd>
        </button>
      </div>
    </div>
  );
}

function PairScreen({ server, onPaired, onChange }: { server: string | null; onPaired: () => void; onChange: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pair() {
    const c = code.replace(/\D/g, '');
    if (c.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await getJson<{ ok: boolean; deviceKey?: string; error?: string }>('/tills/pair', {
        method: 'POST',
        body: JSON.stringify({ code: c, deviceName: name.trim() || undefined }),
      });
      if (r.json?.ok && r.json.deviceKey) {
        setTillKey(r.json.deviceKey);
        onPaired();
      } else setError(r.json?.error ?? 'server_unreachable');
    } catch {
      setError('server_unreachable');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="link-page"
      data-link-pair-screen
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void pair();
        }
      }}
    >
      <div className="link-card">
        <h2>
          {t('linkPairTitle')}
          <UrHint k="linkPairTitle" />
        </h2>
        {server ? <p className="link-addr ltr-isolate">{server}</p> : null}
        <label htmlFor="link-code">{t('linkPairCode')}</label>
        <input
          id="link-code"
          className="input link-code ltr-isolate"
          inputMode="numeric"
          autoFocus
          autoComplete="off"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
        />
        <label htmlFor="link-name">{t('linkDeviceName')}</label>
        <input id="link-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        {error ? <p className="form-error" role="alert">{translateError(t, error)}</p> : null}
        <button type="button" className="btn btn--teal btn--block" disabled={busy || code.replace(/\D/g, '').length !== 6} onClick={() => void pair()}>
          {t('linkPairBtn')} <kbd className="pos-kbd">Enter</kbd>
        </button>
        <button type="button" className="btn btn--ghost btn--block" onClick={onChange}>
          {t('linkChangePc')}
        </button>
      </div>
    </div>
  );
}
