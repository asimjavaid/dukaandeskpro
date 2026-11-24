import { useState } from 'react';
import { translateError, useI18n } from '../../i18n';
import { getScaleSettings, readScale, saveScaleSettings, scaleSupported, type ScaleSettings as S } from './scale';

const BAUDS = [2400, 4800, 9600, 19200, 38400];

/** Weighing scale (this PC only): on/off, port, speed, poll command, test read. */
export function ScaleSettings() {
  const { t } = useI18n();
  const [s, setS] = useState<S>(getScaleSettings);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = scaleSupported();

  function update(next: S) {
    setS(next);
    saveScaleSettings(next);
    setMsg(t('saved'));
    setErr(null);
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const kg = await readScale(s);
      setMsg(`${kg} kg`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'scale_no_reading');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-scale" data-scale-settings>
      <h4 className="settings-subhead">{t('scaleTitle')}</h4>
      <div className="field field--check">
        <label className="settings-check">
          <input
            type="checkbox"
            checked={s.enabled}
            disabled={!supported}
            onChange={(e) => update({ ...s, enabled: e.target.checked })}
          />
          <span>{t('scaleEnable')}</span>
        </label>
      </div>
      {s.enabled ? (
        <>
          <div className="field">
            <label htmlFor="scale-port">{t('scalePort')}</label>
            <input
              id="scale-port"
              className="input ltr-isolate"
              placeholder="COM3"
              value={s.portName}
              onChange={(e) => setS({ ...s, portName: e.target.value.trim() })}
              onBlur={() => update(s)}
            />
          </div>
          <div className="field">
            <label htmlFor="scale-baud">{t('scaleBaud')}</label>
            <select
              id="scale-baud"
              className="input"
              value={s.baud}
              onChange={(e) => update({ ...s, baud: Number(e.target.value) })}
            >
              {BAUDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="scale-poll">{t('scalePoll')}</label>
            <input
              id="scale-poll"
              className="input ltr-isolate"
              placeholder="W"
              maxLength={8}
              value={s.poll}
              onChange={(e) => setS({ ...s, poll: e.target.value })}
              onBlur={() => update(s)}
            />
          </div>
          <div className="settings-actions">
            <button type="button" className="btn btn--ghost" disabled={busy} data-scale-test onClick={() => void test()}>
              {t('scaleTest')}
            </button>
            {msg ? <span className="muted ltr-isolate" role="status">{msg}</span> : null}
            {err ? <span className="pos-alert" role="alert">{translateError(t, err)}</span> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
