import { useEffect, useMemo, useState } from 'react';
import { useI18n, type MessageKey } from '../../i18n';
import { apiGet, apiPost, downloadXlsx } from '../../lib/api';
import { formatRsShort as rs } from '../../lib/money';
import { MoneyInput } from '../shared/MoneyInput';
import { formatQty, productUnitKey, r3 } from '../shared/productUnits';
import { PriceCheck, type PriceCheckRow } from '../purchases/pricing';
import { RepackLabels, type LabelItem } from './RepackLabels';
import { BulkStockReport } from './BulkStockReport';
import { fmtDateTime } from '../shared/dates';

type Packet = { id: string; name: string; unit_label: string; qty_each: number; qty_on_hand: number; reorder_level: number | null; last_unit_cost_paisa: number | null };
type Bulk = { id: string; name: string; unit_label: string; qty_on_hand: number; last_unit_cost_paisa: number | null; packets: Packet[] };
type Row = {
  id: string;
  short_id: string;
  bulk_name: string;
  bulk_unit: string;
  bulk_qty_used: number;
  wastage_qty: number;
  packets: number;
  made: string | null;
  total_cost_paisa: number;
  wastage_value_paisa: number;
  packing_cost_paisa: number;
  note: string | null;
  created_at: string;
  voided_at: string | null;
  user_name: string | null;
};

const ERR: Record<string, MessageKey> = {
  not_enough_bulk: 'rpErrNotEnough',
  bulk_cost_required: 'rpErrBulkCost',
  bulk_used_too_low: 'rpErrUsedLow',
  invalid_wastage: 'rpErrWastage',
  repack_lines_required: 'rpErrLines',
  invalid_qty: 'rpErrQty',
  repack_undo_same_day: 'rpErrSameDay',
  repack_packets_sold: 'rpErrSold',
  repack_already_undone: 'rpErrUndone',
};
type LabelLine = { product_id: string; product_name: string; packets: number; qty_each: number; price_paisa: number; barcode: string | null };
const toLabels = (lines: LabelLine[]): LabelItem[] =>
  lines.map((l) => ({ productId: l.product_id, name: l.product_name, kg: l.qty_each, pricePaisa: l.price_paisa, barcode: l.barcode, count: l.packets }));

const when = (s: string) => fmtDateTime(s);

export type RepackIntent = { bulkId: string; productId?: string; packets?: number } | null;

export function RepackPanel({ isOwner, intent, onDone }: { isOwner: boolean; intent: RepackIntent; onDone: () => void }) {
  const { t } = useI18n();
  const [bulks, setBulks] = useState<Bulk[] | null>(null);
  const [history, setHistory] = useState<Row[]>([]);
  const [priceRows, setPriceRows] = useState<PriceCheckRow[] | null>(null);
  /** Labels prompt comes first after a repack; the price check waits behind it. */
  const [labels, setLabels] = useState<{ title: string; items: LabelItem[] } | null>(null);
  const [pendingPrices, setPendingPrices] = useState<PriceCheckRow[] | null>(null);
  const [bulkId, setBulkId] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [wastage, setWastage] = useState('');
  const [packing, setPacking] = useState('');
  const [bulkCost, setBulkCost] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, setShort] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'new' | 'history' | 'report'>('new');

  const load = async () => {
    const [b, h] = await Promise.all([apiGet<{ items: Bulk[] }>('/repack/bulk'), apiGet<{ items: Row[] }>('/repack')]);
    setBulks(b.items ?? []);
    setHistory(h.items ?? []);
    return b.items ?? [];
  };
  useEffect(() => {
    void load().then((items) => {
      if (intent) {
        setBulkId(intent.bulkId);
        setCounts(intent.productId && intent.packets ? { [intent.productId]: String(intent.packets) } : {});
      } else if (items[0]) {
        const first = items.find((b) => b.packets.length > 0 && b.qty_on_hand > 0) ?? items.find((b) => b.packets.length > 0) ?? items[0];
        setBulkId((v) => v || first.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  const bulk = bulks?.find((b) => b.id === bulkId) ?? null;
  const unit = (u: string) => t(productUnitKey(u));
  const calc = useMemo(() => {
    if (!bulk) return null;
    const needed = r3(bulk.packets.reduce((s, p) => s + (Number(counts[p.id]) || 0) * p.qty_each, 0));
    const waste = r3(Math.max(0, Number(wastage) || 0));
    const u = r3(needed + waste);
    const cost = bulkCost.trim() ? Math.round(Number(bulkCost) * 100) : bulk.last_unit_cost_paisa ?? 0;
    const perPack = Math.round((Number(packing) || 0) * 100);
    const packets = bulk.packets.reduce((s, p) => s + (Number(counts[p.id]) || 0), 0);
    const total = Math.round(u * cost) + perPack * packets;
    // pack cost = bulk cost x kg each + wastage share (by kg) + packing per pack
    const per = (p: Packet) => (needed > 0 ? Math.round(cost * p.qty_each + (waste * cost * p.qty_each) / needed + perPack) : 0);
    const left = r3(bulk.qty_on_hand - u);
    return { needed, used: u, wastage: waste, cost, total, per, packets, left, short: u > r3(bulk.qty_on_hand) + 0.0005 };
  }, [bulk, counts, wastage, bulkCost, packing]);

  async function save() {
    if (!bulk || !calc || calc.short) return;
    setError(null);
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; error?: string; on_hand?: number; price_check?: PriceCheckRow[]; repack?: Row; lines?: LabelLine[] }>('/repack', {
        bulkId: bulk.id,
        lines: bulk.packets.map((p) => ({ productId: p.id, packets: Number(counts[p.id]) || 0 })),
        wastage: wastage.trim() || undefined,
        packingPerPackRs: packing.trim() || undefined,
        bulkCostRs: bulkCost.trim() || undefined,
        note: note.trim() || null,
      });
      if (!r.ok) {
        setError(r.error === 'not_enough_bulk' ? t('rpOnlyInStock').replace('{qty}', `${formatQty(r.on_hand ?? 0)} ${unit(bulk.unit_label)}`) : t(ERR[r.error ?? ''] ?? 'rpErrSave'));
        setShort(r.error === 'not_enough_bulk' ? r.on_hand ?? 0 : null);
        return;
      }
      setCounts({});
      setWastage('');
      setPacking('');
      setNote('');
      setShort(null);
      await load();
      setMode('history');
      const pc = r.price_check?.length ? r.price_check : null;
      if (r.repack && r.lines?.length) {
        setLabels({ title: t('rpLabelsTitle').replace('{name}', `${r.repack.short_id} · ${r.repack.bulk_name}`), items: toLabels(r.lines) });
        setPendingPrices(pc);
      } else if (pc) setPriceRows(pc);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function reprint(h: Row) {
    const r = await apiGet<{ ok: boolean; lines?: LabelLine[] }>(`/repack/${h.id}`);
    if (r.ok && r.lines?.length) setLabels({ title: t('rpLabelsTitle').replace('{name}', `${h.short_id} · ${h.bulk_name}`), items: toLabels(r.lines) });
  }

  async function undo(id: string) {
    if (!window.confirm(t('rpUndoConfirm'))) return;
    const r = await apiPost<{ ok: boolean; error?: string }>(`/repack/${id}/undo`);
    if (!r.ok) return setError(t(ERR[r.error ?? ''] ?? 'rpErrUndo'));
    await load();
    onDone();
  }

  async function exportExcel() {
    const head = (['rpCsvNo', 'rpCsvDate', 'rpCsvBulk', 'rpCsvUsed', 'rpCsvWastage', 'rpCsvMade', 'rpCsvCost', 'rpCsvPacking', 'rpCsvNote', 'rpCsvUndone'] as const).map((k) => t(k));
    const rows = history.map((h) => [
      h.short_id, when(h.created_at), h.bulk_name, `${h.bulk_qty_used} ${h.bulk_unit}`, Number(h.wastage_qty) || 0, h.made ?? '',
      Math.round(h.total_cost_paisa) / 100, Math.round(h.packing_cost_paisa) / 100, h.note ?? '', h.voided_at ? t('rpCsvYes') : '',
    ]);
    try {
      await downloadXlsx(`repack-history-${new Date().toISOString().slice(0, 10)}`, [{ name: 'Repack history', rows: [head, ...rows], widths: [8, 18, 28, 14, 10, 8, 12, 12, 24, 8] }]);
    } catch {
      setError(t('rpErrUndo'));
    }
  }

  if (bulks == null) return <p className="muted">{t('rpLoading')}</p>;
  return (
    <div className="repack" data-repack-root onKeyDown={(e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && mode === 'new') {
        e.preventDefault();
        void save();
      }
    }}>
      {labels ? (
        <RepackLabels
          title={labels.title}
          items={labels.items}
          onClose={() => {
            setLabels(null);
            if (pendingPrices) setPriceRows(pendingPrices);
            setPendingPrices(null);
          }}
        />
      ) : null}
      {priceRows && !labels ? <PriceCheck rows={priceRows} onDone={() => setPriceRows(null)} /> : null}
      <div className="po-filters" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'new'} className={`analytics-tab${mode === 'new' ? ' is-active' : ''}`} onClick={() => setMode('new')}>
          {t('rpNewRepack')}
        </button>
        <button type="button" role="tab" aria-selected={mode === 'history'} className={`analytics-tab${mode === 'history' ? ' is-active' : ''}`} onClick={() => setMode('history')}>
          {t('rpHistory')}
        </button>
        <button type="button" role="tab" aria-selected={mode === 'report'} className={`analytics-tab${mode === 'report' ? ' is-active' : ''}`} onClick={() => setMode('report')} data-tab="bulk-stock">
          {t('rpBulkStock')}
        </button>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {mode === 'report' ? <BulkStockReport isOwner={isOwner} /> : mode === 'new' ? (
        bulks.length === 0 ? (
          <p className="muted po-empty">{t('rpNoBulkItems')}</p>
        ) : (
          <div className="repack__grid">
            <section className="purchases-card">
              <div className="field">
                <label htmlFor="rp-bulk">{t('rpBulkItem')}</label>
                <select id="rp-bulk" value={bulkId} onChange={(e) => { setBulkId(e.target.value); setCounts({}); setShort(null); }} autoFocus>
                  {bulks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} · {formatQty(b.qty_on_hand)} {unit(b.unit_label)}
                    </option>
                  ))}
                </select>
              </div>
              {bulk && bulk.packets.length === 0 ? <p className="muted po-empty">{t('rpNoPackedSizes')}</p> : null}
              {bulk && bulk.packets.length > 0 ? (
                <table className="catalog-table po-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('rpPacket')}</th>
                      <th scope="col" className="catalog-table__num">{t('rpInStock')}</th>
                      <th scope="col" className="catalog-table__num">{t('rpPackets')}</th>
                      <th scope="col" className="catalog-table__num">{unit(bulk.unit_label)}</th>
                      {isOwner ? <th scope="col" className="catalog-table__num">{t('rpCostEach')}</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {bulk.packets.map((p, i) => {
                      const n = Number(counts[p.id]) || 0;
                      return (
                        <tr key={p.id} className={p.reorder_level != null && p.qty_on_hand <= p.reorder_level ? 'po-row--up' : ''}>
                          <td dir="auto">{p.name}</td>
                          <td className="catalog-table__num ltr-isolate">{formatQty(p.qty_on_hand)}</td>
                          <td className="catalog-table__num">
                            <MoneyInput
                              id={`rp-n-${i}`}
                              className="po-qty"
                              whole
                              value={counts[p.id] ?? ''}
                              onFocus={(e) => e.currentTarget.select()}
                              onValueChange={(v) => setCounts((c) => ({ ...c, [p.id]: v }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.ctrlKey) {
                                  e.preventDefault();
                                  (document.getElementById(`rp-n-${i + 1}`) ?? document.getElementById('rp-wastage'))?.focus();
                                }
                              }}
                            />
                          </td>
                          <td className="catalog-table__num ltr-isolate">{n ? formatQty(r3(n * p.qty_each)) : '—'}</td>
                          {isOwner ? <td className="catalog-table__num ltr-isolate">{n && calc ? rs(calc.per(p)) : '—'}</td> : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
            </section>
            {bulk && calc ? (
              <aside className="purchases-card po-recv__sum">
                <dl className="purchases-summary">
                  <div><dt>{t('rpInStock')}</dt><dd className="ltr-isolate">{formatQty(bulk.qty_on_hand)} {unit(bulk.unit_label)}</dd></div>
                  <div>
                    <dt><label htmlFor="rp-wastage">{t('rpWastageUnit').replace('{unit}', unit(bulk.unit_label))}</label></dt>
                    <dd><MoneyInput id="rp-wastage" maxDecimals={3} placeholder="0" value={wastage} onValueChange={setWastage} data-rp-wastage /></dd>
                  </div>
                  <div><dt>{t('rpUsed')}</dt><dd className="ltr-isolate" data-rp-used><strong>{formatQty(calc.used)}</strong> {unit(bulk.unit_label)}</dd></div>
                  <div>
                    <dt>{t('rpLeft')}</dt>
                    <dd className={`ltr-isolate${calc.short ? ' po-due' : ''}`} data-rp-left>
                      {formatQty(calc.left)} {unit(bulk.unit_label)}
                    </dd>
                  </div>
                  {isOwner ? (
                    <>
                      <div>
                        <dt><label htmlFor="rp-pack">{t('rpPackingPackRs')}</label></dt>
                        <dd><MoneyInput id="rp-pack" value={packing} placeholder="0" onValueChange={setPacking} /></dd>
                      </div>
                      {!(bulk.last_unit_cost_paisa! > 0) ? (
                        <div>
                          <dt><label htmlFor="rp-cost">{t('rpCostPerUnit').replace('{unit}', unit(bulk.unit_label))}</label></dt>
                          <dd><MoneyInput id="rp-cost" value={bulkCost} onValueChange={setBulkCost} /></dd>
                        </div>
                      ) : (
                        <div><dt>Cost / {unit(bulk.unit_label)}</dt><dd className="ltr-isolate">{rs(bulk.last_unit_cost_paisa!)}</dd></div>
                      )}
                      <div className="purchases-summary__total"><dt>{t('rpTotalCost')}</dt><dd className="ltr-isolate purchases-summary__strong">{rs(calc.total)}</dd></div>
                    </>
                  ) : null}
                  <div>
                    <dt><label htmlFor="rp-note">{t('rpNote')}</label></dt>
                    <dd><input id="rp-note" value={note} maxLength={240} onChange={(e) => setNote(e.target.value)} /></dd>
                  </div>
                </dl>
                {calc.short ? (
                  <p className="form-error" role="alert" data-rp-short>
                    Only {formatQty(bulk.qty_on_hand)} {unit(bulk.unit_label)} in stock
                  </p>
                ) : null}
                <div className="po-actions po-actions--stack">
                  <button type="button" className="btn btn--teal" disabled={busy || !(calc.needed > 0) || calc.short} onClick={() => void save()}>
                    {t('rpRepack')} <kbd>Ctrl+Enter</kbd>
                  </button>
                </div>
              </aside>
            ) : null}
          </div>
        )
      ) : (
        <>
          <div className="po-actions">
            <button type="button" className="btn btn--ghost" disabled={!history.length} onClick={() => void exportExcel()}>{t('rpExcel')}</button>
            <button type="button" className="btn btn--ghost" disabled={!history.length} onClick={() => window.print()}>PDF</button>
          </div>
          {history.length === 0 ? (
            <p className="muted po-empty">{t('rpNoRepacks')}</p>
          ) : (
            <div className="catalog-table-wrap repack-print">
              <table className="catalog-table parties-table po-table">
                <thead>
                  <tr>
                    <th scope="col">{t('rpCsvNo')}</th>
                    <th scope="col">{t('rpDate')}</th>
                    <th scope="col">{t('rpBulkItem')}</th>
                    <th scope="col" className="catalog-table__num">{t('rpUsed')}</th>
                    <th scope="col" className="catalog-table__num">{t('rpWastage')}</th>
                    <th scope="col">{t('rpMade')}</th>
                    {isOwner ? <th scope="col" className="catalog-table__num">{t('rpCost')}</th> : null}
                    <th scope="col" aria-label={t('rpActions')} />
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className={h.voided_at ? 'is-muted' : ''}>
                      <td className="ltr-isolate">{h.short_id}</td>
                      <td className="ltr-isolate">{when(h.created_at)}</td>
                      <td dir="auto">{h.bulk_name}</td>
                      <td className="catalog-table__num ltr-isolate">{formatQty(h.bulk_qty_used)} {unit(h.bulk_unit)}</td>
                      <td className="catalog-table__num ltr-isolate">{h.wastage_qty ? formatQty(h.wastage_qty) : '—'}</td>
                      <td dir="auto">{h.made}</td>
                      {isOwner ? <td className="catalog-table__num ltr-isolate">{rs(h.total_cost_paisa)}</td> : null}
                      <td>
                        {h.voided_at ? (
                          <span className="chip chip--muted">{t('rpUndone')}</span>
                        ) : (
                          <span className="rp-row-actions">
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void reprint(h)} data-rp-reprint>
                              {t('rpLabelsBtn')}
                            </button>
                            {isOwner ? (
                              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void undo(h.id)}>
                                {t('rpUndo')}
                              </button>
                            ) : null}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
