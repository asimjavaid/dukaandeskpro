import { useI18n } from '../../i18n';
import { MEASURE_LABEL, measuresFor, type Measure } from '../purchases/measures';

export type BuyDraft = { loose: boolean; measure: string; bulkId: string; packKg: string };

/** Product → API fields: loose = bulk (kg); a Packed-from link = packed (still bought ready); else normal. */
export function buyPayload(d: BuyDraft, unit: string) {
  if (d.loose) return { productType: 'bulk', buyMeasure: 'kg' };
  const ok = measuresFor({ unit_label: unit });
  const buyMeasure = ok.includes(d.measure as Measure) ? d.measure : ok[0];
  if (d.bulkId && unit !== 'kg') return { productType: 'packed', bulkId: d.bulkId, packKg: d.packKg, buyMeasure };
  return { productType: 'normal', buyMeasure };
}

/** Bought loose / Bought by / Packed from + kg per pack. Shared by Add and Edit product. */
export function BuyFields({
  idp,
  unit,
  draft,
  onChange,
  onLoose,
  bulks,
}: {
  idp: string;
  unit: string;
  draft: BuyDraft;
  onChange: (d: BuyDraft) => void;
  /** Checking "Bought loose" makes the item kg. */
  onLoose: (loose: boolean) => void;
  bulks: Array<{ id: string; name: string }>;
}) {
  const { t } = useI18n();
  const ms = measuresFor({ unit_label: unit });
  const value = ms.includes(draft.measure as Measure) ? draft.measure : ms[0];
  return (
    <div className="buy-fields" data-buy-fields>
      <div className="field field--check">
        <label className="settings-check">
          <input
            type="checkbox"
            id={`${idp}-loose`}
            checked={draft.loose}
            onChange={(e) => {
              onChange({ ...draft, loose: e.target.checked, bulkId: e.target.checked ? '' : draft.bulkId });
              onLoose(e.target.checked);
            }}
            data-bought-loose
          />
          <span>{t('buBoughtLoose')}</span>
        </label>
      </div>
      {!draft.loose ? (
        <div className="field">
          <label htmlFor={`${idp}-measure`}>{t('buBoughtBy')}</label>
          <select id={`${idp}-measure`} value={value} onChange={(e) => onChange({ ...draft, measure: e.target.value })} data-buy-measure>
            {ms.map((m) => (
              <option key={m} value={m}>
                {MEASURE_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {!draft.loose && unit !== 'kg' ? (
        <div className="field buy-fields__from" data-packed-from>
          <label htmlFor={`${idp}-from`}>{t('buPackedFrom')}</label>
          <select id={`${idp}-from`} value={draft.bulkId} onChange={(e) => onChange({ ...draft, bulkId: e.target.value })}>
            <option value="">—</option>
            {bulks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {draft.bulkId ? (
            <>
              <label htmlFor={`${idp}-pack-kg`}>{t('ptKgPerPack')}</label>
              <input
                id={`${idp}-pack-kg`}
                className="ltr-isolate"
                inputMode="decimal"
                value={draft.packKg}
                onChange={(e) => onChange({ ...draft, packKg: e.target.value.replace(/[^\d.]/g, '') })}
                required
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
