import { useEffect, useState } from 'react';
import { apiGet } from '../../lib/api';
import { formatRsShort as rs } from '../../lib/money';
import { formatQty } from '../shared/productUnits';
import { weightText } from './RepackLabels';

type Pack = { id: string; name: string; kg_each: number; packs: number; kg: number };
type Item = {
  id: string;
  name: string;
  kg_in_hand: number;
  packs: Pack[];
  kg_in_packs: number;
  kg_total: number;
  repacked_kg: number;
  wastage_kg: number;
  wastage_cost_paisa?: number;
  stock_cost_paisa?: number;
};
type Report = { items: Item[]; totals: { kg_in_hand: number; kg_in_packs: number; repacked_kg: number; wastage_kg: number; wastage_cost_paisa?: number } };

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(d);

/** Bulk stock: kg in hand, kg in packs by size, wastage in the period. */
export function BulkStockReport({ isOwner }: { isOwner: boolean }) {
  const today = ymd(new Date());
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Report | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    apiGet<Report>(`/repack/report?from=${from}&to=${to}`)
      .then(setData)
      .catch(() => setData({ items: [], totals: { kg_in_hand: 0, kg_in_packs: 0, repacked_kg: 0, wastage_kg: 0 } }));
  }, [from, to]);
  if (!data) return <p className="muted">Loading…</p>;
  const rows = all ? data.items : data.items.filter((i) => i.kg_total > 0 || i.wastage_kg > 0 || i.repacked_kg > 0);
  const kg = (n: number) => `${formatQty(n)} kg`;
  return (
    <div className="bulk-report" data-bulk-report>
      <div className="po-filters bulk-report__filters">
        <label className="field">
          <span>From</span>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="settings-check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          <span>Show empty</span>
        </label>
      </div>
      <div className="catalog-table-wrap">
        <table className="catalog-table po-table">
          <thead>
            <tr>
              <th scope="col">Bulk item</th>
              <th scope="col" className="catalog-table__num">In hand</th>
              <th scope="col">In packs</th>
              <th scope="col" className="catalog-table__num">Total</th>
              <th scope="col" className="catalog-table__num">Repacked</th>
              <th scope="col" className="catalog-table__num">Wastage</th>
              {isOwner ? <th scope="col" className="catalog-table__num">Wastage cost</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td dir="auto">{i.name}</td>
                <td className="catalog-table__num ltr-isolate">{kg(i.kg_in_hand)}</td>
                <td className="bulk-report__packs">
                  {i.packs.filter((p) => p.packs > 0).length === 0
                    ? '—'
                    : i.packs
                        .filter((p) => p.packs > 0)
                        .map((p) => (
                          <span key={p.id} className="ltr-isolate">
                            {formatQty(p.packs)} × {weightText(p.kg_each)} = {kg(p.kg)}
                          </span>
                        ))}
                </td>
                <td className="catalog-table__num ltr-isolate"><strong>{kg(i.kg_total)}</strong></td>
                <td className="catalog-table__num ltr-isolate">{i.repacked_kg ? kg(i.repacked_kg) : '—'}</td>
                <td className={`catalog-table__num ltr-isolate${i.wastage_kg > 0 ? ' po-due' : ''}`}>{i.wastage_kg ? kg(i.wastage_kg) : '—'}</td>
                {isOwner ? <td className="catalog-table__num ltr-isolate">{i.wastage_cost_paisa ? rs(i.wastage_cost_paisa) : '—'}</td> : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="catalog-table__num ltr-isolate">{kg(data.totals.kg_in_hand)}</td>
              <td className="ltr-isolate">{kg(data.totals.kg_in_packs)}</td>
              <td className="catalog-table__num ltr-isolate"><strong>{kg(data.totals.kg_in_hand + data.totals.kg_in_packs)}</strong></td>
              <td className="catalog-table__num ltr-isolate">{kg(data.totals.repacked_kg)}</td>
              <td className="catalog-table__num ltr-isolate">{kg(data.totals.wastage_kg)}</td>
              {isOwner ? <td className="catalog-table__num ltr-isolate">{rs(data.totals.wastage_cost_paisa ?? 0)}</td> : null}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
