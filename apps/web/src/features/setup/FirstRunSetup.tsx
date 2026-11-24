import { useState } from 'react';
import { translateError, useI18n } from '../../i18n';
import { apiPost, setSessionToken } from '../../lib/api';

type Session = {
  userId: string;
  displayName: string;
  role: 'owner' | 'cashier';
  storeId: string;
};

type Props = {
  onDone: (session: Session) => void;
};

type Step = 'form' | 'sample';

export function FirstRunSetup({ onDone }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('form');
  const [displayName, setDisplayName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<Session | null>(null);


  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pin !== pin2) {
      setError('pin_mismatch');
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<
        | {
            ok: true;
            session: Session;
            sessionToken?: string;
            store?: { id: string; name: string; locale_default?: string };
          }
        | { ok: false; error: string }
      >('/auth/setup', {
        displayName,
        pin,
        storeName: storeName.trim() || undefined,
        locale_default: 'en',
        locale: 'en',
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.sessionToken) setSessionToken(res.sessionToken);
      setSession(res.session);
      setStep('sample');
    } catch {
      setError('setup_failed');
    } finally {
      setBusy(false);
    }
  }

  async function addSample() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<
        | { ok: true; product: { id: string }; created: boolean }
        | { ok: false; error: string }
      >('/catalog/sample', {});
      if (!res.ok) {
        setError('sample_failed');
        return;
      }
      onDone(session);
    } catch {
      setError('sample_failed');
    } finally {
      setBusy(false);
    }
  }

  function skipSample() {
    if (session) onDone(session);
  }

  if (step === 'sample') {
    return (
      <div className="card auth-card">
        <h2 style={{ marginTop: 0 }}>{t('sampleTitle')}</h2>
        <p className="muted">{t('sampleNote')}</p>
        {error ? (
          <p className="muted" role="alert" style={{ color: 'var(--danger)' }}>
            {translateError(t, error)}
          </p>
        ) : null}
        <div className="nav-row" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn--teal"
            disabled={busy}
            onClick={() => void addSample()}
          >
            {t('sampleAdd')}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={skipSample}
          >
            {t('sampleSkip')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card auth-card">
      <h2 style={{ marginTop: 0 }}>{t('firstRunTitle')}</h2>
      <p className="muted">{t('firstRunNote')}</p>

      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <div className="field">
          <label htmlFor="displayName">{t('displayName')}</label>
          <input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            autoComplete="name"
          />
        </div>
        <div className="field">
          <label htmlFor="storeName">{t('storeName')}</label>
          <input
            id="storeName"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder={t('storeNamePlaceholder')}
          />
        </div>
        <div className="field">
          <label htmlFor="pin">{t('pin')}</label>
          <input
            id="pin"
            className="ltr-isolate"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            dir="ltr"
            value={pin}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
            placeholder="••••"
            required
            minLength={4}
            maxLength={6}
          />
        </div>
        <div className="field">
          <label htmlFor="pin2">{t('confirmPin')}</label>
          <input
            id="pin2"
            className="ltr-isolate"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            dir="ltr"
            value={pin2}
            onChange={(e) =>
              setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
            placeholder="••••"
            required
            minLength={4}
            maxLength={6}
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
          disabled={busy || displayName.trim().length === 0 || pin.length < 4}
        >
          {t('createOwner')}
        </button>
      </form>
    </div>
  );
}
