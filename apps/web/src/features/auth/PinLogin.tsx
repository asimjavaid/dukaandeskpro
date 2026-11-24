import { useEffect, useState } from 'react';
import { translateError, useI18n } from '../../i18n';
import { apiGet, apiPost, apiPostRaw, setSessionToken } from '../../lib/api';
import { RecoveryCodeModal } from './RecoveryCodeModal';

type UserRow = { id: string; displayName: string; role: string };

type Session = {
  userId: string;
  displayName: string;
  role: 'owner' | 'manager' | 'cashier' | 'data_entry';
  storeId: string;
};

type Props = {
  onLoggedIn: (session: Session) => void;
};

export function PinLogin({ onLoggedIn }: Props) {
  const { t } = useI18n();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [code, setCode] = useState('');
  const [rPin, setRPin] = useState('');
  const [rPin2, setRPin2] = useState('');
  const [fresh, setFresh] = useState<{ code: string; session: Session } | null>(null);

  useEffect(() => {
    apiGet<{ users: UserRow[] }>('/auth/users')
      .then((r) => {
        setUsers(r.users);
        if (r.users[0]) setUserId(r.users[0].id);
      })
      .catch(() => setError('users_unavailable'));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<
        | { ok: true; session: Session; sessionToken?: string }
        | { ok: false; error: string }
      >('/auth/login', { userId, pin });
      if (!res.ok) {
        setError(res.error);
        // Wrong PIN: clear it so the next try starts clean.
        setPin('');
        return;
      }
      if (res.sessionToken) setSessionToken(res.sessionToken);
      onLoggedIn(res.session);
    } catch {
      setError('login_failed');
    } finally {
      setBusy(false);
    }
  }

  async function recover(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (rPin !== rPin2) {
      setError('pin_mismatch');
      return;
    }
    setBusy(true);
    try {
      const r = await apiPostRaw<
        | { ok: true; session: Session; sessionToken?: string; code: string }
        | { ok: false; error: string }
      >('/auth/recover', { code, newPin: rPin, confirmPin: rPin2 });
      const j = r.json;
      if (!j || !j.ok) {
        setError(j && !j.ok ? j.error : 'login_failed');
        return;
      }
      if (j.sessionToken) setSessionToken(j.sessionToken);
      setFresh({ code: j.code, session: j.session });
    } catch {
      setError('login_failed');
    } finally {
      setBusy(false);
    }
  }

  async function finishRecovery() {
    if (!fresh) return;
    setBusy(true);
    await apiPost('/auth/recovery/ack').catch(() => null);
    setBusy(false);
    onLoggedIn(fresh.session);
  }

  const pinInput = (id: string, value: string, set: (v: string) => void, label: string) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="ltr-isolate"
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        dir="ltr"
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 6))}
        maxLength={6}
      />
    </div>
  );

  if (fresh) {
    return <RecoveryCodeModal code={fresh.code} busy={busy} onDone={() => void finishRecovery()} />;
  }

  if (forgot) {
    return (
      <div className="card auth-card">
        <h2 style={{ marginTop: 0 }}>{t('forgotPin')}</h2>
        <form onSubmit={recover} style={{ display: 'grid', gap: 12 }}>
          <div className="field">
            <label htmlFor="recovery-code">{t('recoveryCode')}</label>
            <input
              id="recovery-code"
              className="ltr-isolate"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 16))}
              placeholder="XXXX-XXXX-XXXX"
              autoFocus
            />
          </div>
          {pinInput('recover-pin', rPin, setRPin, t('settingsNewPin'))}
          {pinInput('recover-pin2', rPin2, setRPin2, t('confirmPin'))}
          {error ? (
            <p className="muted" role="alert" style={{ color: 'var(--danger)' }}>
              {translateError(t, error)}
            </p>
          ) : null}
          <button
            className="btn btn--teal"
            type="submit"
            disabled={busy || code.replace(/[^A-Z0-9]/g, '').length !== 12 || rPin.length < 4 || rPin2.length < 4}
          >
            {t('recoverSetPin')}
          </button>
          <button
            type="button"
            className="auth-card__link"
            onClick={() => {
              setForgot(false);
              setError(null);
            }}
          >
            {t('recoverBack')}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="card auth-card">
      <h2 style={{ marginTop: 0 }}>{t('pinLogin')}</h2>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <div className="field">
          <label htmlFor="user">{t('selectUser')}</label>
          <select
            id="user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} · {u.role === 'owner' ? t('owner') : u.role === 'data_entry' ? t('roleDataEntry') : u.role === 'manager' ? t('roleManager') : t('cashier')}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pin">{t('pin')}</label>
          <input
            id="pin"
            className="ltr-isolate"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            dir="ltr"
            value={pin}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
            placeholder="••••"
            minLength={4}
            maxLength={6}
            autoFocus
          />
        </div>
        {error ? (
          <p className="muted" role="alert" style={{ color: 'var(--danger)' }}>
            {translateError(t, error)}
          </p>
        ) : null}
        <button
          className="btn btn--teal"
          type="submit"
          disabled={busy || !userId || pin.length < 4}
        >
          {t('signIn')}
        </button>
        <button
          type="button"
          className="auth-card__link"
          onClick={() => {
            setForgot(true);
            setError(null);
          }}
        >
          {t('forgotPin')}
        </button>
      </form>
    </div>
  );
}
