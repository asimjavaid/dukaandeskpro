import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { PageHeader } from '../shared/PageHeader';
import { UrHint, translateError, useI18n, type MessageKey } from '../../i18n';
import { RecoveryCodeModal } from '../auth/RecoveryCodeModal';
import { apiGet, apiPatch, apiPostRaw, setSessionToken } from '../../lib/api';
import { ShopRulesSection } from './ShopRulesSection';
import { PricingSection } from './PricingSection';
import { ResetDataSection } from './ResetDataSection';
import { ScaleSettings } from '../scale/ScaleSettings';
import { LicenceSummary } from '../license/LicenceSummary';

type LabelSize = '38x25' | '50x25' | '50x30' | '40x30';
type ReportsPaper = 'a4' | 'letter';
type SettingsTab = 'store' | 'printers' | 'account';

type StoreProfile = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  receipt_footer: string | null;
  locale_default: 'en' | 'ur';
  receipt_printer_name?: string | null;
  receipt_width_mm?: number;
  receipt_print_enabled?: boolean;
  reports_printer_name?: string | null;
  reports_paper?: string;
  label_printer_name?: string | null;
  label_size?: string;
  label_per_row?: number;
};

type AboutInfo = {
  product: string;
  version: string;
  tagline: string;
  sqlite_path_redacted: string;
  data_region: string;
};

type Props = {
  displayName: string;
};


const SETTINGS_TABS: {
  id: SettingsTab;
  labelKey: MessageKey;
  panelId: string;
}[] = [
  { id: 'store', labelKey: 'settingsStoreProfile', panelId: 'settings-panel-store' },
  { id: 'printers', labelKey: 'printersTitle', panelId: 'settings-panel-printers' },
  { id: 'account', labelKey: 'settingsTabAccount', panelId: 'settings-panel-account' },
];

export function SettingsShell({ displayName }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<SettingsTab>('store');
  const [store, setStore] = useState<StoreProfile | null>(null);
  const [about, setAbout] = useState<AboutInfo | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [recCode, setRecCode] = useState<string | null>(null);
  const [recBusy, setRecBusy] = useState(false);
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  const [receiptPrinter, setReceiptPrinter] = useState('');
  const [receiptWidth, setReceiptWidth] = useState<58 | 80>(80);
  const [receiptPrintEnabled, setReceiptPrintEnabled] = useState(true);
  const [reportsPrinter, setReportsPrinter] = useState('');
  const [reportsPaper, setReportsPaper] = useState<ReportsPaper>('a4');
  const [labelPrinter, setLabelPrinter] = useState('');
  const [labelSize, setLabelSize] = useState<LabelSize>('50x25');
  const [labelPerRow, setLabelPerRow] = useState(3);
  const [printerBusy, setPrinterBusy] = useState(false);
  const [printerMsg, setPrinterMsg] = useState<string | null>(null);
  const [printerError, setPrinterError] = useState<string | null>(null);



  const refresh = useCallback(async () => {
    const [storeRes, aboutRes] = await Promise.all([
      apiGet<{ ok: boolean; store: StoreProfile }>('/settings/store'),
      apiGet<{ ok: boolean; about: AboutInfo }>('/settings/about'),
    ]);
    setStore(storeRes.store);
    setAbout(aboutRes.about);
    setName(storeRes.store.name ?? '');
    setPhone(storeRes.store.phone ?? '');
    setAddress(storeRes.store.address ?? '');
    setReceiptFooter(storeRes.store.receipt_footer ?? '');
    const profile = storeRes.store;
    setReceiptPrinter(profile.receipt_printer_name ?? '');
    setReceiptWidth(profile.receipt_width_mm === 58 ? 58 : 80);
    setReceiptPrintEnabled(profile.receipt_print_enabled !== false);
    setReportsPrinter(profile.reports_printer_name ?? '');
    setReportsPaper(profile.reports_paper === 'letter' ? 'letter' : 'a4');
    const size = profile.label_size;
    setLabelSize(
      size === '38x25' || size === '50x25' || size === '50x30' || size === '40x30'
        ? size
        : '50x25',
    );
    const per = Math.floor(Number(profile.label_per_row));
    setLabelPerRow(per >= 1 && per <= 5 ? per : 3);
  }, []);

  useEffect(() => {
    refresh().catch(() => setError('settings_unavailable'));
  }, [refresh]);

  function selectTab(next: SettingsTab) {
    setTab(next);
    queueMicrotask(() => {
      document.getElementById(`settings-tab-${next}`)?.focus();
    });
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rtl = false;
    let delta = 0;
    if (event.key === 'ArrowRight') delta = rtl ? -1 : 1;
    else if (event.key === 'ArrowLeft') delta = rtl ? 1 : -1;
    else if (event.key === 'Home') {
      event.preventDefault();
      selectTab(SETTINGS_TABS[0].id);
      return;
    } else if (event.key === 'End') {
      event.preventDefault();
      selectTab(SETTINGS_TABS[SETTINGS_TABS.length - 1].id);
      return;
    } else {
      return;
    }
    event.preventDefault();
    const index = SETTINGS_TABS.findIndex((item) => item.id === tab);
    const next =
      SETTINGS_TABS[
        (index + delta + SETTINGS_TABS.length) % SETTINGS_TABS.length
      ];
    selectTab(next.id);
  }

  async function onSaveStore(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await apiPatch<{ ok: boolean; store: StoreProfile }>(
        '/settings/store',
        {
          name: name.trim(),
          phone: phone.trim() || null,
          address: address.trim() || null,
          receipt_footer: receiptFooter.trim() || null,
          locale_default: 'en',
        },
      );
      setStore(res.store);
      setMsg(t('settingsSaved'));
    } catch {
      setError('settings_save_failed');
    } finally {
      setBusy(false);
    }
  }

  async function onSavePrinters(e: React.FormEvent) {
    e.preventDefault();
    setPrinterBusy(true);
    setPrinterError(null);
    setPrinterMsg(null);
    try {
      const res = await apiPatch<{ ok: boolean; store: StoreProfile }>(
        '/settings/store',
        {
          receipt_printer_name: receiptPrinter.trim() || null,
          receipt_width_mm: receiptWidth,
          receipt_print_enabled: receiptPrintEnabled,
          reports_printer_name: reportsPrinter.trim() || null,
          reports_paper: reportsPaper,
          label_printer_name: labelPrinter.trim() || null,
          label_size: labelSize,
          label_per_row: labelPerRow,
        },
      );
      setStore(res.store);
      setPrinterMsg(t('settingsSaved'));
    } catch {
      setPrinterError('settings_save_failed');
    } finally {
      setPrinterBusy(false);
    }
  }




  async function newRecovery() {
    setRecBusy(true);
    const r = await apiPostRaw<{ ok: boolean; code: string }>('/auth/recovery/generate').catch(() => null);
    setRecBusy(false);
    if (r?.ok && r.json?.ok) setRecCode(r.json.code);
  }

  async function ackRecovery() {
    setRecBusy(true);
    await apiPostRaw('/auth/recovery/ack').catch(() => null);
    setRecBusy(false);
    setRecCode(null);
  }

  async function onChangePin(e: React.FormEvent) {
    e.preventDefault();
    setPinBusy(true);
    setPinError(null);
    setPinMsg(null);
    if (!/^[0-9]{4,6}$/.test(currentPin) || !/^[0-9]{4,6}$/.test(newPin)) {
      setPinError(t('settingsPinInvalid'));
      setPinBusy(false);
      return;
    }
    if (newPin !== confirmNewPin) {
      setPinError(t('settingsPinMismatch'));
      setPinBusy(false);
      return;
    }
    try {
      const res = await apiPostRaw<{ ok?: boolean; message?: unknown; sessionToken?: string }>(
        '/settings/pin',
        { current_pin: currentPin, new_pin: newPin },
      );
      if (res.status === 401) {
        setPinError(t('settingsPinBadCurrent'));
        return;
      }
      if (!res.ok) {
        setPinError(t('settingsPinFailed'));
        return;
      }
      // Old sessions end on a PIN change; keep this one with the fresh token.
      if (res.json?.sessionToken) setSessionToken(res.json.sessionToken);
      setPinMsg(t('settingsPinChanged'));
      setCurrentPin('');
      setNewPin('');
      setConfirmNewPin('');
    } catch {
      setPinError(t('settingsPinFailed'));
    } finally {
      setPinBusy(false);
    }
  }

  return (
    <div className="card settings">
      <PageHeader title={<>{t('settings')}<UrHint k="settings" /></>} subtitle={displayName} />

      <div
        className="settings-tabs"
        role="tablist"
        aria-label={t('settings')}
        onKeyDown={onTabKeyDown}
      >
        {SETTINGS_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`settings-tab-${item.id}`}
            className={`settings-tab${tab === item.id ? ' is-active' : ''}`}
            aria-selected={tab === item.id}
            aria-controls={item.panelId}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="settings-panel-store"
        className="settings-panel"
        aria-labelledby="settings-tab-store"
        hidden={tab !== 'store'}
      >
        <section className="settings-section">
          <h3 className="settings-section__title" data-store-id={store?.id}>
            {t('settingsStoreProfile')}
          </h3>
          <form className="settings-fields" onSubmit={(e) => void onSaveStore(e)}>
            <div className="field">
              <label htmlFor="settings-store-name">{t('storeName')}</label>
              <input
                id="settings-store-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
              />
            </div>
            <div className="field">
              <label htmlFor="settings-phone">{t('settingsPhone')}</label>
              <input
                id="settings-phone"
                className="ltr-isolate"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={32}
                inputMode="tel"
              />
            </div>
            <div className="field">
              <label htmlFor="settings-address">{t('settingsAddress')}</label>
              <input
                id="settings-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={240}
              />
            </div>
            <div className="field">
              <label htmlFor="settings-footer">{t('settingsReceiptFooter')}</label>
              <textarea
                id="settings-footer"
                value={receiptFooter}
                onChange={(e) => setReceiptFooter(e.target.value)}
                maxLength={280}
                rows={2}
              />
            </div>
            <button type="submit" className="btn btn--teal" disabled={busy}>
              {busy ? t('loading') : t('settingsSave')}
            </button>
            {msg ? (
              <p className="muted" role="status">
                {msg}
              </p>
            ) : null}
            {error ? (
              <p className="muted settings-alert" role="alert">
                {translateError(t, error)}
              </p>
            ) : null}
          </form>
        </section>

        <ShopRulesSection />
        <PricingSection />
      </div>


      <div
        role="tabpanel"
        id="settings-panel-printers"
        className="settings-panel"
        aria-labelledby="settings-tab-printers"
        hidden={tab !== 'printers'}
      >
        <section className="settings-section">
          <h3 className="settings-section__title">{t('printersTitle')}</h3>
          <p className="muted settings-section__intro">{t('printersNote')}</p>
          <form
            className="settings-fields"
            onSubmit={(e) => void onSavePrinters(e)}
          >
            <h4 className="settings-subhead">{t('printerReceipt')}</h4>
            <div className="field">
              <label htmlFor="printer-receipt-name">{t('printerName')}</label>
              <input
                id="printer-receipt-name"
                value={receiptPrinter}
                onChange={(e) => setReceiptPrinter(e.target.value)}
                maxLength={64}
                placeholder={t('printerNameHint')}
              />
            </div>
            <div className="field">
              <label htmlFor="printer-receipt-width">{t('receiptWidth')}</label>
              <select
                id="printer-receipt-width"
                value={receiptWidth}
                onChange={(e) =>
                  setReceiptWidth(e.target.value === '58' ? 58 : 80)
                }
              >
                <option value="80">{t('receiptWidth80')}</option>
                <option value="58">{t('receiptWidth58')}</option>
              </select>
            </div>
            <div className="field field--check">
              <label htmlFor="printer-receipt-print" className="settings-check">
                <input
                  id="printer-receipt-print"
                  type="checkbox"
                  checked={receiptPrintEnabled}
                  onChange={(e) => setReceiptPrintEnabled(e.target.checked)}
                />
                <span>{t('receiptPrintAfterSale')}</span>
              </label>
              <p className="muted settings-check__hint">{t('receiptPrintAfterSaleHint')}</p>
            </div>

            <ShopRulesSection only="drawer" />
            <ScaleSettings />

            <h4 className="settings-subhead">{t('printerReports')}</h4>
            <div className="field">
              <label htmlFor="printer-reports-name">{t('printerName')}</label>
              <input
                id="printer-reports-name"
                value={reportsPrinter}
                onChange={(e) => setReportsPrinter(e.target.value)}
                maxLength={64}
                placeholder={t('printerNameHint')}
              />
            </div>
            <div className="field">
              <label htmlFor="printer-reports-paper">{t('reportsPaper')}</label>
              <select
                id="printer-reports-paper"
                value={reportsPaper}
                onChange={(e) =>
                  setReportsPaper(e.target.value === 'letter' ? 'letter' : 'a4')
                }
              >
                <option value="a4">{t('reportsPaperA4')}</option>
                <option value="letter">{t('reportsPaperLetter')}</option>
              </select>
            </div>

            <h4 className="settings-subhead">{t('printerLabels')}</h4>
            <div className="field">
              <label htmlFor="printer-label-name">{t('printerName')}</label>
              <input
                id="printer-label-name"
                value={labelPrinter}
                onChange={(e) => setLabelPrinter(e.target.value)}
                maxLength={64}
                placeholder={t('printerNameHint')}
              />
            </div>
            <div className="field">
              <label htmlFor="printer-label-size">{t('stickerSize')}</label>
              <select
                id="printer-label-size"
                value={labelSize}
                onChange={(e) => setLabelSize(e.target.value as LabelSize)}
              >
                <option value="38x25">{t('stickerSize38x25')}</option>
                <option value="50x25">{t('stickerSize50x25')}</option>
                <option value="50x30">{t('stickerSize50x30')}</option>
                <option value="40x30">{t('stickerSize40x30')}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="printer-label-row">{t('stickerPerRow')}</label>
              <select
                id="printer-label-row"
                value={labelPerRow}
                onChange={(e) => setLabelPerRow(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="btn btn--teal"
              disabled={printerBusy}
            >
              {printerBusy ? t('loading') : t('settingsSave')}
            </button>
            {printerMsg ? (
              <p className="muted" role="status">
                {printerMsg}
              </p>
            ) : null}
            {printerError ? (
              <p className="muted settings-alert" role="alert">
                {translateError(t, printerError)}
              </p>
            ) : null}
          </form>
        </section>
      </div>

      <div
        role="tabpanel"
        id="settings-panel-account"
        className="settings-panel"
        aria-labelledby="settings-tab-account"
        hidden={tab !== 'account'}
      >
        <section className="settings-section">
          <h3 className="settings-section__title">{t('settingsChangePin')}</h3>
          <form className="settings-fields" onSubmit={(e) => void onChangePin(e)}>
            <div className="field">
              <label htmlFor="settings-current-pin">{t('settingsCurrentPin')}</label>
              <input
                id="settings-current-pin"
                className="ltr-isolate"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={currentPin}
                onChange={(e) =>
                  setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                dir="ltr"
                maxLength={6}
              />
            </div>
            <div className="field">
              <label htmlFor="settings-new-pin">{t('settingsNewPin')}</label>
              <input
                id="settings-new-pin"
                className="ltr-isolate"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={newPin}
                onChange={(e) =>
                  setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                dir="ltr"
                maxLength={6}
              />
            </div>
            <div className="field">
              <label htmlFor="settings-confirm-pin">{t('confirmPin')}</label>
              <input
                id="settings-confirm-pin"
                className="ltr-isolate"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={confirmNewPin}
                onChange={(e) =>
                  setConfirmNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                dir="ltr"
                maxLength={6}
              />
            </div>
            <button type="submit" className="btn btn--teal" disabled={pinBusy}>
              {pinBusy ? t('loading') : t('settingsChangePin')}
            </button>
            {pinMsg ? (
              <p className="muted" role="status">
                {pinMsg}
              </p>
            ) : null}
            {pinError ? (
              <p className="muted settings-alert" role="alert">
                {pinError}
              </p>
            ) : null}
          </form>
        </section>
        <section className="settings-section">
          <h3 className="settings-section__title">{t('recoveryCode')}</h3>
          <div className="settings-fields">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={recBusy}
              onClick={() => void newRecovery()}
            >
              {t('recoveryNew')}
            </button>
          </div>
        </section>
        {recCode ? (
          <RecoveryCodeModal code={recCode} busy={recBusy} onDone={() => void ackRecovery()} />
        ) : null}

        <section className="settings-section" data-licence-section>
          <h3 className="settings-section__title">Licence</h3>
          <div className="settings-section__body">
            <LicenceSummary />
          </div>
        </section>

        <section className="settings-section">
          <h3 className="settings-section__title">{t('settingsAbout')}</h3>
          <div className="settings-section__body">
            {about ? (
              <>
                <p style={{ margin: 0 }}>
                  <strong>{about.product}</strong>{' '}
                  <span className="chip ltr-isolate">v{about.version}</span>
                </p>
                <p className="muted" style={{ margin: 0 }}>
                  {about.tagline}
                </p>
                <p className="muted ltr-isolate" style={{ margin: 0 }}>
                  {t('settingsSqlite')}: {about.sqlite_path_redacted}
                </p>
                <p className="muted ltr-isolate" style={{ margin: 0 }}>
                  {t('backupDataRegion')}: {about.data_region}
                </p>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {t('loading')}
              </p>
            )}
          </div>
        </section>
        <ResetDataSection />
      </div>
    </div>
  );
}
