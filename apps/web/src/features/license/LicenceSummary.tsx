import { openActivation, useLicenceStatus } from './readOnly';
import { fmtDate, statusLabel, type LicenceStatus } from './LicenseGate';

/** Settings › Licence: one line + "Open licence" (opens the Licence screen). */
export function LicenceSummary() {
  const s = useLicenceStatus<LicenceStatus | null>();
  if (!s || s.machineCode === 'DEV') {
    return (
      <div className="lic-summary">
        <span className="lic-summary__text">Development copy (no licence check)</span>
      </div>
    );
  }
  const label = statusLabel(s);
  const detail =
    s.state === 'trial'
      ? `${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left${s.showHoursLeft ? ` · ${s.hoursLeft} h of use left` : ''}`
      : s.state === 'licensed'
        ? [s.licence?.shop, s.licence?.updatesUntil ? `updates until ${fmtDate(s.licence.updatesUntil)}` : 'updates: no limit'].filter(Boolean).join(' · ')
        : 'Activate to sell and make changes';
  return (
    <div className="lic-summary">
      <span className={`lic-badge lic-badge--${label.tone}`}>{label.text}</span>
      <span className="lic-summary__text">{detail}</span>
      <button type="button" className="btn btn--ghost" onClick={openActivation} data-open-licence>Open licence</button>
    </div>
  );
}
