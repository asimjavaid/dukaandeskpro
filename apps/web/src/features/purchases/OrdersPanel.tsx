import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UrHint, useI18n, type MessageKey } from '../../i18n';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { formatRsShort, rupeesPlain } from '../../lib/money';
import { parseMoneyRs } from '../shared/amount';
import { MoneyInput } from '../shared/MoneyInput';
import { NO_SUPPLIER_ID } from '../shared/noSupplier';
import { PageHeader } from '../shared/PageHeader';
import { allowsFraction, formatQty, parseQtyInput, productUnitKey, r3 } from '../shared/productUnits';
import { openWhatsApp, waPhone } from '../parties/whatsapp';
import { poMessage, poNo, shopYmd } from './poText';
import { SupplierPicker, useSuppliers, type SupplierOpt } from './SupplierPicker';
import { MrpStrip, PriceCheck, usePricing, type PriceCheckRow } from './pricing';
import { LineTable, PlExtras, PlFoot, PlHead, ProductAdd, newExtra, readExtras, type PlHit, type PlRow } from './LineTable';
import { landedLines, type ExtraRow } from './landed';
import { landedText, loadBuyInfo, pkgNameOf, pkgShort, pkgWord, type BuyInfo, type BuyMode } from './packs';
import { CONTAINER_NAME, defaultMeasure, FIXED_UNITS, isContainer, isMeasure, lineMeasure, measuresFor, measureWord, type Measure } from './measures';
import { fmtDate } from '../shared/dates';

const modeOf = (m: Measure): BuyMode => (isContainer(m) ? 'pkg' : m === 'kg' || m === 'gram' ? 'kg' : 'piece');
/** Measure to start a line in: last used with this supplier, else the product's bought-by. */
function pickMeasure(b: BuyInfo | undefined, ms: Measure[], fallback: Measure): Measure {
  const u = [b?.last_unit, b?.buy_measure].find((x): x is Measure => isMeasure(x) && ms.includes(x));
  return u ?? (ms.includes(fallback) ? fallback : ms[0]);
}
const msOf = (b: BuyInfo | undefined, p: { unit_label?: string | null; product_type?: string | null }): Measure[] => {
  const u = (b?.units ?? []).filter(isMeasure);
  return u.length ? u : measuresFor(p);
};

type Status = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';
type Order = {
  id: string;
  number: number;
  supplier_id: string;
  supplier_name: string;
  supplier_phone: string | null;
  status: Status;
  note: string | null;
  sent_at: string | null;
  created_at: string;
  line_count: number;
  expected_paisa: number;
};
type OLine = {
  id: string;
  product_id: string;
  product_name: string;
  unit_label: string;
  qty_ordered: number;
  qty_received: number;
  expected_cost_paisa: number | null;
  last_unit_cost_paisa: number | null;
  price_paisa: number;
  active: number;
  pack_id: string | null;
  pack_name: string | null;
  pack_units: number | null;
  pack_qty: number | null;
  fixed_price?: number;
  by_package?: number;
  buy_unit?: string | null;
  product_type?: string;
  last_pack_units?: number | null;
  last_pack_cost_paisa?: number | null;
  unit?: string | null;
};
type Bill = { id: string; total_paisa: number; due_paisa: number; purchased_on: string };
type Detail = { ok: true; order: Order; lines: OLine[]; bills: Bill[] };
type Hit = PlHit;
/** kg: bulk by weight. pkg: number of cartons / crates (units per package come on receive). piece: single items. */
type EditLine = {
  key: string; productId: string; name: string; unit: string; qty: string; cost: number | null; mode: BuyMode; pkg: string; packCost?: number | null; price?: number | null; type?: string | null;
  /** Ordered in (Kg, Carton, Bottle …) and the measures this item allows. */
  m: Measure; ms: Measure[];
};
type RecvLine = {
  key: string;
  orderLineId: string | null;
  productId: string;
  name: string;
  unit: string;
  ordered: number;
  got: number;
  qty: string;
  cost: string;
  lastCost: number | null;
  price: number;
  newPrice: string;
  type?: string | null;
  /** Supplier's line total (Rs) when byTotal. */
  total: string;
  byTotal: boolean;
  fixed: boolean;
  mode: BuyMode;
  /** Carton / Crate */
  pkg: string;
  /** Units in each carton / crate (pkg lines). */
  units: string;
  /** Order line counts packages. */
  byPackage: boolean;
  /** Bought in, allowed measures, pcs per container last used. */
  m: Measure;
  ms: Measure[];
  pu?: Record<string, number>;
};
type SugItem = {
  product_id: string;
  product_name: string;
  unit_label: string;
  qty_on_hand: number;
  reorder_level: number | null;
  suggested_qty: number;
  last_unit_cost_paisa: number | null;
  pack_id: string | null;
  pack_name: string | null;
  pack_units: number | null;
  pack_qty: number | null;
  by_package?: boolean;
  buy_unit?: string | null;
  unit?: string | null;
};
type SugGroup = { supplier_id: string; supplier_name: string; supplier_phone: string | null; items: SugItem[] };

export const STATUS_LABEL: Record<Status, MessageKey> = {
  draft: 'poStDraft',
  sent: 'poStSent',
  partial: 'poStPartial',
  received: 'poStReceived',
  cancelled: 'poStCancelled',
};
const STATUS_CHIP: Record<Status, string> = {
  draft: 'chip--neutral',
  sent: 'chip--info',
  partial: 'chip--warn',
  received: 'chip--success',
  cancelled: 'chip--muted',
};
const ERR: Record<string, MessageKey> = {
  supplier_not_found: 'poErrChooseSupplier',
  purchase_lines_required: 'poErrAddProduct',
  invalid_qty: 'poErrCheckQty',
  product_not_found: 'poErrProductNotFound',
  order_locked: 'poErrOrderLocked',
  invalid_amount: 'poErrCheckAmounts',
  discount_too_high: 'poErrDiscountHigh',
  paid_too_high: 'poErrPaidHigh',
  invalid_price: 'poErrCheckSalePrice',
  pack_units_required: 'poErrPackUnits',
  bulk_buys_by_kg: 'poErrBulkByKg',
  pack_not_found: 'poErrCheckQty',
};
const rs = formatRsShort;
const dateOnly = (s: string) => fmtDate(s);
const unitWord = (t: (k: never) => string, u: string) => t(productUnitKey(u) as never);

type View = 'list' | 'edit' | 'detail' | 'receive' | 'suggest';
type Props = {
  displayName: string;
  showMoney: boolean;
  isOwner: boolean;
  onOpenBill: (id: string) => void;
  /** PU2: true while a new / edited order or a receive has unsaved changes. */
  onDirtyChange?: (dirty: boolean) => void;
};


export function OrdersPanel({ displayName, showMoney, isOwner, onOpenBill, onDirtyChange }: Props) {
  const { t } = useI18n();
  const tt = t as never;
  const errText = (code?: string) => t((code && ERR[code]) || 'poErrGeneric');
  const [view, setView] = useState<View>('list');
  const [filter, setFilter] = useState<'open' | 'all' | Status>('open');
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [priceRows, setPriceRows] = useState<PriceCheckRow[] | null>(null);
  const pricing = usePricing();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [store, setStore] = useState('');
  const sup = useSuppliers();

  // edit
  const [editId, setEditId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [eLines, setELines] = useState<EditLine[]>([]);
  const [note, setNote] = useState('');
  const focusKey = useRef<string | null>(null);

  // receive
  const [rLines, setRLines] = useState<RecvLine[]>([]);
  const [extras, setExtras] = useState<ExtraRow[]>(() => [newExtra()]);
  const [discount, setDiscount] = useState('0');
  const [paid, setPaid] = useState('0');
  const [recvOn, setRecvOn] = useState('');
  const [recvRef, setRecvRef] = useState('');

  // suggest
  const [groups, setGroups] = useState<SugGroup[] | null>(null);
  const [pick, setPick] = useState<Record<string, { on: boolean; qty: string }>>({});
  const [groupSup, setGroupSup] = useState<Record<string, string>>({});

  useEffect(() => {
    apiGet<{ store?: { name?: string } | null }>('/auth/status')
      .then((s) => setStore(s.store?.name ?? ''))
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    const q = filter === 'all' ? '' : `?status=${filter}`;
    const r = await apiGet<{ items: Order[] }>(`/purchase-orders${q}`);
    setOrders(r.items ?? []);
  }, [filter]);

  useEffect(() => {
    if (view !== 'list') return;
    load().catch(() => setOrders([]));
  }, [load, view]);

  async function open(id: string) {
    setError(null);
    const r = await apiGet<Detail | { ok: false; error: string }>(`/purchase-orders/${encodeURIComponent(id)}`);
    if (!r.ok) {
      setError(errText(r.error));
      return;
    }
    setDetail(r);
    setView('detail');
  }

  // PU2: compare the form with how it looked when it opened (recvOn and remembered pcs per fill in later, so they are left out).
  const formKey =
    view === 'edit'
      ? JSON.stringify([supplierId, eLines, note])
      : view === 'receive'
        ? JSON.stringify([rLines, extras.map((x) => [x.label, x.amount, x.separate]), discount, paid, recvRef], (k, v) => (k === 'pu' || k === 'ms' ? undefined : v))
        : '';
  const baseKeyRef = useRef('');
  const baseForRef = useRef<unknown[]>([]);
  {
    const f = baseForRef.current;
    if (f[0] !== view || f[1] !== editId || f[2] !== detail) {
      // Form just opened (or switched order): this is the clean state.
      baseForRef.current = [view, editId, detail];
      baseKeyRef.current = formKey;
    }
  }
  const formDirty = formKey !== '' && formKey !== baseKeyRef.current;
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyRef.current?.(formDirty);
  }, [formDirty]);
  useEffect(() => () => onDirtyRef.current?.(false), []);

  function back() {
    setError(null);
    setView(detail && (view === 'receive' || (view === 'edit' && editId)) ? 'detail' : 'list');
  }

  useEffect(() => {
    if (view === 'list') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && !e.defaultPrevented) back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- edit ----------
  function startNew() {
    setEditId(null);
    setDetail(null);
    setSupplierId('');
    setELines([]);
    setNote('');
    setError(null);
    setView('edit');
  }
  function startEdit(d: Detail) {
    setEditId(d.order.id);
    setSupplierId(d.order.supplier_id);
    setNote(d.order.note ?? '');
    setELines(
      d.lines.map((l) => {
        const m = lineMeasure(l);
        const mode = l.by_package ? 'pkg' : l.pack_name && l.pack_units ? 'pkg' : modeOf(m);
        const pkgQty = l.by_package ? l.qty_ordered : l.pack_qty ?? (l.pack_units ? Math.ceil(l.qty_ordered / l.pack_units - 1e-9) : l.qty_ordered);
        return {
          key: l.id,
          productId: l.product_id,
          name: l.product_name,
          unit: l.unit_label,
          qty: formatQty(mode === 'pkg' ? pkgQty : m === 'gram' ? Math.round(l.qty_ordered * 1000) : l.qty_ordered),
          cost: l.expected_cost_paisa,
          mode,
          m,
          ms: measuresFor(l),
          pkg: l.pack_name ?? CONTAINER_NAME[m] ?? pkgNameOf(l.buy_unit),
          packCost: l.last_pack_cost_paisa ?? null,
          price: l.price_paisa ?? null,
          type: l.product_type ?? null,
        };
      }),
    );
    setError(null);
    setView('edit');
  }
  function addEditLine(h: Hit) {
    setELines((prev) => {
      const had = prev.find((l) => l.productId === h.id);
      if (had) {
        focusKey.current = had.key;
        return [...prev];
      }
      const key = `${h.id}-${Date.now()}`;
      focusKey.current = key;
      const m = defaultMeasure(h);
      return [
        ...prev,
        {
          key, productId: h.id, name: h.name, unit: h.unit_label ?? 'piece', qty: '1', cost: h.last_unit_cost_paisa ?? null, mode: modeOf(m), m, ms: measuresFor(h),
          pkg: CONTAINER_NAME[m] ?? pkgNameOf(h.buy_unit), price: h.price_paisa ?? null, type: h.product_type ?? null,
        },
      ];
    });
    void loadBuyInfo(supplierId, [h.id]).then((by) => {
      const b = by[h.id];
      if (!b) return;
      setELines((prev) =>
        prev.map((x) => {
          if (x.productId !== h.id) return x;
          const ms = msOf(b, h);
          const m = pickMeasure(b, ms, x.m);
          return { ...x, ms, m, mode: modeOf(m), pkg: CONTAINER_NAME[m] ?? x.pkg, packCost: b.last_pack_cost_paisa ?? null };
        }),
      );
    });
  }
  useEffect(() => {
    const k = focusKey.current;
    if (!k) return;
    focusKey.current = null;
    const n = document.getElementById(`po-qty-${k}`);
    if (n instanceof HTMLInputElement) {
      n.focus();
      n.select();
    }
  });
  const editBad = eLines.some((l) =>
    l.mode === 'pkg' ? !Number.isInteger(Number(l.qty)) || !(Number(l.qty) > 0) : parseQtyInput(l.qty, l.unit) == null || !(Number(l.qty) > 0),
  );

  async function saveOrder(send: boolean) {
    setError(null);
    if (!supplierId) return setError(errText('supplier_not_found'));
    if (eLines.length < 1) return setError(errText('purchase_lines_required'));
    if (editBad) return setError(errText('invalid_qty'));
    setBusy(true);
    try {
      const body = {
        supplierId,
        note: note.trim() || null,
        lines: eLines.map((l) =>
          l.mode === 'pkg'
            ? { productId: l.productId, unit: isContainer(l.m) ? l.m : undefined, packages: Number(l.qty) }
            : { productId: l.productId, unit: l.m, qty: parseQtyInput(l.qty, l.unit), expectedCostPaisa: l.cost ?? undefined },
        ),
      };
      const r = editId
        ? await apiPatch<Detail | { ok: false; error: string }>(`/purchase-orders/${editId}`, body)
        : await apiPost<Detail | { ok: false; error: string }>('/purchase-orders', body);
      if (!r.ok) return setError(errText(r.error));
      setDetail(r);
      setView('detail');
      if (send) await sendWa(r);
    } catch {
      setError(errText());
    } finally {
      setBusy(false);
    }
  }

  // ---------- send ----------
  const message = (d: Detail) =>
    poMessage(
      d.order.supplier_name,
      store,
      d.order.number,
      d.order.created_at,
      d.lines.map((l) =>
        l.by_package && l.pack_name
          ? { name: l.product_name, qty: l.qty_ordered, unit: l.pack_name, pack: true }
          : l.pack_name && l.pack_qty
            ? { name: l.product_name, qty: l.pack_qty, unit: l.pack_name, pack: true }
            : lineMeasure(l) === 'gram'
              ? { name: l.product_name, qty: Math.round(l.qty_ordered * 1000), unit: 'gram' }
              : isContainer(lineMeasure(l))
                ? { name: l.product_name, qty: l.qty_ordered, unit: l.unit_label }
                : { name: l.product_name, qty: l.qty_ordered, unit: lineMeasure(l) === 'kg' || lineMeasure(l) === 'litre' ? l.unit_label : lineMeasure(l) },
      ),
    );
  async function sendWa(d: Detail) {
    const phone = waPhone(d.order.supplier_phone);
    if (!phone) return setError(t('poNoPhone'));
    await openWhatsApp(phone, message(d));
    const r = await apiPost<Detail | { ok: false; error: string }>(`/purchase-orders/${d.order.id}/sent`);
    if (r.ok) setDetail(r);
  }
  async function cancelOrder(d: Detail) {
    if (!window.confirm(t('poCancelConfirm').replace('{po}', poNo(d.order.number)))) return;
    const r = await apiPost<Detail | { ok: false; error: string }>(`/purchase-orders/${d.order.id}/cancel`);
    if (!r.ok) return setError(errText(r.error));
    setDetail(r);
  }

  // ---------- receive ----------
  function startReceive(d: Detail) {
    setRLines(
      d.lines
        .filter((l) => l.active === 1)
        .map((l): RecvLine => {
          const left = Math.max(0, r3(l.qty_ordered - l.qty_received));
          const cost = l.expected_cost_paisa ?? l.last_unit_cost_paisa ?? null;
          const pkgLine = !!l.by_package || !!(l.pack_name && l.pack_units);
          if (pkgLine) {
            const units = l.last_pack_units ?? l.pack_units ?? null;
            const n = l.by_package ? left : Math.ceil(left / (l.pack_units ?? 1) - 1e-9);
            const packCost = l.last_pack_cost_paisa ?? (units && l.last_unit_cost_paisa ? Math.round(l.last_unit_cost_paisa * units) : null);
            return {
              key: l.id,
              orderLineId: l.id,
              productId: l.product_id,
              name: l.product_name,
              unit: l.unit_label,
              ordered: l.by_package ? l.qty_ordered : l.pack_qty ?? l.qty_ordered,
              got: l.qty_received,
              qty: formatQty(Math.max(0, n)),
              cost: packCost == null ? '' : rupeesPlain(packCost),
              lastCost: l.last_unit_cost_paisa,
              price: l.price_paisa,
              newPrice: '',
              total: '',
              byTotal: false,
              fixed: l.fixed_price === 1,
              mode: 'pkg',
              pkg: l.pack_name ?? pkgNameOf(l.buy_unit),
              units: units == null ? '' : formatQty(units),
              byPackage: !!l.by_package,
              type: l.product_type ?? null,
              m: lineMeasure(l),
              ms: measuresFor(l),
            };
          }
          return {
            key: l.id,
            orderLineId: l.id,
            productId: l.product_id,
            name: l.product_name,
            unit: l.unit_label,
            ordered: l.qty_ordered,
            got: l.qty_received,
            qty: formatQty(left),
            cost: cost == null ? '' : rupeesPlain(cost),
            lastCost: l.last_unit_cost_paisa,
            price: l.price_paisa,
            newPrice: '',
            total: '',
            byTotal: false,
            fixed: l.fixed_price === 1,
            mode: modeOf(lineMeasure(l)),
            pkg: pkgNameOf(l.buy_unit),
            units: '',
            byPackage: false,
            type: l.product_type ?? null,
            m: lineMeasure(l),
            ms: measuresFor(l),
            ...(lineMeasure(l) === 'gram' ? { qty: formatQty(Math.round(left * 1000)) } : {}),
          };
        }),
    );
    void loadBuyInfo(d.order.supplier_id, [...new Set(d.lines.map((l) => l.product_id))]).then((by) =>
      setRLines((prev) => prev.map((x) => (by[x.productId] ? { ...x, pu: by[x.productId].pack_units ?? {}, ms: msOf(by[x.productId], { unit_label: x.unit, product_type: x.type }) } : x))),
    );
    setDiscount('0');
    setPaid('0');
    setExtras([newExtra()]);
    setRecvOn('');
    setRecvRef('');
    apiGet<{ today: string }>('/suppliers?page=1&pageSize=1')
      .then((r) => setRecvOn((p) => p || r.today || ''))
      .catch(() => undefined);
    setError(null);
    setView('receive');
    window.setTimeout(() => {
      const n = document.querySelector<HTMLInputElement>('.po-recv input[data-col="qty"]');
      n?.focus();
      n?.select();
    }, 30);
  }
  function addRecvLine(h: Hit) {
    const key = `x-${h.id}-${Date.now()}`;
    focusKey.current = key;
    setRLines((prev) => [
      ...prev,
      {
        key,
        orderLineId: null,
        productId: h.id,
        name: h.name,
        unit: h.unit_label ?? 'piece',
        ordered: 0,
        got: 0,
        qty: '1',
        cost: h.last_unit_cost_paisa == null ? '' : rupeesPlain(h.last_unit_cost_paisa),
        lastCost: h.last_unit_cost_paisa ?? null,
        price: h.price_paisa ?? 0,
        newPrice: '',
        total: '',
        byTotal: false,
        fixed: h.fixed_price === 1,
        mode: 'piece',
        pkg: pkgNameOf(h.buy_unit),
        units: '',
        byPackage: false,
        type: h.product_type ?? null,
        m: 'piece',
        ms: measuresFor(h),
      },
    ]);
    setRLines((prev) => prev.map((x) => (x.key === key ? { ...x, ...recvMeasure(x, defaultMeasure(h)) } : x)));
    if (detail) {
      void loadBuyInfo(detail.order.supplier_id, [h.id]).then((by) => {
        const b = by[h.id];
        if (!b) return;
        setRLines((prev) =>
          prev.map((x) => {
            if (x.key !== key) return x;
            const ms = msOf(b, h);
            const m = pickMeasure(b, ms, x.m);
            const next = { ...x, ms, pu: b.pack_units ?? {}, ...recvMeasure({ ...x, pu: b.pack_units ?? {} }, m) };
            if (isContainer(m) && b.pack_name === CONTAINER_NAME[m] && b.last_pack_cost_paisa != null) next.cost = rupeesPlain(b.last_pack_cost_paisa);
            return next;
          }),
        );
      });
    }
  }
  /** Switch a receive line's measure: containers take count × pcs per (dozen 12); others the item itself. */
  function recvMeasure(l: RecvLine, m: Measure): Partial<RecvLine> {
    const mode = modeOf(m);
    if (mode === 'pkg') {
      const u = FIXED_UNITS[m] ?? l.pu?.[m];
      return { m, mode, pkg: CONTAINER_NAME[m]!, units: u != null ? formatQty(u) : '', cost: l.mode === 'pkg' && l.pkg === CONTAINER_NAME[m] ? l.cost : '', byTotal: false, total: '' };
    }
    const cost = mode === 'kg' ? '' : l.mode === 'pkg' ? (l.lastCost != null ? rupeesPlain(l.lastCost) : '') : l.cost;
    return { m, mode, cost, byTotal: false, total: '' };
  }
  const patchR = (key: string, p: Partial<RecvLine>) => setRLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const rCalc = useMemo(() => {
    const rows = rLines.map((l) => {
      const c = parseMoneyRs(l.cost);
      const t = parseMoneyRs(l.total);
      const byTotal = l.byTotal && l.mode === 'kg';
      const tP = byTotal && t != null ? Math.round(t * 100) : null;
      if (l.mode === 'pkg') {
        const n = l.qty.trim() === '' ? 0 : Number(l.qty);
        const okN = Number.isInteger(n) && n >= 0;
        const u = Number(l.units);
        const units = Number.isFinite(u) && u > 0 ? u : null;
        const packCost = c == null || l.cost.trim() === '' ? null : Math.round(c * 100);
        const q = !okN ? null : n === 0 ? 0 : units == null ? null : r3(n * units);
        const costP = packCost == null || units == null ? null : Math.round(packCost / units);
        const amount = !okN ? null : n === 0 ? 0 : packCost == null ? null : n * packCost;
        const up = costP != null && l.lastCost != null && costP > l.lastCost;
        const below = costP != null && l.price > 0 && costP >= l.price;
        return { q, costP, packCost, amount, up, below, units: units ?? 1, n: okN ? n : null };
      }
      const q0 = l.qty.trim() === '' ? 0 : parseQtyInput(l.qty, l.unit);
      const q = q0 != null && l.m === 'gram' ? (Number.isInteger(q0) ? q0 / 1000 : null) : q0;
      const costP = byTotal ? (tP != null && q != null && q > 0 ? Math.round(tP / q) : null) : c == null || l.cost.trim() === '' ? null : Math.round(c * 100);
      const amount = q == null ? null : byTotal ? tP : costP == null ? null : Math.round(q * costP);
      const up = costP != null && l.lastCost != null && costP > l.lastCost;
      const below = costP != null && l.price > 0 && costP >= l.price;
      return { q, costP, packCost: costP, amount, up, below, units: 1, n: null as number | null };
    });
    const bad = rows.some((r) => r.q == null);
    const noTotal = rows.some((r) => r.q != null && r.q > 0 && r.amount == null);
    const sub = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
    const d = parseMoneyRs(discount);
    const dp = d == null ? 0 : Math.round(d * 100);
    const x = readExtras(extras);
    const total = Math.max(0, sub - dp) + x.owed;
    const p = parseMoneyRs(paid);
    const pp = p == null ? 0 : Math.round(p * 100);
    const any = rows.some((r) => (r.q ?? 0) > 0);
    const landed = landedLines(rows.map((r) => ({ amount: r.amount, pieces: r.q ?? 0 })), dp, x.all);
    return { rows, bad, sub, dp, x, landed, total, pp, due: Math.max(0, total - pp), any, moneyBad: noTotal || x.bad || d == null || p == null || dp > sub || pp > total };
  }, [rLines, discount, paid, extras]);

  async function saveReceive(close: boolean) {
    if (!detail) return;
    setError(null);
    if (rCalc.bad) return setError(errText('invalid_qty'));
    if (rCalc.moneyBad) return setError(errText('invalid_amount'));
    if (!rCalc.any && !close) return setError(errText('purchase_lines_required'));
    setBusy(true);
    try {
      const r = await apiPost<(Detail & { billId: string | null; price_check?: PriceCheckRow[] }) | { ok: false; error: string }>(
        `/purchase-orders/${detail.order.id}/receive`,
        {
          close,
          purchasedOn: recvOn || undefined,
          note: recvRef.trim() || undefined,
          discountRs: parseMoneyRs(discount) ?? 0,
          paidRs: parseMoneyRs(paid) ?? 0,
          extras: rCalc.x.body,
          lines: rLines.map((l, i) =>
            l.mode === 'pkg'
              ? {
                  orderLineId: l.orderLineId,
                  productId: l.productId,
                  packages: rCalc.rows[i].n ?? 0,
                  packUnits: Number(l.units),
                  packName: l.pkg,
                  unit: isContainer(l.m) ? l.m : undefined,
                  packCostRs: (rCalc.rows[i].packCost ?? 0) / 100,
                  newPriceRs: l.newPrice.trim() ? parseMoneyRs(l.newPrice) : undefined,
                }
              : {
                  orderLineId: l.orderLineId,
                  productId: l.productId,
                  unit: l.m,
                  qty: l.m === 'gram' ? Math.round((rCalc.rows[i].q ?? 0) * 1000) : rCalc.rows[i].q ?? 0,
                  unitCostRs: (rCalc.rows[i].costP ?? 0) / 100,
                  ...(l.byTotal && l.mode === 'kg' ? { lineTotalRs: parseMoneyRs(l.total) ?? 0 } : {}),
                  newPriceRs: l.newPrice.trim() ? parseMoneyRs(l.newPrice) : undefined,
                },
          ),
        },
      );
      if (!r.ok) return setError(errText(r.error));
      setDetail(r);
      setView('detail');
      if (isOwner && r.price_check?.length) setPriceRows(r.price_check);
    } catch {
      setError(errText());
    } finally {
      setBusy(false);
    }
  }

  // ---------- suggest ----------
  async function startSuggest() {
    setError(null);
    setGroups(null);
    setView('suggest');
    const r = await apiGet<{ groups: SugGroup[] }>('/purchase-orders/suggest');
    const g = r.groups ?? [];
    setGroups(g);
    const p: Record<string, { on: boolean; qty: string }> = {};
    g.forEach((x) =>
      x.items.forEach((i) => (p[`${x.supplier_id}:${i.product_id}`] = { on: true, qty: i.by_package ? String(i.pack_qty ?? 1) : formatQty(i.suggested_qty) })),
    );
    setPick(p);
    setGroupSup(Object.fromEntries(g.map((x) => [x.supplier_id, x.supplier_id === NO_SUPPLIER_ID ? '' : x.supplier_id])));
  }
  async function createFromSuggest() {
    if (!groups) return;
    setError(null);
    const out: Array<{ supplierId: string; lines: Array<{ productId: string; qty: number; packages?: number; unit?: string }> }> = [];
    for (const g of groups) {
      const lines = g.items
        .map((i) => ({ i, p: pick[`${g.supplier_id}:${i.product_id}`] }))
        .filter((x) => x.p?.on)
        .map((x) =>
          x.i.by_package
            ? { productId: x.i.product_id, packages: Number(x.p.qty), qty: Number(x.p.qty), unit: isContainer(x.i.unit) ? x.i.unit ?? undefined : undefined }
            : { productId: x.i.product_id, qty: parseQtyInput(x.p.qty, x.i.unit_label) ?? 0, unit: isMeasure(x.i.unit) && !isContainer(x.i.unit) && x.i.unit !== 'gram' ? x.i.unit : undefined },
        );
      if (lines.length === 0) continue;
      if (lines.some((l) => !(l.qty > 0) || ('packages' in l && !Number.isInteger(l.qty)))) return setError(errText('invalid_qty'));
      const sid = groupSup[g.supplier_id] || '';
      if (!sid) return setError(t('poChooseSupplierFor').replace('{name}', g.supplier_name));
      const same = out.find((o) => o.supplierId === sid);
      if (same) same.lines.push(...lines);
      else out.push({ supplierId: sid, lines });
    }
    if (out.length === 0) return setError(errText('purchase_lines_required'));
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; error?: string }>('/purchase-orders/from-low-stock', { groups: out });
      if (!r.ok) return setError(errText(r.error));
      setFilter('draft');
      setView('list');
    } finally {
      setBusy(false);
    }
  }

  // ---------- render ----------
  const head = (title: string, actions?: React.ReactNode) => (
    <PageHeader title={<>{title}{title === t('poTitleList') ? <UrHint k="purchasesTitle" /> : null}</>} subtitle={displayName} actions={actions} />
  );
  const alert = error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
  const chip = (s: Status) => <span className={`chip ${STATUS_CHIP[s]} po-status`}>{t(STATUS_LABEL[s])}</span>;

  if (view === 'edit') {
    const estOf = (l: EditLine): number | null => {
      if (l.mode === 'pkg') return l.packCost != null && Number.isInteger(Number(l.qty)) ? Number(l.qty) * l.packCost : null;
      const q0 = parseQtyInput(l.qty, l.unit);
      const q = q0 != null && l.m === 'gram' ? q0 / 1000 : q0;
      return l.cost != null && q != null ? Math.round(q * l.cost) : null;
    };
    const est = eLines.reduce((s, l) => s + (estOf(l) ?? 0), 0);
    const rows: PlRow[] = eLines.map((l) => {
      const e = estOf(l);
      const per =
        l.mode === 'pkg'
          ? l.packCost != null ? `${rs(l.packCost)}/${l.pkg.toLowerCase()}` : ''
          : l.cost != null ? `${rs(l.cost)}${l.mode === 'kg' ? '/kg' : ' each'}` : '';
      return {
        key: l.key,
        name: l.name,
        type: l.type,
        qty: {
          value: l.qty,
          whole: l.mode === 'pkg' || !allowsFraction(l.unit) || l.m === 'gram',
          bad: l.mode === 'pkg' ? !Number.isInteger(Number(l.qty)) : parseQtyInput(l.qty, l.unit) == null,
          label: t('poAriaQty').replace('{name}', l.name),
          onChange: (v) => setELines((p) => p.map((x) => (x.key === l.key ? { ...x, qty: v } : x))),
        },
        unitText: l.mode === 'pkg' ? pkgWord(l.pkg, Number(l.qty || 0)) : l.mode === 'kg' ? 'kg' : unitWord(tt, l.unit).toLowerCase(),
        measure: {
          value: l.m,
          options: l.ms.includes(l.m) ? l.ms : [l.m, ...l.ms],
          onChange: (v) =>
            isMeasure(v) &&
            setELines((p) => p.map((x) => (x.key === l.key ? { ...x, m: v, mode: modeOf(v), pkg: CONTAINER_NAME[v] ?? x.pkg } : x))),
        },
        total: { text: e == null ? '—' : rs(e) },
        derived: per,
        sale: l.price != null ? <span className="muted ltr-isolate">{rs(l.price)}</span> : null,
        onRemove: () => setELines((p) => p.filter((x) => x.key !== l.key)),
      };
    });
    return (
      <div className={`po po-edit pl${showMoney ? '' : ' dd-no-money'}`}>
        {head(editId && detail ? t('poTitleEdit').replace('{po}', poNo(detail.order.number)) : t('poNewOrder'), (
          <button className="btn btn--ghost" type="button" onClick={back} disabled={busy}>
            {t('poBack')}
          </button>
        ))}
        <form
          className="pl-form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveOrder(false);
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              void saveOrder(true);
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
              e.preventDefault();
              void saveOrder(false);
            }
          }}
        >
          <PlHead>
            <SupplierPicker
              id="po-supplier"
              value={supplierId}
              onChange={setSupplierId}
              suppliers={sup.items}
              allowNone={false}
              onAdded={(s: SupplierOpt) => sup.setItems((p) => [...p, s])}
            />
            <div className="field pl-date">
              <label htmlFor="po-date">{t('poDate')}</label>
              <input id="po-date" className="ltr-isolate" type="date" value={editId && detail ? shopYmd(detail.order.created_at) : shopYmd(new Date().toISOString())} readOnly tabIndex={-1} />
            </div>
            <div className="field pl-ref">
              <label htmlFor="po-note">{t('poRef')}</label>
              <input id="po-note" value={note} maxLength={240} autoComplete="off" onChange={(e) => setNote(e.target.value)} />
            </div>
          </PlHead>
          <LineTable
            idp="po"
            rows={rows}
            showEach={false}
            showCost={false}
            showSale={showMoney !== false}
            searchId="po-add"
            search={<ProductAdd id="po-add" onPick={addEditLine} autoFocus unitText={(h) => unitWord(tt, h.unit_label ?? 'piece')} />}
          />
          <PlFoot rs={rs} subtotal={est} subtotalLabel={t('poSubtotalExpected')} count={eLines.length} alert={alert}>
            <button className="btn btn--ghost" type="submit" disabled={busy || eLines.length === 0}>
              {t('poSaveDraft')} <kbd>Ctrl+S</kbd>
            </button>
            <button className="btn btn--teal" type="button" disabled={busy || eLines.length === 0} onClick={() => void saveOrder(true)}>
              {t('poSaveSend')} <kbd>Ctrl+Enter</kbd>
            </button>
          </PlFoot>
        </form>
      </div>
    );
  }

  if (view === 'detail' && detail) {
    const d = detail;
    const o = d.order;
    const phone = waPhone(o.supplier_phone);
    const openState = o.status !== 'received' && o.status !== 'cancelled';
    return (
      <div className={`po po-detail${showMoney ? '' : ' dd-no-money'}`}>
        {priceRows ? <PriceCheck rows={priceRows} onDone={() => setPriceRows(null)} /> : null}
        {head(poNo(o.number), (
          <button className="btn btn--ghost" type="button" onClick={() => setView('list')}>
            {t('poBack')}
          </button>
        ))}
        <section className="purchases-card po-detail__head">
          <dl className="po-facts">
            <div><dt className="muted">{t('poSupplier')}</dt><dd dir="auto">{o.supplier_name}</dd></div>
            <div><dt className="muted">{t('poPhone')}</dt><dd className="ltr-isolate">{o.supplier_phone || '—'}</dd></div>
            <div><dt className="muted">{t('poDate')}</dt><dd className="ltr-isolate">{dateOnly(o.created_at)}</dd></div>
            <div><dt className="muted">{t('poStatus')}</dt><dd>{chip(o.status)}</dd></div>
            <div className="dd-money"><dt className="muted">{t('poExpected')}</dt><dd className="ltr-isolate">{rs(o.expected_paisa)}</dd></div>
          </dl>
          {openState ? (
            <div className="po-actions">
              <button
                className="btn btn--teal"
                type="button"
                disabled={!phone}
                title={phone ? undefined : t('poNoPhone')}
                onClick={() => void sendWa(d)}
              >
                {o.status === 'draft' ? t('poSendWhatsapp') : t('poSendAgain')}
              </button>
              {!phone ? <span className="muted">{t('poNoPhone')}</span> : null}
              <button className="btn btn--teal" type="button" onClick={() => startReceive(d)}>
                {t('poReceive')}
              </button>
              {o.status === 'draft' || o.status === 'sent' ? (
                <button className="btn btn--ghost" type="button" onClick={() => startEdit(d)}>
                  {t('poEdit')}
                </button>
              ) : null}
              <button className="btn btn--ghost" type="button" onClick={() => void cancelOrder(d)}>
                {t('poCancelOrder')}
              </button>
            </div>
          ) : null}
        </section>
        {alert}
        <div className="po-detail__grid">
          <section className="purchases-card">
            <table className="catalog-table po-table">
              <thead>
                <tr>
                  <th scope="col">{t('poProduct')}</th>
                  <th scope="col" className="catalog-table__num">{t('poOrdered')}</th>
                  <th scope="col" className="catalog-table__num">{t('poReceived')}</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.id} className={l.active ? '' : 'is-muted'}>
                    <td dir="auto">{l.product_name}</td>
                    <td className="catalog-table__num ltr-isolate">
                      {l.by_package ? (
                        <>
                          {formatQty(l.qty_ordered)} <span className="muted">{pkgWord(l.pack_name ?? 'Carton', l.qty_ordered)}</span>
                        </>
                      ) : (
                        <>
                          {l.pack_name ? <>{formatQty(l.pack_qty ?? 0)} {l.pack_name} <span className="muted">· </span></> : null}
                          {(() => {
                            const m = lineMeasure(l);
                            if (m === 'gram') return <>{formatQty(Math.round(l.qty_ordered * 1000))} <span className="muted">g</span></>;
                            const w = l.product_type === 'bulk' || m === 'kg' ? 'kg' : m === 'piece' || m === 'litre' ? unitWord(tt, l.unit_label) : measureWord(m, l.qty_ordered);
                            return <>{formatQty(l.qty_ordered)} <span className="muted">{w}</span></>;
                          })()}
                        </>
                      )}
                    </td>
                    <td className={`catalog-table__num ltr-isolate${l.qty_received >= l.qty_ordered ? ' po-full' : l.qty_received > 0 ? ' po-part' : ''}`}>
                      {formatQty(l.qty_received)}
                      {l.by_package && l.qty_received > 0 ? <span className="muted"> {pkgWord(l.pack_name ?? 'Carton', l.qty_received)}</span> : null}
                      {l.qty_received > l.qty_ordered ? ` (+${formatQty(r3(l.qty_received - l.qty_ordered))})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.bills.length > 0 ? (
              <div className="po-bills">
                <h4 className="purchases-form__section-title">{t('poBills')}</h4>
                {d.bills.map((b) => (
                  <button key={b.id} type="button" className="btn btn--ghost po-bill" onClick={() => onOpenBill(b.id)}>
                    <span className="ltr-isolate">{fmtDate(b.purchased_on)}</span>
                    <span className="ltr-isolate dd-money">{rs(b.total_paisa)}</span>
                    {b.due_paisa > 0 ? <span className="ltr-isolate dd-money po-due">{t('poDue')} {rs(b.due_paisa)}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
          {openState ? (
            <section className="purchases-card po-wa">
              <h4 className="purchases-form__section-title">{t('poWhatsappMessage')}</h4>
              <pre className="po-wa__text" dir="auto">{message(d)}</pre>
            </section>
          ) : null}
        </div>
      </div>
    );
  }

  if (view === 'receive' && detail) {
    const o = detail.order;
    const rows: PlRow[] = rLines.map((l, i) => {
      const c = rCalc.rows[i];
      const unitLow = l.mode === 'kg' ? 'kg' : unitWord(tt, l.unit).toLowerCase();
      const lc = rCalc.landed[i];
      const derived =
        c.q != null && c.q > 0
          ? landedText({ kg: l.mode === 'kg', pieces: c.q, word: l.mode === 'pkg' ? unitWord(tt, l.unit).toLowerCase() : unitLow, pkg: l.mode === 'pkg', landed: lc?.landed ?? null, was: l.lastCost }, rs, formatQty)
          : '';
      const kg = l.mode === 'kg';
      return {
        key: l.key,
        name: l.name,
        type: l.type,
        ordered: l.orderLineId ? `${formatQty(l.ordered)} ${l.mode === 'pkg' ? pkgShort(l.pkg, l.ordered) : unitLow}` : null,
        sub: l.orderLineId && l.got > 0 ? `${formatQty(l.got)} in` : null,
        up: c.up,
        qty: {
          value: l.qty,
          whole: l.mode === 'pkg' || !allowsFraction(l.unit) || l.m === 'gram',
          bad: c.q == null && (l.mode !== 'pkg' || c.n == null),
          label: t('poAriaQty').replace('{name}', l.name),
          onChange: (v) => patchR(l.key, { qty: v }),
        },
        unitText: l.mode === 'pkg' ? pkgWord(l.pkg, Number(l.qty || 0)) : unitLow,
        measure:
          l.mode !== 'pkg' || isContainer(l.m)
            ? { value: l.m, options: l.ms.includes(l.m) ? l.ms : [l.m, ...l.ms], onChange: (v) => isMeasure(v) && patchR(l.key, recvMeasure(l, v)) }
            : null,
        cost: kg
          ? null
          : {
              value: l.cost,
              bad: c.q != null && c.q > 0 && c.amount == null,
              label: l.mode === 'pkg' ? t('poAriaPricePer').replace('{pkg}', l.pkg.toLowerCase()).replace('{name}', l.name) : t('poAriaPriceEach').replace('{name}', l.name),
              suffix: l.mode === 'pkg' ? `/${pkgShort(l.pkg, 1)}` : t('poSuffixEach'),
              onChange: (v) => patchR(l.key, { cost: v, byTotal: false }),
            },
        each:
          l.mode === 'pkg' && !FIXED_UNITS[l.m]
            ? {
                value: l.units,
                bad: c.n != null && c.n > 0 && c.q == null,
                label: t('poAriaPiecesPer').replace('{pkg}', l.pkg.toLowerCase()).replace('{name}', l.name),
                suffix: t('poSuffixPcs'),
                onChange: (v) => patchR(l.key, { units: v }),
              }
            : null,
        total: kg
          ? {
              value: l.byTotal ? l.total : c.amount == null ? '' : rupeesPlain(c.amount),
              bad: c.q != null && c.q > 0 && c.amount == null,
              label: t('poAriaTotal').replace('{name}', l.name),
              onChange: (v) => patchR(l.key, { total: v, byTotal: v.trim() !== '' }),
            }
          : { text: c.amount == null ? '—' : rs(c.amount) },
        derived,
        sale: !isOwner ? null : l.fixed ? (
          <span className="muted ltr-isolate">{t('poMrp')} {rs(l.price)}</span>
        ) : lc?.landed != null && l.price > 0 && lc.landed >= l.price ? (
          <span className="po-price ltr-isolate">
            {rs(l.price)} <span className="po-below">{t('poBelowCost')}</span>
          </span>
        ) : (
          <span className="muted ltr-isolate">{rs(l.price)}</span>
        ),
        under:
          l.fixed && isOwner ? (
            <MrpStrip
              mrp={l.price}
              units={c.units}
              cost={c.packCost}
              minMarginBp={pricing.min_margin_bp}
              per={l.mode === 'pkg' ? l.pkg.toLowerCase() : unitLow}
            />
          ) : null,
        onRemove: l.orderLineId ? undefined : () => setRLines((p) => p.filter((x) => x.key !== l.key)),
      };
    });
    return (
      <div className={`po po-recv pl${showMoney ? '' : ' dd-no-money'}`}>
        {head(t('poTitleReceive').replace('{po}', poNo(o.number)), (
          <button className="btn btn--ghost" type="button" onClick={back} disabled={busy}>
            {t('poBack')}
          </button>
        ))}
        <form
          className="pl-form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveReceive(false);
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              void saveReceive(e.shiftKey);
            }
          }}
        >
          <PlHead>
            <div className="field">
              <label htmlFor="po-recv-sup">{t('poSupplier')}</label>
              <input id="po-recv-sup" value={o.supplier_name} readOnly tabIndex={-1} dir="auto" />
            </div>
            <div className="field pl-date">
              <label htmlFor="po-recv-date">{t('poDate')}</label>
              <input id="po-recv-date" className="ltr-isolate" type="date" value={recvOn} onChange={(e) => setRecvOn(e.target.value)} />
            </div>
            <div className="field pl-ref">
              <label htmlFor="po-recv-ref">{t('poRef')}</label>
              <input id="po-recv-ref" value={recvRef} maxLength={240} autoComplete="off" onChange={(e) => setRecvRef(e.target.value)} />
            </div>
          </PlHead>
          <LineTable
            idp="po"
            rows={rows}
            showOrdered={rLines.some((l) => l.orderLineId)}
            showEach={rLines.some((l) => l.mode === 'pkg')}
            showCost={rLines.some((l) => l.mode !== 'kg')}
            costHead={t('poHeadPriceRs')}
            eachHead={t('poHeadPcsPack')}
            derivedHead={t('poHeadLanded')}
            showSale={isOwner}
            searchId="po-recv-add"
            search={<ProductAdd id="po-recv-add" onPick={addRecvLine} unitText={(h) => unitWord(tt, h.unit_label ?? 'piece')} />}
          />
          <PlFoot
            rs={rs}
            subtotal={rCalc.sub}
            discount={{ id: 'po-disc', value: discount, onChange: setDiscount, bad: parseMoneyRs(discount) == null || rCalc.dp > rCalc.sub }}
            paid={isOwner ? { id: 'po-paid', value: paid, onChange: setPaid, bad: parseMoneyRs(paid) == null || rCalc.pp > rCalc.total } : null}
            remaining={rCalc.due}
            count={rLines.length}
            alert={alert}
            extras={<PlExtras idp="po" rows={extras} onChange={setExtras} />}
            extrasOwed={rCalc.x.owed}
          >
            <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => void saveReceive(true)}>
              {t('poSaveCloseOrder')} <kbd>Ctrl+Shift+Enter</kbd>
            </button>
            <button className="btn btn--teal" type="submit" disabled={busy || !rCalc.any}>
              {t('poSave')} <kbd>Ctrl+Enter</kbd>
            </button>
          </PlFoot>
        </form>
      </div>
    );
  }

  if (view === 'suggest') {
    return (
      <div className="po po-suggest">
        {head(t('poFromLowStock'), (
          <button className="btn btn--ghost" type="button" onClick={() => setView('list')}>
            {t('poBack')}
          </button>
        ))}
        {groups == null ? <p className="muted">{t('poLoading')}</p> : null}
        {groups && groups.length === 0 ? <p className="muted">{t('poNothingIsLow')}</p> : null}
        {(groups ?? []).map((g) => (
          <section className="purchases-card po-group" key={g.supplier_id}>
            <div className="po-group__head">
              {g.supplier_id === NO_SUPPLIER_ID ? (
                <SupplierPicker
                  id={`po-gs-${g.supplier_id}`}
                  label={t('poNoSupplierYet')}
                  value={groupSup[g.supplier_id] ?? ''}
                  onChange={(v) => setGroupSup((p) => ({ ...p, [g.supplier_id]: v }))}
                  suppliers={sup.items}
                  allowNone={false}
                  onAdded={(s) => sup.setItems((p) => [...p, s])}
                />
              ) : (
                <h4 className="purchases-form__section-title" dir="auto">
                  {g.supplier_name} {g.supplier_phone ? <span className="muted ltr-isolate">{g.supplier_phone}</span> : null}
                </h4>
              )}
            </div>
            <table className="catalog-table po-table">
              <thead>
                <tr>
                  <th scope="col" aria-label={t('poPick')} />
                  <th scope="col">{t('poProduct')}</th>
                  <th scope="col" className="catalog-table__num">{t('poInStock')}</th>
                  <th scope="col" className="catalog-table__num">{t('poReorderAt')}</th>
                  <th scope="col" className="catalog-table__num">{t('poOrderQty')}</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((i) => {
                  const k = `${g.supplier_id}:${i.product_id}`;
                  const p = pick[k] ?? { on: false, qty: '' };
                  return (
                    <tr key={k} className={p.on ? '' : 'is-muted'}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={i.product_name}
                          checked={p.on}
                          onChange={(e) => setPick((s) => ({ ...s, [k]: { ...p, on: e.target.checked } }))}
                        />
                      </td>
                      <td dir="auto">{i.product_name}</td>
                      <td className="catalog-table__num ltr-isolate">{formatQty(i.qty_on_hand)}</td>
                      <td className="catalog-table__num ltr-isolate">{i.reorder_level == null ? '—' : formatQty(i.reorder_level)}</td>
                      <td className="catalog-table__num">
                        <MoneyInput
                          className="po-qty"
                          whole={!!i.by_package || !allowsFraction(i.unit_label)}
                          maxDecimals={3}
                          value={p.qty}
                          onFocus={(e) => e.currentTarget.select()}
                          onValueChange={(v) => setPick((s) => ({ ...s, [k]: { ...p, qty: v } }))}
                        />{' '}
                        <span className="muted">
                          {i.by_package && i.pack_name ? pkgWord(i.pack_name, Number(p.qty || 0)) : unitWord(tt, i.unit_label)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
        {alert}
        {groups && groups.length > 0 ? (
          <div className="po-actions">
            <button className="btn btn--teal" type="button" disabled={busy} onClick={() => void createFromSuggest()}>
              {t('poCreateOrders')}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // list
  const filters: Array<['open' | 'all' | Status, string]> = [
    ['open', t('poStOpen')],
    ['draft', t('poStDraft')],
    ['sent', t('poStSent')],
    ['partial', t('poStPartial')],
    ['received', t('poStReceived')],
    ['cancelled', t('poStCancelled')],
    ['all', t('poStAll')],
  ];
  return (
    <div className={`po po-list${showMoney ? '' : ' dd-no-money'}`}>
      {head(t('poTitleList'), (
        <>
          <button className="btn btn--ghost" type="button" onClick={() => void startSuggest()}>
            {t('poFromLowStock')}
          </button>
          <button className="btn btn--teal" type="button" onClick={startNew}>
            {t('poNewOrder')}
          </button>
        </>
      ))}
      <div className="po-filters" role="tablist">
        {filters.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={filter === k}
            className={`analytics-tab${filter === k ? ' is-active' : ''}`}
            onClick={() => setFilter(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {alert}
      {orders == null ? (
        <p className="muted">{t('poLoading')}</p>
      ) : orders.length === 0 ? (
        <p className="muted po-empty">{t('poNoOrders')}</p>
      ) : (
        <div className="catalog-table-wrap">
          <table className="catalog-table parties-table po-table">
            <thead>
              <tr>
                <th scope="col">{t('poNo')}</th>
                <th scope="col">{t('poSupplier')}</th>
                <th scope="col">{t('poDate')}</th>
                <th scope="col" className="catalog-table__num">{t('poItems')}</th>
                <th scope="col">{t('poStatus')}</th>
                <th scope="col" className="catalog-table__num dd-money">{t('poExpected')}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} onClick={() => void open(o.id)}>
                  <td>
                    <button
                      type="button"
                      className="catalog-table__select"
                      onClick={(e) => {
                        e.stopPropagation();
                        void open(o.id);
                      }}
                    >
                      <span className="ltr-isolate">{poNo(o.number)}</span>
                    </button>
                  </td>
                  <td dir="auto">{o.supplier_name}</td>
                  <td className="ltr-isolate">{dateOnly(o.created_at)}</td>
                  <td className="catalog-table__num ltr-isolate">{o.line_count}</td>
                  <td>{chip(o.status)}</td>
                  <td className="catalog-table__num dd-money ltr-isolate">{rs(o.expected_paisa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
