import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n/dictionary';
import { STORE_TIME_ZONE } from '../shared/discount';
import {
  buildAlerts,
  fetchAlertSources,
  type AlertSeverity,
  type AlertSources,
  type AlertTarget,
} from './alerts';
import './notifications.css';

/** Background refresh while the tab is visible. */
const POLL_MS = 60_000;
/** Navigating or opening the panel refreshes only if the last round is older than this. */
const STALE_MS = 15_000;

type Props = {
  /** Seen state is stored per signed-in user on this computer. */
  userId: string;
  /** Current screen; a change triggers a (throttled) refresh. */
  view: string;
  onNavigate: (target: AlertTarget) => void;
};

type Status = 'idle' | 'ok' | 'partial' | 'failed';

const SEVERITY_CHIP: Record<AlertSeverity, string> = {
  urgent: 'chip chip--danger',
  warning: 'chip chip--warn',
  info: 'chip chip--info',
};

const SEVERITY_LABEL: Record<AlertSeverity, MessageKey> = {
  urgent: 'notifSeverityUrgent',
  warning: 'notifSeverityWarning',
  info: 'notifSeverityInfo',
};

function seenKey(userId: string): string {
  return `dd_notif_seen_${userId}`;
}

function readSeen(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(seenKey(userId));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeSeen(userId: string, seen: Set<string>) {
  try {
    localStorage.setItem(seenKey(userId), JSON.stringify([...seen]));
  } catch {
    /* storage full or blocked: seen state just won't survive a reload */
  }
}

function formatClock(ms: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-PK', {
      timeStyle: 'short',
      timeZone: STORE_TIME_ZONE,
      numberingSystem: 'latn',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleTimeString();
  }
}

function BellIcon() {
  return (
    <svg
      className="notif-bell__icon"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M10 2.5a5 5 0 0 0-5 5v2.6c0 .6-.2 1.2-.6 1.7L3.3 13.3c-.4.5 0 1.2.6 1.2h12.2c.6 0 1-.7.6-1.2l-1.1-1.5c-.4-.5-.6-1.1-.6-1.7V7.5a5 5 0 0 0-5-5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8 16.5a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Owner notification center in the shell header: bell, unread badge, and a panel of
 * alerts computed from existing endpoints (stock, sales ending, supplier dues,
 * customer udhaar, backup age). Seen state is localStorage.
 */
export function NotificationBell({ userId, view, onNavigate }: Props) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<AlertSources>({});
  const [status, setStatus] = useState<Status>('idle');
  const [loading, setLoading] = useState(false);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [seen, setSeen] = useState<Set<string>>(() => readSeen(userId));

  const inFlight = useRef(false);
  const lastFetchAt = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastFetchAt.current = Date.now();
    setLoading(true);
    try {
      const res = await fetchAlertSources();
      // Keep the last good copy of any source that failed this round.
      setSources((prev) => ({ ...prev, ...res.sources }));
      setNow(Date.now());
      if (res.failed === 0) {
        setStatus('ok');
        setLastOkAt(Date.now());
      } else if (res.failed < res.total) {
        setStatus('partial');
        setLastOkAt(Date.now());
      } else {
        setStatus('failed');
      }
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  const refreshIfStale = useCallback(
    (maxAge: number) => {
      if (Date.now() - lastFetchAt.current >= maxAge) void refresh();
    },
    [refresh],
  );

  // New user on this computer → their own seen list.
  useEffect(() => {
    setSeen(readSeen(userId));
  }, [userId]);

  // First load + interval while visible + catch up when the window comes back.
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshIfStale(POLL_MS);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, refreshIfStale]);

  // Moving between screens (e.g. after saving a purchase) picks up changes soon.
  useEffect(() => {
    refreshIfStale(STALE_MS);
  }, [view, refreshIfStale]);

  const alerts = useMemo(
    () => buildAlerts(sources, now, t, locale),
    [sources, now, t, locale],
  );

  // Forget seen marks for alerts that are gone, only after a clean round.
  useEffect(() => {
    if (status !== 'ok') return;
    const active = new Set(alerts.map((a) => a.signature));
    setSeen((prev) => {
      const next = new Set([...prev].filter((s) => active.has(s)));
      if (next.size === prev.size) return prev;
      writeSeen(userId, next);
      return next;
    });
  }, [alerts, status, userId]);

  const unseenCount = alerts.filter((a) => !seen.has(a.signature)).length;

  const markSeen = useCallback(
    (signatures: string[]) => {
      setSeen((prev) => {
        const next = new Set(prev);
        for (const s of signatures) next.add(s);
        writeSeen(userId, next);
        return next;
      });
    },
    [userId],
  );

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  function toggle() {
    if (open) {
      close(false);
      return;
    }
    setOpen(true);
    refreshIfStale(STALE_MS);
  }

  // Focus the panel when it opens so screen readers land in it.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        close(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && open) {
      // Keep Escape from also closing a side panel on the screen below.
      e.stopPropagation();
      e.preventDefault();
      close(true);
    }
  }

  function go(signature: string, target: AlertTarget) {
    markSeen([signature]);
    close(false);
    onNavigate(target);
  }

  const buttonLabel =
    unseenCount > 0
      ? `${t('notifTitle')}, ${t('notifNewCount').replace('{n}', String(unseenCount))}`
      : t('notifTitle');

  return (
    <div className="notif" ref={wrapRef} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className={`notif-bell${open ? ' is-open' : ''}`}
        aria-label={buttonLabel}
        title={t('notifTitle')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
      >
        <BellIcon />
        {unseenCount > 0 ? (
          <span className="notif-bell__badge" aria-hidden="true">
            {unseenCount > 9 ? '9+' : unseenCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          className="notif-panel"
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <div className="notif-panel__head">
            <h2 className="notif-panel__title" id={titleId}>
              {t('notifTitle')}
            </h2>
            <div className="notif-panel__tools">
              <button
                type="button"
                className="notif-panel__link"
                onClick={() => void refresh()}
                disabled={loading}
              >
                {loading ? t('loading') : t('notifRefresh')}
              </button>
              {unseenCount > 0 ? (
                <button
                  type="button"
                  className="notif-panel__link"
                  onClick={() => {
                    markSeen(alerts.map((a) => a.signature));
                    panelRef.current?.focus();
                  }}
                >
                  {t('notifMarkAllSeen')}
                </button>
              ) : null}
            </div>
          </div>

          {status === 'failed' || status === 'partial' ? (
            <p className="notif-panel__note" role="status">
              {status === 'failed' ? t('notifLoadFailed') : t('notifLoadPartial')}
            </p>
          ) : null}

          {alerts.length === 0 ? (
            status === 'idle' ? (
              <p className="notif-panel__empty muted">{t('loading')}</p>
            ) : (
              <div className="notif-panel__empty">
                <p className="notif-panel__empty-title">{t('notifEmpty')}</p>
                <p className="muted">{t('notifEmptyDesc')}</p>
              </div>
            )
          ) : (
            <ul className="notif-list">
              {alerts.map((a) => {
                const isNew = !seen.has(a.signature);
                return (
                  <li
                    key={a.kind}
                    className={[
                      'notif-item',
                      `notif-item--${a.severity}`,
                      isNew ? 'is-new' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <div className="notif-item__meta">
                      <span className={SEVERITY_CHIP[a.severity]}>
                        {t(SEVERITY_LABEL[a.severity])}
                      </span>
                      {isNew ? (
                        <span className="notif-item__new">{t('notifNew')}</span>
                      ) : null}
                    </div>
                    <p className="notif-item__title">{a.title}</p>
                    {a.lines.length > 0 ? (
                      <ul className="notif-item__lines">
                        {a.lines.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                        {a.more > 0 ? (
                          <li className="notif-item__more">
                            {t('notifMore').replace('{n}', String(a.more))}
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                    {a.detail ? (
                      <p className="notif-item__detail">{a.detail}</p>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn--ghost notif-item__action"
                      onClick={() => go(a.signature, a.action.target)}
                    >
                      {a.action.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {lastOkAt != null ? (
            <p className="notif-panel__foot muted">
              {t('notifUpdatedAt').replace('{time}', formatClock(lastOkAt, locale))}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
