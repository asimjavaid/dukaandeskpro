import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { UrHint, translateError, useI18n } from '../../i18n';
import { apiGet, apiPost, apiGetRaw } from '../../lib/api';
import { parseMoneyRs, parsePieces } from '../shared/amount';
import { EmptyState } from '../shared/EmptyState';
import { NO_SUPPLIER_ID, supplierLabel } from '../shared/noSupplier';
import { allowsFraction, formatQty, parseQtyInput, productUnitKey } from '../shared/productUnits';
import { Pager } from '../shared/Pager';
import { PageHeader } from '../shared/PageHeader';
import { SupplierPicker } from './SupplierPicker';
import { landedText, loadBuyInfo, loadHint, loadPacks, pkgShort, type Pack } from './packs';
import { MrpStrip, PriceCheck, usePricing, type PriceCheckRow } from './pricing';
import { LineTable, PlExtras, PlFoot, PlHead, ProductAdd, newExtra, readExtras, type PlRow } from './LineTable';
import { landedLines, type ExtraRow } from './landed';
import { CONTAINER_NAME, FIXED_UNITS, isContainer, isMeasure, lineMeasure, measuresFor, measureWord, type Measure } from './measures';
import { formatRsShort, rupeesPlain } from '../../lib/money';
import { fmtDate } from '../shared/dates';

const PAGE_SIZE = 20;

type View = 'list' | 'detail' | 'entry';

type Invoice = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  subtotal_paisa: number;
  discount_paisa: number;
  total_paisa: number;
  paid_paisa: number;
  due_paisa: number;
  purchased_on: string;
  note: string | null;
  extras_paisa?: number;
  extras_owed_paisa?: number;
  extras?: { id: string; label: string; amount_paisa: number; paid_separately: number }[];
};

type Line = {
  id: string;
  product_name: string;
  unit_label: string;
  mode: 'loose' | 'carton';
  pieces: number;
  cartons: number | null;
  units_per_carton: number | null;
  line_amount_paisa: number;
  pack_name?: string | null;
  pack_units?: number | null;
  pack_qty?: number | null;
  unit_cost_paisa?: number;
  extra_share_paisa?: number;
  unit?: string | null;
};

type DraftLine = {
  key: string;
  productId: string;
  name: string;
  unitLabel: string;
  mode: 'loose' | 'carton';
  qty: string;
  unitCost: string;
  cartons: string;
  unitsInside: string;
  cartonCost: string;
  expiry?: string;
  batch?: string;
  packs?: Pack[];
  packId?: string;
  packQty?: string;
  packUnits?: string;
  packCost?: string;
  /** Supplier's line total; wins over cost when byTotal. */
  total?: string;
  byTotal?: boolean;
  productType?: string | null;
  fixed?: boolean;
  price?: number;
  /** Carton / Crate: package count + units in each + cost (no pack id needed). */
  pkg?: string;
  /** Bought in (Kg, Carton, Bottle …); measures this item allows; pcs per container last used. */
  unit?: Measure;
  units?: Measure[];
  packUnitsBy?: Record<string, number>;
};

type SupplierOpt = { id: string; name: string; phone?: string | null };
type ProductHit = { id: string; name: string; product_type?: string; buy_unit?: string | null; unit_label?: string | null; price_paisa?: number; fixed_price?: number };

/** Low-stock items handed over by Analytics → Restock (prefills a New purchase). */
export type RestockPrefill = {
  id: string;
  name: string;
  unit_label: string;
  last_unit_cost_paisa: number | null;
  /** Wanted amount in the item's own unit (packets for a packed item). Default 1. */
  qty?: number | null;
};

type Target = {
  id: string;
  name: string;
  unit_label: string;
  product_type: string;
  last_unit_cost_paisa: number | null;
  price_paisa: number;
  fixed_price: number;
  qty: number;
};

type Props = {
  displayName: string;
  initialInvoiceId?: string | null;
  onInitialInvoiceConsumed?: () => void;
  initialRestock?: RestockPrefill[] | null;
  onInitialRestockConsumed?: () => void;
  /** Data entry: records bills (costs from the paper bill), never sees totals, paid or due after saving. */
  showMoney?: boolean;
  /** Open straight into New bill (Purchases → New bill tab). */
  startEntry?: boolean;
  onEntryDone?: () => void;
  /** PU2: true while New bill has unsaved lines / charges / note (Hub warns before dropping it). */
  onDirtyChange?: (dirty: boolean) => void;
};

const formatRs = formatRsShort;

/** Line bought by carton / crate (or a scanned pack). */
const isPk = (line: DraftLine) => !!line.packId || !!line.pkg;
const pkName = (line: DraftLine) => line.pkg ?? line.packs?.find((p) => p.id === line.packId)?.name ?? 'Pack';

function packNums(line: DraftLine): { qty: number | null; units: number | null; cost: number | null } {
  const qty = parsePieces(line.packQty ?? '');
  const u = Number(line.packUnits);
  const units = Number.isFinite(u) && u > 0 ? u : null;
  const c = parseMoneyRs(line.packCost ?? '');
  return { qty, units, cost: c == null ? null : Math.round(c * 100) };
}

function totalPaisa(line: DraftLine): number | null {
  const t = parseMoneyRs(line.total ?? '');
  return t == null ? null : Math.round(t * 100);
}

/** Cost per pack (pack line) or per unit, derived from the line total when byTotal. */
function lineCostPaisa(line: DraftLine): number | null {
  if (line.byTotal && byWeight(line)) {
    const t = totalPaisa(line);
    const q = isPk(line) ? packNums(line).qty : looseQty(line);
    return t == null || q == null || q <= 0 ? null : Math.round(t / q);
  }
  if (isPk(line)) return packNums(line).cost;
  const c = parseMoneyRs(line.unitCost);
  return c == null ? null : Math.round(c * 100);
}

/** Loose kg / litre: the supplier's total is typed. Piece and carton / crate lines: price each / per pack. */
const byWeight = (line: DraftLine) => !isPk(line) && line.mode !== 'carton' && allowsFraction(line.unitLabel);

function lineAmountPaisa(line: DraftLine): number | null {
  if (line.byTotal && byWeight(line)) {
    const q = isPk(line) ? packNums(line).qty : looseQty(line);
    return q == null ? null : totalPaisa(line);
  }
  if (isPk(line)) {
    const n = packNums(line);
    if (n.qty == null || n.cost == null || !(line.packCost ?? '').trim()) return null;
    return n.qty * n.cost;
  }
  if (line.mode === 'carton') {
    const cartons = parsePieces(line.cartons);
    const cost = parseMoneyRs(line.cartonCost);
    if (cartons == null || cost == null) return null;
    const paisa = Math.round(cost * 100) * cartons;
    return Number.isSafeInteger(paisa) ? paisa : null;
  }
  const qty = looseQty(line);
  const cost = parseMoneyRs(line.unitCost);
  if (qty == null || cost == null || !line.unitCost.trim()) return null;
  const paisa = Math.round(Math.round(cost * 100) * qty);
  return Number.isSafeInteger(paisa) ? paisa : null;
}

function lineQtyOk(line: DraftLine): boolean {
  if (isPk(line)) {
    const n = packNums(line);
    return n.qty != null && n.qty > 0 && n.units != null && (allowsFraction(line.unitLabel) || Number.isInteger(n.qty * n.units));
  }
  if (line.mode === 'carton') {
    const cartons = parsePieces(line.cartons);
    const inside = parsePieces(line.unitsInside);
    if (cartons == null || inside == null) return false;
    const stock = cartons * inside;
    return Number.isSafeInteger(stock) && stock > 0;
  }
  return looseQty(line) != null;
}

/** Loose quantity: kg / litre take up to 3 decimals, other units whole numbers. */
function looseQty(line: DraftLine): number | null {
  return allowsFraction(line.unitLabel) ? parseQtyInput(line.qty, line.unitLabel) : parsePieces(line.qty);
}

function stockUnits(line: DraftLine): number | null {
  if (!lineQtyOk(line)) return null;
  if (isPk(line)) {
    const n = packNums(line);
    return Math.round((n.qty ?? 0) * (n.units ?? 0) * 1000) / 1000;
  }
  if (line.mode === 'carton') {
    return (parsePieces(line.cartons) ?? 0) * (parsePieces(line.unitsInside) ?? 0);
  }
  const q = looseQty(line);
  return q != null && line.unit === 'gram' ? Math.round(q) / 1000 : q;
}

/** Switch a line's measure: containers count packages × pcs per (dozen = 12); others count the item itself. */
function measurePatch(line: DraftLine, m: Measure): Partial<DraftLine> {
  if (isContainer(m)) {
    const units = FIXED_UNITS[m] ?? line.packUnitsBy?.[m];
    return {
      unit: m,
      pkg: CONTAINER_NAME[m],
      packId: undefined,
      packQty: line.pkg ? line.packQty : '1',
      packUnits: units != null ? String(units) : '',
      packCost: '',
      byTotal: false,
    };
  }
  return { unit: m, pkg: undefined, packId: undefined, qty: line.pkg ? line.packQty || '1' : line.qty, byTotal: false, total: '' };
}

export function PurchasesShell({
  displayName,
  initialInvoiceId,
  onInitialInvoiceConsumed,
  initialRestock,
  onInitialRestockConsumed,
  showMoney = true,
  startEntry = false,
  onEntryDone,
  onDirtyChange,
}: Props) {
  const { t } = useI18n();
  const [view, setView] = useState<View>('list');
  const [items, setItems] = useState<Invoice[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [openSupplierPhone, setOpenSupplierPhone] = useState<string | null>(null);

  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [drafts, setDrafts] = useState<DraftLine[]>([]);
  const [extras, setExtras] = useState<ExtraRow[]>(() => [newExtra()]);
  const [showExp, setShowExp] = useState(false);
  const [priceRows, setPriceRows] = useState<PriceCheckRow[] | null>(null);
  const pricing = usePricing();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [discount, setDiscount] = useState('0');
  const [paid, setPaid] = useState('0');
  const [purchasedOn, setPurchasedOn] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const focusLineKey = useRef<string | null>(null);
  const returnScanFocus = useRef(false);
  const searchFocus = () => document.getElementById('pur-search')?.focus();

  const refresh = useCallback(async () => {
    const list = await apiGet<{ items: Invoice[]; total: number }>('/purchases');
    setItems(list.items);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (view !== 'list') return;
    refresh().catch((err: unknown) => {
      setLoaded(true);
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    });
  }, [refresh, t, view]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((invoice) => {
      const supplier = supplierLabel(
        invoice.supplier_id,
        invoice.supplier_name,
        t,
      ).toLowerCase();
      const noteText = (invoice.note ?? '').toLowerCase();
      const dateText = invoice.purchased_on.toLowerCase();
      const totalText = `${formatRs(invoice.total_paisa)} ${rupeesPlain(invoice.total_paisa)} ${(invoice.total_paisa / 100).toFixed(2)}`.toLowerCase();
      return (
        supplier.includes(q) ||
        invoice.supplier_name.toLowerCase().includes(q) ||
        noteText.includes(q) ||
        dateText.includes(q) ||
        totalText.includes(q)
      );
    });
  }, [items, search, t]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const isEmptyPurchases = loaded && items.length === 0;
  const isEmptySearch =
    loaded && items.length > 0 && filtered.length === 0;

  useEffect(() => {
    if (view !== 'entry') return;
    let cancelled = false;
    apiGet<{ items: SupplierOpt[] }>('/suppliers?page=1&pageSize=100')
      .then((r) => {
        if (cancelled) return;
        const rows = r.items ?? [];
        setSuppliers(rows);
        setSupplierId((prev) => prev || rows.find((row) => row.id === NO_SUPPLIER_ID)?.id || '');
      })
      .catch(() => {
        if (!cancelled) setSuppliers([]);
      });
    apiGet<{ today: string }>('/suppliers?page=1&pageSize=1')
      .then((r) => {
        if (!cancelled) setPurchasedOn((prev) => prev || r.today || '');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [view]);

  useEffect(() => {
    if (view !== 'entry') return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      apiGet<{ items: ProductHit[] }>(
        `/catalog/products?q=${encodeURIComponent(q)}&page=1&pageSize=8&for=purchase`,
      )
        .then((r) => {
          if (!cancelled) setHits(r.items ?? []);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, view]);

  useEffect(() => {
    if (view === 'list') return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || busy || e.defaultPrevented) return;
      if (view === 'entry') {
        if (query.trim() || hits.length > 0) {
          setQuery('');
          setHits([]);
          return;
        }
        leaveEntry();
        return;
      }
      setView('list');
      setOpen(null);
      setLines([]);
      setOpenSupplierPhone(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, busy, query, hits.length]);

  const lineMoney = useMemo(() => drafts.map((line) => lineAmountPaisa(line)), [drafts]);
  const piecesBad = drafts.some((line) => !lineQtyOk(line));
  const totalMissing = lineMoney.some((n) => n == null);
  const moneyBad =
    parseMoneyRs(discount) == null ||
    parseMoneyRs(paid) == null ||
    extras.some((r) => r.amount.trim() !== '' && parseMoneyRs(r.amount) == null);
  const subtotal = lineMoney.reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const discountRs = parseMoneyRs(discount);
  const discountPaisa = discountRs == null ? 0 : Math.round(discountRs * 100);
  const discountBad = discountRs != null && discountPaisa > subtotal;
  const xRead = readExtras(extras);
  const totalPaisa = Math.max(0, subtotal - (discountRs == null ? 0 : discountPaisa)) + xRead.owed;
  const landed = landedLines(drafts.map((l, i) => ({ amount: lineMoney[i], pieces: stockUnits(l) ?? 0 })), discountBad ? 0 : discountPaisa, xRead.all);
  const paidRs = parseMoneyRs(paid);
  const paidPaisa = paidRs == null ? 0 : Math.round(paidRs * 100);
  const paidBad = paidRs != null && paidPaisa > (discountBad ? subtotal : totalPaisa);
  const duePaisa = moneyBad || discountBad || paidBad ? 0 : Math.max(0, totalPaisa - paidPaisa);

  const entryDirty =
    view === 'entry' &&
    (drafts.length > 0 || extras.some((x) => Number(x.amount) > 0) || note.trim() !== '');
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyRef.current?.(entryDirty);
  }, [entryDirty]);
  useEffect(() => () => onDirtyRef.current?.(false), []);

  function resetForm() {
    setDrafts([]);
    setSupplierId('');
    setDiscount('0');
    setPaid('0');
    setExtras([newExtra()]);
    setNote('');
    setQuery('');
    setHits([]);
    setPurchasedOn('');
  }

  function leaveEntry() {
    if (busy) return;
    resetForm();
    setError(null);
    setView('list');
    onEntryDone?.();
  }

  function openForm() {
    setOpen(null);
    setLines([]);
    setOpenSupplierPhone(null);
    setError(null);
    resetForm();
    setView('entry');
  }

  async function loadSupplierPhone(supplierId: string) {
    try {
      const detail = await apiGet<
        | { ok: true; supplier: { phone: string | null } }
        | { ok: false; error: string }
      >(`/suppliers/${encodeURIComponent(supplierId)}`);
      if (detail.ok) {
        setOpenSupplierPhone(detail.supplier.phone?.trim() || null);
      } else {
        setOpenSupplierPhone(null);
      }
    } catch {
      setOpenSupplierPhone(null);
    }
  }

  async function openInvoice(id: string) {
    setError(null);
    const detail = await apiGet<
      | { ok: true; invoice: Invoice; lines: Line[] }
      | { ok: false; error: string }
    >(`/purchases/${encodeURIComponent(id)}`);
    if (!detail.ok) {
      setError(translateError(t, detail.error));
      return;
    }
    setOpen(detail.invoice);
    setLines(detail.lines);
    setOpenSupplierPhone(null);
    setView('detail');
    void loadSupplierPhone(detail.invoice.supplier_id);
  }

  useEffect(() => {
    if (!initialInvoiceId) return;
    let cancelled = false;
    void (async () => {
      try {
        await openInvoice(initialInvoiceId);
      } catch {
        if (!cancelled) setError(t('purchaseNotFound'));
      } finally {
        if (!cancelled) onInitialInvoiceConsumed?.();
      }
    })();
    return () => {
      cancelled = true;
    };
    // openInvoice is stable enough for one-shot deep link
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInvoiceId]);


  // One-shot: Analytics / Stock alerts → restock opens New bill. Packed items arrive as kg of their loose source.
  useEffect(() => {
    if (!initialRestock || initialRestock.length === 0) return;
    const wanted = initialRestock;
    openForm();
    void (async () => {
      let targets: Target[];
      try {
        const r = await apiPost<{ ok: boolean; items?: Target[] }>('/purchase-orders/targets', {
          items: wanted.map((w) => ({ id: w.id, qty: w.qty ?? 1 })),
        });
        targets = r.items ?? [];
      } catch {
        targets = [];
      }
      onInitialRestockConsumed?.();
      const stamp = Date.now();
      setDrafts(
        targets.map((item, idx) => ({
          key: `${item.id}-${idx}-${stamp}`,
          productId: item.id,
          name: item.name,
          unitLabel: item.unit_label || 'piece',
          mode: 'loose' as const,
          qty: String(item.qty),
          unitCost: item.last_unit_cost_paisa != null && item.last_unit_cost_paisa >= 0 ? rupeesPlain(item.last_unit_cost_paisa) : '',
          cartons: '1',
          unitsInside: '1',
          cartonCost: '0',
          fixed: item.fixed_price === 1,
          productType: item.product_type ?? null,
          price: item.price_paisa ?? 0,
        })),
      );
      for (const item of targets) void applyPacks(item.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRestock]);

  function addProduct(product: ProductHit, focusLine = false, pick?: { packId: string; units: number }) {
    setDrafts((prev) => {
      const key = `${product.id}-${prev.length}-${Date.now()}`;
      focusLineKey.current = focusLine ? key : null;
      returnScanFocus.current = !focusLine;
      return [
        ...prev,
        {
          key,
          productId: product.id,
          name: product.name,
          unitLabel: product.unit_label ?? 'piece',
          mode: 'loose',
          qty: '1',
          unitCost: '',
          cartons: '1',
          unitsInside: '1',
          cartonCost: '0',
          fixed: product.fixed_price === 1,
          productType: product.product_type ?? null,
          price: product.price_paisa ?? 0,
        },
      ];
    });
    setQuery('');
    setHits([]);
    void applyPacks(product.id, pick);
  }

  /** How this item is bought: kg / piece stay loose; carton / crate get count + units in each (last bill) + cost per package. */
  async function applyPacks(productId: string, pick?: { packId: string; units: number }) {
    if (pick) {
      const packs = await loadPacks(productId);
      const chosen = packs.find((p) => p.id === pick.packId);
      if (!chosen) return;
      setDrafts((prev) => {
        const idx = [...prev].reverse().findIndex((l) => l.productId === productId);
        if (idx < 0) return prev;
        const at = prev.length - 1 - idx;
        const next = [...prev];
        next[at] = { ...prev[at], packs, packId: chosen.id, packQty: '1', packUnits: String(pick.units), packCost: '' };
        focusLineKey.current = prev[at].key;
        return next;
      });
      return;
    }
    const [info, hint] = await Promise.all([loadBuyInfo(supplierId, [productId]), loadHint(supplierId, productId)]);
    const b = info[productId];
    setDrafts((prev) => {
      const idx = [...prev].reverse().findIndex((l) => l.productId === productId);
      if (idx < 0) return prev;
      const at = prev.length - 1 - idx;
      const line = prev[at];
      const patch: Partial<DraftLine> = {};
      const units = (b?.units ?? []).filter(isMeasure);
      patch.units = units.length ? units : measuresFor({ unit_label: line.unitLabel, product_type: line.productType });
      patch.packUnitsBy = b?.pack_units ?? {};
      const use = [b?.last_unit, b?.buy_measure].find((u): u is Measure => isMeasure(u) && patch.units!.includes(u));
      patch.unit = use ?? patch.units[0];
      if (b && isContainer(patch.unit)) {
        patch.pkg = CONTAINER_NAME[patch.unit];
        const want = Number(line.qty);
        patch.packQty = b.last_pack_units && want > 1 ? String(Math.max(1, Math.ceil(want / b.last_pack_units - 1e-9))) : '1';
        const pu = FIXED_UNITS[patch.unit] ?? b.pack_units?.[patch.unit] ?? b.last_pack_units;
        patch.packUnits = pu ? String(pu) : '';
        if (pu && want > 1) patch.packQty = String(Math.max(1, Math.ceil(want / pu - 1e-9)));
        patch.packCost = b.last_pack_cost_paisa != null ? rupeesPlain(b.last_pack_cost_paisa) : '';
        focusLineKey.current = line.key;
      } else if (isContainer(patch.unit)) {
        Object.assign(patch, measurePatch({ ...line, ...patch }, patch.unit));
      } else if (hint && hint.last_cost_paisa != null && line.unitCost === '' && !hint.pack_id) {
        patch.unitCost = rupeesPlain(hint.last_cost_paisa);
      }
      const next = [...prev];
      next[at] = { ...line, ...patch };
      return next;
    });
  }

  useEffect(() => {
    if (view !== 'entry') return;
    searchFocus();
  }, [view]);

  useEffect(() => {
    if (startEntry) openForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startEntry]);

  useEffect(() => {
    if (returnScanFocus.current) {
      returnScanFocus.current = false;
      focusLineKey.current = null;
      searchFocus();
      return;
    }
    const key = focusLineKey.current;
    if (!key) return;
    focusLineKey.current = null;
    const node =
      document.getElementById(`pur-qty-${key}`);
    if (!(node instanceof HTMLInputElement)) return;
    node.focus();
    node.select();
  }, [drafts]);

  /** Barcode typed or scanned into the product search: product first, then a carton/crate barcode. */
  async function lookupCode(code: string): Promise<boolean> {
    try {
      const raw = await apiGetRaw<{ ok: boolean; error?: string; product?: ProductHit & { bulk_name?: string | null } }>(
        `/catalog/lookup?barcode=${encodeURIComponent(code)}&for=purchase`,
      );
      const bad = raw.json?.product;
      if (raw.status === 400 && raw.json?.error === 'packed_not_purchasable' && bad) {
        setError(
          bad.bulk_name
            ? t('ptPackedBuyBulk').replace('{name}', bad.name).split('{bulk}').join(bad.bulk_name)
            : t('errPackedNotPurchasable'),
        );
        return true;
      }
      if (raw.json?.ok && raw.json.product) {
        setError(null);
        addProduct(raw.json.product, true);
        return true;
      }
    } catch {
      /* try pack */
    }
    try {
      const pk = await apiGet<{ ok: boolean; item?: ProductHit & { pack_id: string; pack_units: number } }>(`/packs/lookup?barcode=${encodeURIComponent(code)}`);
      if (pk.ok && pk.item) {
        setError(null);
        addProduct(pk.item, true, { packId: pk.item.pack_id, units: pk.item.pack_units });
        return true;
      }
    } catch {
      /* fall through */
    }
    return false;
  }

  function patchLine(key: string, patch: Partial<DraftLine>) {
    setDrafts((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!supplierId) {
      setError(t('supplierRequired'));
      return;
    }
    if (drafts.length < 1) {
      setError(t('purchaseLinesRequired'));
      return;
    }
    if (piecesBad) {
      setError(t('invalidQty'));
      return;
    }
    if (moneyBad || totalMissing) {
      setError(t('invalidAmount'));
      return;
    }
    if (discountBad) {
      setError(t('purchaseDiscountTooHigh'));
      return;
    }
    if (paidBad) {
      setError(t('purchasePaidTooHigh'));
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<
        | { ok: true; invoice: Invoice; lines: Line[]; price_check?: PriceCheckRow[] }
        | { ok: false; error: string }
      >('/purchases', {
        supplierId,
        discountRs: parseMoneyRs(discount) ?? 0,
        paidRs: parseMoneyRs(paid) ?? 0,
        extras: xRead.body,
        purchasedOn: purchasedOn || undefined,
        note: note.trim() || null,
        lines: drafts.map((line) =>
          line.pkg && !line.packId
            ? {
                productId: line.productId,
                packages: parsePieces(line.packQty ?? ''),
                packUnits: Number(line.packUnits),
                packName: line.pkg,
                unit: line.unit,
                packCostRs: (lineCostPaisa(line) ?? 0) / 100,
                expiryDate: line.expiry || undefined,
                batchNo: line.batch?.trim() || undefined,
              }
            : line.packId
            ? {
                productId: line.productId,
                packId: line.packId,
                packQty: parsePieces(line.packQty ?? ''),
                packUnits: Number(line.packUnits),
                packCostRs: (lineCostPaisa(line) ?? 0) / 100,
                expiryDate: line.expiry || undefined,
                batchNo: line.batch?.trim() || undefined,
              }
            : line.mode === 'carton'
            ? {
                productId: line.productId,
                mode: 'carton',
                cartons: parsePieces(line.cartons),
                unitsPerCarton: parsePieces(line.unitsInside),
                cartonCostRs: parseMoneyRs(line.cartonCost) ?? 0,
                expiryDate: line.expiry || undefined,
                batchNo: line.batch?.trim() || undefined,
              }
            : {
                productId: line.productId,
                unit: line.unit,
                mode: 'loose',
                pieces: looseQty(line),
                unitCostRs: (lineCostPaisa(line) ?? 0) / 100,
                ...(line.byTotal && byWeight(line) ? { lineTotalRs: parseMoneyRs(line.total ?? '') ?? 0 } : {}),
                expiryDate: line.expiry || undefined,
                batchNo: line.batch?.trim() || undefined,
              },
        ),
      });
      if (!res.ok) {
        setError(translateError(t, res.error));
        return;
      }
      resetForm();
      setOpen(res.invoice);
      setLines(res.lines);
      setOpenSupplierPhone(null);
      setView('detail');
      if (showMoney !== false && res.price_check?.length) setPriceRows(res.price_check);
      void loadSupplierPhone(res.invoice.supplier_id);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  const validationAlert = piecesBad
    ? t('invalidQty')
    : moneyBad
      ? t('invalidAmount')
      : discountBad
        ? t('purchaseDiscountTooHigh')
        : paidBad
          ? t('purchasePaidTooHigh')
          : null;
  const entryAlert = error ?? validationAlert;


  const billRows: PlRow[] = drafts.map((line, i) => {
    const unit = t(productUnitKey(line.unitLabel));
    const unitLow = /^kg$/i.test(line.unitLabel) ? 'kg' : unit.toLowerCase();
    const added = stockUnits(line);
    const amount = lineMoney[i];
    const pk = isPk(line);
    const nums = packNums(line);
    const per = landed[i]?.landed ?? null;
    const kg = byWeight(line);
    const kgItem = /^kg$/i.test(line.unitLabel);
    const below = per != null && !line.fixed && (line.price ?? 0) > 0 && per >= (line.price ?? 0);
    const exp = showExp || !!line.expiry || !!line.batch;
    return {
      key: line.key,
      name: line.name,
      type: line.productType ?? null,
      qty: pk
        ? { value: line.packQty ?? '', whole: true, bad: nums.qty == null, label: `${pkName(line)}s ${line.name}`, onChange: (v) => patchLine(line.key, { packQty: v }) }
        : {
            value: line.qty,
            whole: !allowsFraction(line.unitLabel) || line.unit === 'gram',
            bad: looseQty(line) == null,
            label: `Qty ${line.name}`,
            onChange: (v) => patchLine(line.key, { qty: v }),
          },
      unitText: pk ? `${pkName(line).toLowerCase()}${nums.qty === 1 ? '' : 's'}` : unitLow,
      measure:
        !line.packId && line.units && line.unit
          ? { value: line.unit, options: line.units, onChange: (m) => isMeasure(m) && patchLine(line.key, measurePatch(line, m)) }
          : null,
      cost: kg
        ? null
        : pk
          ? { value: line.packCost ?? '', bad: nums.cost == null || (line.packCost ?? '').trim() === '', label: `Price per ${pkName(line).toLowerCase()} ${line.name}`, suffix: `/${pkgShort(pkName(line), 1)}`, onChange: (v) => patchLine(line.key, { packCost: v, byTotal: false }) }
          : { value: line.unitCost, bad: parseMoneyRs(line.unitCost) == null || line.unitCost.trim() === '', label: `Price each ${line.name}`, suffix: 'each', onChange: (v) => patchLine(line.key, { unitCost: v, byTotal: false }) },
      each: pk && !(line.unit && FIXED_UNITS[line.unit])
        ? {
            value: line.packUnits ?? '',
            bad: nums.units == null,
            label: `${line.unit === 'bag' && kgItem ? 'Kg' : 'Pieces'} per ${pkName(line).toLowerCase()} ${line.name}`,
            suffix: line.unit === 'bag' && kgItem ? 'kg' : 'pcs',
            onChange: (v) => patchLine(line.key, { packUnits: v }),
          }
        : null,
      total: kg
        ? {
            value: line.byTotal ? line.total ?? '' : amount == null ? '' : rupeesPlain(amount),
            bad: amount == null,
            label: `Total ${line.name}`,
            onChange: (v) => patchLine(line.key, { total: v, byTotal: v.trim() !== '' }),
          }
        : { text: amount == null ? '—' : formatRs(amount) },
      derived:
        added != null && added > 0
          ? landedText({ kg: unitLow === 'kg', pieces: added, word: unitLow, pkg: pk, landed: showMoney !== false ? per : null }, formatRs, formatQty)
          : '',
      sale:
        line.price == null ? null : line.fixed ? (
          <span className="muted ltr-isolate">MRP {formatRs(line.price)}</span>
        ) : below ? (
          <span className="po-price ltr-isolate">{formatRs(line.price)} <span className="po-below">Below cost</span></span>
        ) : (
          <span className="muted ltr-isolate">{formatRs(line.price)}</span>
        ),
      under:
        (line.fixed && line.price && showMoney !== false) || exp ? (
          <div className="pl-under__in">
            {line.fixed && line.price && showMoney !== false ? (
              <MrpStrip
                mrp={line.price}
                units={pk ? nums.units ?? 1 : 1}
                cost={lineCostPaisa(line)}
                minMarginBp={pricing.min_margin_bp}
                per={pk ? pkName(line).toLowerCase() : unitLow}
              />
            ) : null}
            {exp ? (
              <div className="pl-exp" data-expiry-fields>
                <div className="field">
                  <label htmlFor={`pur-exp-${line.key}`}>{t('expiryDate')}</label>
                  <input id={`pur-exp-${line.key}`} type="date" className="input" value={line.expiry ?? ''} onChange={(e) => patchLine(line.key, { expiry: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor={`pur-batch-${line.key}`}>{t('batchNo')}</label>
                  <input id={`pur-batch-${line.key}`} className="input ltr-isolate" maxLength={40} value={line.batch ?? ''} onChange={(e) => patchLine(line.key, { batch: e.target.value })} autoComplete="off" />
                </div>
              </div>
            ) : null}
          </div>
        ) : null,
      onRemove: () => setDrafts((prev) => prev.filter((row) => row.key !== line.key)),
    };
  });

  const pageHead = (
    <header className="purchases__head">
      <div>
        <h2 className="purchases__title">
          {view === 'entry' ? t('purchaseNew') : t('purchasesTitle')}
        </h2>
        <p className="muted purchases__subtitle">{displayName}</p>
      </div>
      {view === 'entry' ? (
        <button
          className="btn btn--ghost"
          type="button"
          disabled={busy}
          onClick={() => leaveEntry()}
        >
          {t('back')}
        </button>
      ) : null}
    </header>
  );

  return (
    <section className={`purchases${showMoney ? '' : ' dd-no-money'}`}>

      {view === 'detail' && !open && error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {view === 'entry' ? (
        <section className="card pl">
          <PageHeader
            title={t('purchaseNew')}
            subtitle={displayName}
            actions={
              <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => leaveEntry()}>
                {t('back')}
              </button>
            }
          />
          <form
            className="purchases-form pl-form"
            onSubmit={save}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.requestSubmit();
              }
            }}
          >
            <PlHead>
              <SupplierPicker
                id="pur-supplier"
                value={supplierId}
                onChange={setSupplierId}
                suppliers={suppliers}
                onAdded={(sNew) => setSuppliers((prev) => [...prev, sNew])}
                label={t('purchaseSupplier')}
              />
              <div className="field pl-date">
                <label htmlFor="pur-date">{t('purchaseDate')}</label>
                <input id="pur-date" className="ltr-isolate" type="date" value={purchasedOn} onChange={(e) => setPurchasedOn(e.target.value)} />
              </div>
              <div className="field pl-ref">
                <label htmlFor="pur-note">Ref</label>
                <input id="pur-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} autoComplete="off" />
              </div>
            </PlHead>
            <LineTable
              idp="pur"
              rows={billRows}
              showEach={drafts.some((l) => isPk(l))}
              showCost={drafts.some((l) => !byWeight(l))}
              costHead="Price (Rs)"
              eachHead="Pcs / pack"
              derivedHead="Landed cost"
              showSale={showMoney !== false}
              searchId="pur-search"
              tools={
                <>
                  <label className="po-perunit muted">
                    <input type="checkbox" id="pur-showexp" checked={showExp} onChange={(e) => setShowExp(e.target.checked)} /> Expiry / batch
                  </label>
                </>
              }
              search={
                <ProductAdd
                  id="pur-search"
                  autoFocus
                  onPick={(h) => addProduct(h as unknown as ProductHit, true)}
                  onCode={lookupCode}
                  unitText={(h) => t(productUnitKey(h.unit_label ?? 'piece'))}
                />
              }
            />
            <PlFoot
              rs={formatRs}
              subtotal={subtotal}
              discount={{ id: 'pur-discount', value: discount, onChange: setDiscount, bad: parseMoneyRs(discount) == null || discountBad }}
              paid={{ id: 'pur-paid', value: paid, onChange: setPaid, bad: parseMoneyRs(paid) == null || paidBad }}
              remaining={duePaisa}
              count={drafts.length}
              extras={<PlExtras idp="pur" rows={extras} onChange={setExtras} />}
              extrasOwed={xRead.owed}
              alert={entryAlert ? <p className="form-error" role="alert">{entryAlert}</p> : null}
            >
              <button
                className="btn btn--teal"
                type="submit"
                disabled={busy || drafts.length < 1 || discountBad || paidBad || moneyBad || piecesBad}
              >
                {busy ? t('loading') : t('purchaseSave')} <kbd>Ctrl+Enter</kbd>
              </button>
            </PlFoot>
          </form>
        </section>
      ) : null}

      {priceRows ? <PriceCheck rows={priceRows} onDone={() => setPriceRows(null)} /> : null}
      {view === 'detail' && open ? (
        <div className="purchases-detail">
          <PageHeader
            title={<>{t('purchasesTitle')}<UrHint k="purchasesTitle" /></>}
            subtitle={displayName}
            actions={
              <button
                className="btn btn--ghost"
                type="button"
                disabled={busy}
                onClick={() => {
                  setOpen(null);
                  setLines([]);
                  setOpenSupplierPhone(null);
                  setError(null);
                  setView('list');
                }}
              >
                {t('backToPurchases')}
              </button>
            }
          />

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <header className="purchases-detail__header">
            <div className="purchases-detail__identity">
              <h3 className="purchases-detail__title visually-hidden">
                {supplierLabel(open.supplier_id, open.supplier_name, t)}
              </h3>
              <dl className="purchases-detail__fields" aria-label={t('purchaseSupplier')}>
                <div className="purchases-detail__field">
                  <dt className="purchases-detail__field-label muted">{t('supplierName')}</dt>
                  <dd className="purchases-detail__field-value" dir="auto">
                    {supplierLabel(open.supplier_id, open.supplier_name, t)}
                  </dd>
                </div>
                <div className="purchases-detail__field">
                  <dt className="purchases-detail__field-label muted">{t('supplierPhone')}</dt>
                  <dd className="purchases-detail__field-value ltr-isolate">
                    {openSupplierPhone?.trim() ? openSupplierPhone.trim() : '—'}
                  </dd>
                </div>
                <div className="purchases-detail__field">
                  <dt className="purchases-detail__field-label muted">{t('purchaseDate')}</dt>
                  <dd className="purchases-detail__field-value ltr-isolate">
                    {fmtDate(open.purchased_on)}
                  </dd>
                </div>
                <div className="purchases-detail__field">
                  <dt className="purchases-detail__field-label muted">{t('purchaseNote')}</dt>
                  <dd className="purchases-detail__field-value" dir="auto">
                    {open.note?.trim() ? open.note.trim() : '—'}
                  </dd>
                </div>
              </dl>
            </div>

            <div
              className={`purchases-detail__summary dd-money${
                open.due_paisa === 0 ? ' purchases-detail__summary--settled' : ''
              }`}
              aria-label={t('purchaseTotal')}
            >
              <div className="purchases-detail__summary-lead">
                <div className="purchases-detail__summary-item">
                  <span className="purchases-detail__summary-label muted">
                    {t('purchaseTotal')}
                  </span>
                  <strong className="ltr-isolate purchases-detail__summary-total">
                    {formatRs(open.total_paisa)}
                  </strong>
                </div>
                <div className="purchases-detail__summary-item">
                  <span className="purchases-detail__summary-label muted">
                    {t('purchasePaid')}
                  </span>
                  <strong className="ltr-isolate purchases-detail__summary-value purchases-detail__summary-paid">
                    {formatRs(open.paid_paisa)}
                  </strong>
                </div>
                <div className="purchases-detail__summary-item">
                  <span className="purchases-detail__summary-label muted">
                    {t('purchaseDue')}
                  </span>
                  <strong
                    className={`ltr-isolate purchases-detail__summary-due${
                      open.due_paisa > 0 ? ' purchases-detail__summary-due--owed' : ''
                    }`}
                  >
                    {formatRs(open.due_paisa)}
                  </strong>
                </div>
              </div>
              <div className="purchases-detail__summary-secondary">
                <div className="purchases-detail__summary-item">
                  <span className="purchases-detail__summary-label muted">
                    {t('purchaseSubtotal')}
                  </span>
                  <span className="ltr-isolate purchases-detail__summary-value">
                    {formatRs(open.subtotal_paisa)}
                  </span>
                </div>
                <div className="purchases-detail__summary-item">
                  <span className="purchases-detail__summary-label muted">
                    {t('purchaseDiscount')}
                  </span>
                  <span className="ltr-isolate purchases-detail__summary-value">
                    {formatRs(open.discount_paisa)}
                  </span>
                </div>
                {(open.extras ?? []).map((x) => (
                  <div className="purchases-detail__summary-item" key={x.id} data-bill-extra>
                    <span className="purchases-detail__summary-label muted" dir="auto">
                      {x.label}{x.paid_separately ? ' (paid separately)' : ''}
                    </span>
                    <span className="ltr-isolate purchases-detail__summary-value">
                      {formatRs(x.amount_paisa)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </header>

          <section className="purchases-detail__lines-section" aria-label={t('purchaseLines')}>
            <h4 className="purchases-detail__section-title">{t('purchaseLines')}</h4>
            {lines.length === 0 ? (
              <p className="muted purchases-detail__lines-empty">—</p>
            ) : (
              <div className="catalog-table-wrap">
                <table className="catalog-table purchases-detail-table">
                  <caption className="visually-hidden">{t('purchaseLines')}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="catalog-table__col-product">
                        {t('catalogColProduct')}
                      </th>
                      <th scope="col">{t('purchaseQty')}</th>
                      <th scope="col" className="catalog-table__num">
                        {t('purchaseLineAmount')}
                      </th>
                      {showMoney !== false ? <th scope="col" className="catalog-table__num">Landed cost</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => {
                      const unit = t(productUnitKey(line.unit_label));
                      const m = lineMeasure(line);
                      const qtyText = m === 'gram'
                        ? `${formatQty(Math.round(line.pieces * 1000))} g · ${formatQty(line.pieces)} kg`
                        : !line.pack_name && line.mode !== 'carton' && !isContainer(m) && m !== line.unit_label.toLowerCase() && m !== 'kg' && m !== 'litre'
                        ? `${formatQty(line.pieces)} ${measureWord(m, line.pieces)}`
                        : line.pack_name
                        ? `${formatQty(line.pack_qty ?? 0)} ${line.pack_name} × ${formatQty(line.pack_units ?? 0)} · ${formatQty(line.pieces)} ${unit}`
                        : line.mode === 'carton'
                          ? `${t('purchaseCarton')} ${line.cartons} × ${line.units_per_carton} ${unit} · ${formatQty(line.pieces)} ${unit}`
                          : `${formatQty(line.pieces)} ${unit}`;
                      return (
                        <tr key={line.id}>
                          <td className="catalog-table__col-product">
                            <span className="catalog-table__name" dir="auto">
                              {line.product_name}
                            </span>
                          </td>
                          <td>
                            <span className="purchases-detail__qty muted ltr-isolate">
                              {qtyText}
                            </span>
                          </td>
                          <td className="catalog-table__num parties-table__amount">
                            <span className="ltr-isolate">
                              {formatRs(line.line_amount_paisa)}
                            </span>
                          </td>
                          {showMoney !== false ? (
                            <td className="catalog-table__num" data-landed>
                              <span className="ltr-isolate muted">
                                {line.unit_cost_paisa != null ? `${formatRs(line.unit_cost_paisa)}/${/^kg$/i.test(line.unit_label) ? 'kg' : unit.toLowerCase() === 'piece' ? 'pc' : unit.toLowerCase()}` : '—'}
                              </span>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {view === 'list' ? (
        <div className="purchases-list">
          {pageHead}

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="catalog__toolbar">
            <div className="catalog-search field">
              <label className="visually-hidden" htmlFor="purchases-list-search">
                {t('purchaseListSearch')}
              </label>
              <input
                id="purchases-list-search"
                className="catalog-search__input"
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={t('purchaseListSearch')}
                disabled={items.length === 0}
              />
            </div>
            <div className="catalog__toolbar-actions">
              <button
                className="btn btn--teal"
                type="button"
                onClick={openForm}
                disabled={busy}
              >
                {t('purchaseNew')}
              </button>
            </div>
          </div>

          {!loaded && !error ? (
            <p className="muted purchases-list__status" role="status">
              {t('loading')}
            </p>
          ) : isEmptyPurchases ? (
            <EmptyState
              className="purchases-list__empty"
              title={t('purchaseEmpty')}
              description={t('purchaseEmptyDesc')}
              action={
                <button className="btn btn--teal" type="button" onClick={openForm}>
                  {t('purchaseNew')}
                </button>
              }
            />
          ) : isEmptySearch ? (
            <p className="muted purchases-list__status">{t('purchaseNoMatches')}</p>
          ) : (
            <>
              <p className="catalog-table-count muted">
                {t('catalogShowing')
                  .replace('{from}', String((safePage - 1) * PAGE_SIZE + 1))
                  .replace('{to}', String((safePage - 1) * PAGE_SIZE + visible.length))
                  .replace('{total}', String(filtered.length))}
              </p>
              <div className="catalog-table-wrap">
                <table className="catalog-table parties-table purchases-table">
                  <caption className="visually-hidden">{t('purchaseList')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('purchaseDate')}</th>
                      <th scope="col" className="catalog-table__col-product">
                        {t('purchaseSupplier')}
                      </th>
                      <th scope="col" className="catalog-table__num">
                        {t('purchaseTotal')}
                      </th>
                      <th scope="col" className="catalog-table__num">
                        {t('purchasesColPaid')}
                      </th>
                      <th scope="col" className="catalog-table__num">
                        {t('purchaseDue')}
                      </th>
                      <th scope="col" className="purchases-table__col-note">
                        {t('purchaseNote')}
                      </th>
                      <th scope="col" className="parties-table__col-actions">
                        {t('partiesColActions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((invoice) => {
                      const label = supplierLabel(
                        invoice.supplier_id,
                        invoice.supplier_name,
                        t,
                      );
                      const noteText = invoice.note?.trim() || '';
                      const dueOwed = invoice.due_paisa > 0;
                      return (
                        <tr
                          key={invoice.id}
                          onClick={() => void openInvoice(invoice.id)}
                        >
                          <td>
                            <span className="ltr-isolate">{fmtDate(invoice.purchased_on)}</span>
                          </td>
                          <td className="catalog-table__col-product">
                            <button
                              type="button"
                              className="catalog-table__select"
                              title={noteText ? `${label} · ${noteText}` : label}
                              onClick={(e) => {
                                e.stopPropagation();
                                void openInvoice(invoice.id);
                              }}
                            >
                              <span className="catalog-table__name" dir="auto">
                                {label}
                              </span>
                            </button>
                          </td>
                          <td className="catalog-table__num parties-table__amount">
                            <span className="ltr-isolate">
                              {formatRs(invoice.total_paisa)}
                            </span>
                          </td>
                          <td
                            className={`catalog-table__num${
                              invoice.paid_paisa === 0
                                ? ' parties-table__amount--zero'
                                : ''
                            }`}
                          >
                            <span className="ltr-isolate">
                              {formatRs(invoice.paid_paisa)}
                            </span>
                          </td>
                          <td
                            className={`catalog-table__num${
                              dueOwed
                                ? ' purchases-table__due--owed'
                                : ' parties-table__amount--zero'
                            }`}
                          >
                            <span className="ltr-isolate">
                              {formatRs(invoice.due_paisa)}
                            </span>
                          </td>
                          <td className="purchases-table__col-note">
                            {noteText ? (
                              <span className="purchases-table__note" dir="auto" title={noteText}>
                                {noteText}
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="parties-table__col-actions">
                            <button
                              type="button"
                              className="btn btn--ghost parties-table__khata"
                              onClick={(e) => {
                                e.stopPropagation();
                                void openInvoice(invoice.id);
                              }}
                              disabled={busy}
                            >
                              {t('purchaseOpen')}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager
                page={safePage}
                pageSize={PAGE_SIZE}
                total={filtered.length}
                disabled={busy}
                onPage={setPage}
              />
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
