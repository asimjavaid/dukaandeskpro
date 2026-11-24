import { useEffect, useState } from 'react';
import { translateError, useI18n } from '../../i18n';
import { apiGet, apiPostRaw } from '../../lib/api';
import { DEFAULT_RULES, setShopRulesCache, type ShopRules } from '../shared/shopRules';

/** Shop rules (rounding, cashier discount, credit limit, expiry) or just the drawer switch. */
export function ShopRulesSection({ only }: { only?: 'drawer' }) {
  const { t } = useI18n();
  const [rules, setRules] = useState<ShopRules>(DEFAULT_RULES);
  const [pct, setPct] = useState('0');
  const [days, setDays] = useState('30');
  const [rsPer, setRsPer] = useState('100');
  const [ptRs, setPtRs] = useState('1');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ ok: boolean; rules: ShopRules }>('/settings/rules')
      .then((r) => {
        setRules(r.rules);
        setPct(String(r.rules.cashier_discount_max_bp / 100));
        setDays(String(r.rules.expiry_alert_days));
        setRsPer(String(r.rules.loyalty_rs_per_point ?? 100));
        setPtRs(String((r.rules.loyalty_point_value_paisa ?? 100) / 100));
      })
      .catch(() => undefined);
  }, []);

  async function save(next: Partial<ShopRules>) {
    setBusy(true);
    setMsg(null);
    setErr(null);
    const res = await apiPostRaw<{ ok: boolean; rules?: ShopRules; error?: string; message?: { error?: string } }>(
      '/settings/rules',
      next,
    );
    setBusy(false);
    if (!res.json?.ok || !res.json.rules) {
      setErr(res.json?.error ?? (typeof res.json?.message === 'object' ? res.json.message?.error : null) ?? 'save_failed');
      return;
    }
    setRules(res.json.rules);
    setShopRulesCache(res.json.rules);
    setMsg(t('saved'));
  }

  if (only === 'drawer') {
    return (
      <div className="field field--check" data-drawer-kick>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={rules.drawer_kick}
            disabled={busy}
            onChange={(e) => void save({ drawer_kick: e.target.checked })}
          />
          <span>{t('rulesDrawerKick')}</span>
        </label>
      </div>
    );
  }

  return (
    <section className="settings-section" data-shop-rules>
      <h3 className="settings-section__title">{t('rulesTitle')}</h3>
      <form
        className="settings-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            round_to_paisa: rules.round_to_paisa,
            cashier_discount_max_bp: Math.round((Number(pct) || 0) * 100),
            credit_limit_mode: rules.credit_limit_mode,
            expiry_alert_days: Math.floor(Number(days) || 30),
            loyalty_enabled: rules.loyalty_enabled,
            loyalty_rs_per_point: Math.floor(Number(rsPer) || 100),
            loyalty_point_value_paisa: Math.round((Number(ptRs) || 1) * 100),
          });
        }}
      >
        <div className="field">
          <label htmlFor="rule-round">{t('rulesRounding')}</label>
          <select
            id="rule-round"
            className="input"
            value={rules.round_to_paisa}
            onChange={(e) => setRules({ ...rules, round_to_paisa: Number(e.target.value) as ShopRules['round_to_paisa'] })}
          >
            <option value={0}>{t('rulesRoundOff')}</option>
            <option value={100}>Rs 1</option>
            <option value={500}>Rs 5</option>
            <option value={1000}>Rs 10</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="rule-disc">{t('rulesCashierDiscount')}</label>
          <input
            id="rule-disc"
            className="input ltr-isolate"
            inputMode="decimal"
            value={pct}
            onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </div>
        <div className="field field--check" data-refund-manager>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={rules.cashier_refund_needs_manager}
              disabled={busy}
              onChange={(e) => void save({ cashier_refund_needs_manager: e.target.checked })}
            />
            <span>{t('rulesRefundManager')}</span>
          </label>
        </div>
        <div className="field">
          <label htmlFor="rule-credit">{t('rulesCreditMode')}</label>
          <select
            id="rule-credit"
            className="input"
            value={rules.credit_limit_mode}
            onChange={(e) => setRules({ ...rules, credit_limit_mode: e.target.value === 'block' ? 'block' : 'warn' })}
          >
            <option value="warn">{t('rulesCreditWarn')}</option>
            <option value="block">{t('rulesCreditBlock')}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="rule-expiry">{t('rulesExpiryDays')}</label>
          <input
            id="rule-expiry"
            className="input ltr-isolate"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div className="field field--check" data-loyalty-toggle>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={rules.loyalty_enabled}
              onChange={(e) => setRules({ ...rules, loyalty_enabled: e.target.checked })}
            />
            <span>{t('rulesLoyalty')}</span>
          </label>
        </div>
        {rules.loyalty_enabled ? (
          <>
            <div className="field">
              <label htmlFor="rule-rsper">{t('rulesLoyaltyRsPer')}</label>
              <input
                id="rule-rsper"
                className="input ltr-isolate"
                inputMode="numeric"
                value={rsPer}
                onChange={(e) => setRsPer(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="field">
              <label htmlFor="rule-ptrs">{t('rulesLoyaltyPointRs')}</label>
              <input
                id="rule-ptrs"
                className="input ltr-isolate"
                inputMode="decimal"
                value={ptRs}
                onChange={(e) => setPtRs(e.target.value.replace(/[^\d.]/g, ''))}
              />
            </div>
          </>
        ) : null}
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
