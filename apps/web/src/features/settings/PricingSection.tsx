import { useEffect, useState } from 'react';
import { translateError, useI18n } from '../../i18n';
import { apiGet, apiPostRaw } from '../../lib/api';
import { DEFAULT_PRICING, setPricingCache, type Pricing } from '../purchases/pricing';

/** Markup default, price rounding and the low-margin warning. */
export function PricingSection() {
  const { t } = useI18n();
  const [p, setP] = useState<Pricing>(DEFAULT_PRICING);
  const [markup, setMarkup] = useState('30');
  const [minM, setMinM] = useState('5');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ pricing: Pricing }>('/pricing/settings')
      .then((r) => {
        setP(r.pricing);
        setMarkup(String(r.pricing.default_markup_bp / 100));
        setMinM(String(r.pricing.min_margin_bp / 100));
      })
      .catch(() => undefined);
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    const res = await apiPostRaw<{ ok: boolean; pricing?: Pricing; error?: string; message?: { error?: string } }>('/pricing/settings', {
      default_markup_bp: Math.round((Number(markup) || 0) * 100),
      min_margin_bp: Math.round((Number(minM) || 0) * 100),
      round_paisa: p.round_paisa,
      round_mode: p.round_mode,
    });
    setBusy(false);
    if (!res.json?.ok || !res.json.pricing) {
      setErr(res.json?.error ?? (typeof res.json?.message === 'object' ? res.json.message?.error : null) ?? 'save_failed');
      return;
    }
    setP(res.json.pricing);
    setPricingCache(res.json.pricing);
    setMsg(t('saved'));
  }

  return (
    <section className="settings-section" data-pricing-settings>
      <h3 className="settings-section__title">Pricing</h3>
      <form
        className="settings-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="pr-markup">Markup %</label>
          <input id="pr-markup" className="input ltr-isolate" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value.replace(/[^\d.]/g, ''))} />
        </div>
        <div className="field">
          <label htmlFor="pr-round">Round to</label>
          <select id="pr-round" className="input" value={p.round_paisa} onChange={(e) => setP({ ...p, round_paisa: Number(e.target.value) })}>
            <option value={100}>Rs 1</option>
            <option value={500}>Rs 5</option>
            <option value={1000}>Rs 10</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="pr-mode">Rounding</label>
          <select id="pr-mode" className="input" value={p.round_mode} onChange={(e) => setP({ ...p, round_mode: e.target.value === 'nearest' ? 'nearest' : 'up' })}>
            <option value="up">Up</option>
            <option value="nearest">Nearest</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="pr-min">Low margin below %</label>
          <input id="pr-min" className="input ltr-isolate" inputMode="decimal" value={minM} onChange={(e) => setMinM(e.target.value.replace(/[^\d.]/g, ''))} />
        </div>
        <div className="settings-actions">
          <button type="submit" className="btn btn--teal" disabled={busy}>
            {t('save')}
          </button>
          {msg ? <span className="muted" role="status">{msg}</span> : null}
          {err ? <span className="pos-alert" role="alert">{translateError(t, err)}</span> : null}
        </div>
      </form>
    </section>
  );
}
