import { useEffect, useState } from 'react';
import { translateError, useI18n } from '../../i18n';
import { apiGet, apiPostRaw } from '../../lib/api';
import { ConfirmModal } from '../shared/ConfirmModal';

type User = { id: string; displayName: string; role: string };
export type ApprovalAction = 'refund' | 'price_override';

/** Manager (or owner) types their PIN at this till; returns a one-time approval token. */
export function ManagerApproval({
  action,
  onApproved,
  onCancel,
}: {
  action: ApprovalAction;
  onApproved: (approval: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ users: User[] }>('/auth/users')
      .then((r) => {
        const m = (r.users ?? []).filter((u) => u.role === 'manager' || u.role === 'owner');
        setUsers(m);
        setUserId(m.find((u) => u.role === 'manager')?.id ?? m[0]?.id ?? '');
      })
      .catch(() => setUsers([]));
  }, []);

  async function approve() {
    if (!userId || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiPostRaw<{ ok: boolean; approval?: string; error?: string }>('/auth/approve', { userId, pin, action });
      if (r.json?.ok && r.json.approval) onApproved(r.json.approval);
      else {
        setError(r.json?.error ?? 'error_generic');
        setPin('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmModal
      title={t('approveTitle')}
      message=""
      tone="primary"
      confirmLabel={t('approveOk')}
      cancelLabel={t('cancel')}
      busy={busy}
      confirmDisabled={!userId || pin.length < 4}
      onConfirm={() => void approve()}
      onCancel={onCancel}
    >
      <form
        data-manager-approval
        onSubmit={(e) => {
          e.preventDefault();
          void approve();
        }}
      >
        <div className="field">
          <label htmlFor="appr-pin">{t('approvePin')}</label>
          <input
            id="appr-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            autoFocus
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div className="field">
          <label htmlFor="appr-user">{t('approveManager')}</label>
          <select id="appr-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} · {u.role === 'owner' ? t('owner') : t('roleManager')}
              </option>
            ))}
          </select>
        </div>
        {error ? (
          <p className="muted" role="alert" style={{ color: 'var(--danger)' }}>
            {translateError(t, error)}
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </ConfirmModal>
  );
}
