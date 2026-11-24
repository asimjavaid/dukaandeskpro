import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { apiGet, apiPost } from '../../lib/api';
import { NO_SUPPLIER_ID } from '../shared/noSupplier';

export type SupplierOpt = { id: string; name: string; phone?: string | null };

export function useSuppliers() {
  const [items, setItems] = useState<SupplierOpt[]>([]);
  const reload = () =>
    apiGet<{ items: SupplierOpt[] }>('/suppliers?page=1&pageSize=100')
      .then((r) => setItems(r.items ?? []))
      .catch(() => setItems([]));
  useEffect(() => {
    void reload();
  }, []);
  return { items, setItems, reload };
}

type Props = {
  id: string;
  value: string;
  onChange: (id: string) => void;
  suppliers: SupplierOpt[];
  onAdded: (s: SupplierOpt) => void;
  allowNone?: boolean;
  label?: string;
};

/** Supplier select with an inline "+ New" (name and phone only). */
export function SupplierPicker({ id, value, onChange, suppliers, onAdded, allowNone = true, label }: Props) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (adding) nameRef.current?.focus();
  }, [adding]);

  async function save() {
    const n = name.trim();
    if (!n) {
      setErr(t('psErrName'));
      return;
    }
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; supplier?: SupplierOpt; error?: string }>('/suppliers', {
        name: n,
        phone: phone.trim() || null,
      });
      if (!r.ok || !r.supplier) {
        setErr(t('psErrAdd'));
        return;
      }
      onAdded({ ...r.supplier, phone: phone.trim() || null });
      onChange(r.supplier.id);
      setAdding(false);
      setName('');
      setPhone('');
      setErr(null);
    } catch {
      setErr(t('psErrAdd'));
    } finally {
      setBusy(false);
    }
  }

  const list = [...suppliers]
    .filter((s) => allowNone || s.id !== NO_SUPPLIER_ID)
    .sort((a, b) => (a.id === NO_SUPPLIER_ID ? -1 : b.id === NO_SUPPLIER_ID ? 1 : a.name.localeCompare(b.name)));

  return (
    <div className="field po-supplier">
      <label htmlFor={id}>{label ?? t('psSupplier')}</label>
      {adding ? (
        <div
          className="po-supplier__new"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setAdding(false);
            }
          }}
        >
          <input id={id} ref={nameRef} placeholder={t('psName')} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <input className="ltr-isolate" placeholder={t('psPhone')} value={phone} maxLength={20} inputMode="tel" onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
          <button className="btn btn--teal" type="button" disabled={busy} onClick={() => void save()}>
            {t('psAdd')}
          </button>
          <button className="btn btn--ghost" type="button" onClick={() => setAdding(false)}>
            {t('psCancel')}
          </button>
          {err ? <span className="form-error" role="alert">{err}</span> : null}
        </div>
      ) : (
        <div className="po-supplier__row">
          <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
            {value ? null : <option value="">{t('psChooseSupplier')}</option>}
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id === NO_SUPPLIER_ID ? t('psNoSupplier') : s.name}
              </option>
            ))}
          </select>
          <button className="btn btn--ghost" type="button" onClick={() => setAdding(true)} title={t('psNewSupplierAltN')} data-hotkey="alt+n">
            + New
          </button>
        </div>
      )}
    </div>
  );
}
