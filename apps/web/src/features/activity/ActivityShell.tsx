import { useCallback, useEffect, useState } from 'react';
import { UrHint, useI18n, type MessageKey } from '../../i18n';
import { apiGet } from '../../lib/api';
import { formatRsShort as formatRs } from '../../lib/money';
import { EmptyState } from '../shared/EmptyState';
import { PageHeader } from '../shared/PageHeader';
import { Pager } from '../shared/Pager';
import { fmtDateTime } from '../shared/dates';

type Item = {
  at: string;
  kind: string;
  user_name: string | null;
  subject: string | null;
  amount_paisa: number | null;
  detail: string | null;
};
type Feed = { items: Item[]; total: number; page: number; pageSize: number; users: Array<{ id: string; display_name: string }> };

const FILTERS: Array<[string, MessageKey]> = [
  ['', 'activityAll'],
  ['sale', 'activitySales'],
  ['void', 'activityVoids'],
  ['return', 'activityReturns'],
  ['price.change', 'activityPrices'],
  ['stock.write_off', 'activityWriteOffs'],
  ['purchase', 'activityPurchases'],
  ['offers.campaign', 'activityKindOffers'],
  ['catalog.size_prices', 'activityKindSizes'],
  ['purchase_order', 'activityPurchaseOrders'],
  ['repack', 'activityRepack'],
  ['opening_stock', 'osTitle'],
];

function kindLabel(kind: string, t: (k: MessageKey) => string): string {
  if (kind === 'sale') return t('activityKindSale');
  if (kind === 'sale.void') return t('activityKindVoid');
  if (kind === 'sale.replace') return t('activityKindEdit');
  if (kind === 'sale.return') return t('activityKindReturn');
  if (kind === 'sale.return_undo') return t('activityKindReturnUndo');
  if (kind === 'price.change') return t('activityKindPrice');
  if (kind === 'stock.write_off') return t('activityKindWriteOff');
  if (kind === 'purchase') return t('activityKindPurchase');
  if (kind === 'expense') return t('activityKindExpense');
  if (kind === 'offers.campaign') return t('activityKindOffers');
  if (kind === 'catalog.size_prices') return t('activityKindSizes');
  const po: Record<string, string> = {
    'purchase_order.create': 'Order made',
    'purchase_order.edit': 'Order edited',
    'purchase_order.send': 'Order sent',
    'purchase_order.receive': 'Order received',
    'purchase_order.cancel': 'Order cancelled',
    'repack.create': 'Repack',
    'repack.undo': 'Repack undone',
    'opening_stock.post': 'Opening stock',
    'opening_stock.undo': 'Opening stock undone',
    'price.suggest_apply': 'Suggested price used',
  };
  if (po[kind]) return po[kind];
  const raw = kind.replace(/[._]/g, ' ');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return fmtDateTime(d);
}

/** Owner: who sold, voided, edited, returned, changed prices. */
export function ActivityShell({ displayName }: { displayName: string }) {
  const { t } = useI18n();
  const [kind, setKind] = useState('');
  const [userId, setUserId] = useState('');
  const [day, setDay] = useState('');
  const [page, setPage] = useState(1);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    const q = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (kind) q.set('kind', kind);
    if (userId) q.set('userId', userId);
    if (day) q.set('day', day);
    try {
      setFeed(await apiGet<Feed>(`/activity?${q.toString()}`));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [kind, userId, day, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="card">
      <PageHeader title={<>{t('activityTitle')}<UrHint k="activityTitle" /></>} subtitle={displayName} />
      <div className="b2-toolbar" data-activity-filters>
        {FILTERS.map(([k, label]) => (
          <button
            key={k || 'all'}
            type="button"
            className={`chip${kind === k ? ' is-active' : ''}`}
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              setPage(1);
            }}
          >
            {t(label)}
          </button>
        ))}
        <select
          className="input"
          value={userId}
          aria-label={t('activityWho')}
          onChange={(e) => {
            setUserId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('activityEveryone')}</option>
          {(feed?.users ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="input"
          value={day}
          aria-label={t('activityDay')}
          onChange={(e) => {
            setDay(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {failed ? (
        <p className="form-error" role="alert">
          {t('activityLoadFailed')}{' '}
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void load()}>
            {t('retry')}
          </button>
        </p>
      ) : null}
      {!feed && !failed ? (
        <p className="muted catalog-empty" role="status">
          {t('loading')}
        </p>
      ) : !feed ? null : feed.items.length === 0 ? (
        <EmptyState title={t('activityEmpty')} description="" />
      ) : (
        <div className="catalog-table-wrap">
          <table className="catalog-table parties-table" data-activity-table>
            <thead>
              <tr>
                <th>{t('tillTime')}</th>
                <th>{t('activityWho')}</th>
                <th>{t('activityWhat')}</th>
                <th className="catalog-table__col-product">{t('activitySubject')}</th>
                <th className="catalog-table__num">{t('amount')}</th>
              </tr>
            </thead>
            <tbody>
              {(feed?.items ?? []).map((r, i) => (
                <tr key={`${r.at}-${i}`}>
                  <td className="ltr-isolate">{when(r.at)}</td>
                  <td>{r.user_name ?? '—'}</td>
                  <td>
                    <span
                      className={`chip ${
                        r.kind === 'sale'
                          ? 'chip--success'
                          : r.kind.includes('void') || r.kind.includes('write_off')
                            ? 'chip--danger'
                            : 'chip--neutral'
                      }`}
                    >
                      {kindLabel(r.kind, t)}
                    </span>
                  </td>
                  <td className="catalog-table__col-product">
                    {r.subject ?? '—'}
                    {r.kind === 'price.change' && r.detail ? (
                      <div className="muted ltr-isolate">
                        {formatRs(Number(r.detail))} → {formatRs(r.amount_paisa ?? 0)}
                      </div>
                    ) : r.detail ? (
                      <div className="muted">{r.detail}</div>
                    ) : null}
                  </td>
                  <td className="catalog-table__num ltr-isolate">{r.amount_paisa != null ? formatRs(r.amount_paisa) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {feed ? <Pager page={feed.page} pageSize={feed.pageSize} total={feed.total} disabled={busy} onPage={setPage} /> : null}
    </div>
  );
}
