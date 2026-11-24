import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../shared/PageHeader';
import { UrHint, translateError, useI18n } from '../../i18n';
import { ConfirmModal } from '../shared/ConfirmModal';
import { EmptyState } from '../shared/EmptyState';
import { ProductThumb } from '../shared/ProductThumb';
import { NavIcon } from '../shared/NavIcons';
import { allowsFraction, formatQty, parseQtyInput, productUnit, productUnitKey, quickWeights, r3 } from '../shared/productUnits';
import { getScaleSettings, readScale } from '../scale/scale';
import { publishDisplay, toggleCustomerDisplay, type DisplayDone } from '../display/displayChannel';
import {
  currentPricePaisa,
  discountStatusOf,
  type ProductDiscountFields,
} from '../shared/discount';
import { apiGet, apiPost, apiPostRaw, apiGetRaw } from '../../lib/api';
import { formatRsShort, rupeesPlain } from '../../lib/money';
import { ReceiptView } from './ReceiptView';
import type { ReceiptLineInput, SaleReceiptFields } from './receipt';
import {
  printThermalReceipt,
  shouldAutoPrintReceipt,
} from './printReceipt';
import { MoneyInput } from '../shared/MoneyInput';
import { ManagerApproval } from '../tills/ManagerApproval';
import { useLink } from '../tills/TillLink';
import { readOpenSales, writeOpenSales } from './openSalesStore';
import {
  PAY_TYPES,
  billTotals,
  discountPaisaOf,
  kickDrawer,
  useShopRules,
  type BillDiscount,
  type PayType,
} from '../shared/shopRules';
import { DIGITAL_LABEL } from './receipt';
import { TypeTag } from '../shared/TypeTag';
import { suggestCashAmounts, type CashSuggestion } from './cashSuggestions';
import { isReadOnly, notifyReadOnly, openActivation, useReadOnly } from '../license/readOnly';

type Product = ProductDiscountFields & {
  product_type?: string;
  name_ur?: string | null;
  id: string;
  name: string;
  unit_label: string;
  price_paisa: number;
  qty_on_hand: number;
  barcode?: string | null;
  /** Extra barcodes (maker codes etc.); scanning any of them adds this item. */
  extra_barcodes?: string[];
  image_file?: string | null;
  pieces_per_carton?: number | null;
};

function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Primary + extra barcodes of a product. */
const codesOf = (p: Product): string[] => [p.barcode ?? '', ...(p.extra_barcodes ?? [])].filter(Boolean);
const hasCode = (p: Product, code: string) => codesOf(p).includes(code);

type Party = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  balance_paisa: number;
  credit_limit_paisa?: number | null;
  loyalty_points?: number;
};

type CartLine = {
  nameUr?: string | null;
  key: string;
  productId: string;
  name: string;
  imageFile?: string | null;
  unitLabel: string;
  qty: number;
  /** Price the till charges (after an active product discount). */
  unitPricePaisa: number;
  /** Normal piece price, to show the sale tag. */
  normalPricePaisa: number;
  /** Sold by the dozen / carton: qty counts packs of packSize pieces. */
  pack?: 'dozen' | 'carton';
  packSize?: number;
  /** Pieces in a carton for this product (1 = no carton option). */
  ppc?: number;
  /** Lite: manager price on this line; the till price it replaced. */
  overrideFrom?: number;
};

/** One parked bill the cashier can switch back to. */
type OpenSale = {
  id: string;
  /** Stable label number: Bill 1, Bill 2, … */
  seq: number;
  lines: CartLine[];
  /** Customer on this bill ('' = walk-in). Each parked bill keeps its own. */
  partyId: string;
  /** Edit of a saved bill (Owner, same day): saves as a new bill replacing it. */
  edit?: EditInfo;
  /** Whole-bill discount. */
  disc?: BillDiscount | null;
  /** How the paid part comes in. */
  payType?: PayType;
  payRef?: string;
  /** Loyalty points to spend on this bill. */
  points?: number;
};

type EditInfo = {
  saleId: string;
  shortId: string;
  /** Cash the customer already handed over on the old bill (kept in the till). */
  paidPaisa: number;
  /** Old bill's unit prices by product: kept on the edited bill. */
  fixedPrices: Record<string, number>;
};

/** Saved bill handed over from Sales → Edit. */
export type EditSaleInput = {
  id: string;
  short_id: string;
  cash_amount_paisa: number;
  kept_on_khata_paisa: number;
  party: { id: string } | null;
  discount_paisa?: number;
  discount_label?: string | null;
  loyalty_redeem_points?: number;
  loyalty_redeem_paisa?: number;
  digital_method?: string | null;
  digital_ref?: string | null;
  lines: Array<{
    product_id: string;
    product_name: string;
    image_file?: string | null;
    unit_label: string;
    qty: number;
    unit_price_paisa: number;
  }>;
};

const MAX_OPEN_SALES = 8;

/** Scanner's trailing Enter after an auto-add on a full barcode: ignore it. */
const SCAN_ENTER_GRACE_MS = 600;

function makeSaleId(): string {
  return `sale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptySale(seq: number): OpenSale {
  return { id: makeSaleId(), seq, lines: [], partyId: '' };
}

type PriceChange = {
  productId: string;
  unitPricePaisa: number;
  normalPricePaisa: number;
};

type PaymentMethod = 'cash' | 'udhaar' | 'split';

type DoneSale = {
  shortId: string;
  saleId: string;
  totalPaisa: number;
  paymentMethod: PaymentMethod;
  cashAmountPaisa: number;
  udhaarAmountPaisa: number;
  tenderedPaisa: number;
  changePaisa: number;
  surplusCreditedPaisa?: number;
  partyName?: string;
  clientDeviceAt: string;
  recordedAt: string;
  /** Tax V1 snapshot from the sale response (false → no tax line anywhere). */
  taxEnabled: boolean;
  subtotalPaisa?: number;
  discountPaisa?: number;
  discountLabel?: string | null;
  roundingPaisa?: number;
  digitalPaisa?: number;
  digitalMethod?: string | null;
  digitalRef?: string | null;
  loyaltyEarned?: number;
  loyaltyBalance?: number | null;
  taxRateBp: number;
  taxPaisa: number;
  storeName: string;
  receiptFooter?: string | null;
  lines: ReceiptLineInput[];
  /** Edit: the bill this one replaces. */
  replacesShortId?: string | null;
};

type Props = {
  /** Signed-in user: open bills are kept per user across screens (S1). */
  userId: string;
  displayName: string;
  role: 'owner' | 'manager' | 'cashier';
  /** Cashier chrome: Sign out. Owner uses rail foot — omit. */
  onLogout?: () => void;
  /** Cashier: back to Today. Owner uses the rail — omit. */
  onBack?: () => void;
  /** Owner: oversell → Purchases (stock comes in through a purchase). productId = the short item; not used yet. */
  onReceiveStock?: (productId?: string) => void;
  /** Owner: empty catalog → Catalog to add the first product. */
  onAddProduct?: () => void;
  /** Owner: open this saved bill as an Edit tab (one-shot). */
  editSale?: EditSaleInput | null;
  onEditConsumed?: () => void;
  onEditSaved?: (newSaleId: string) => void;
};

/** Sell screen money: "Rs 19,460" (decimals only when paisa ≠ 0). */
const formatRs = formatRsShort;

function lineTotal(line: CartLine): number {
  return Math.round(line.qty * (line.packSize ?? 1) * line.unitPricePaisa);
}

/** Parse Rs input → paisa (floor to whole paisa). */
function rsToPaisa(raw: string): number | null {
  const s = String(raw).trim();
  if (s === '') return 0;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** First word of a customer name for the bill tab ("Hamza Khan" → "Hamza"). */
function shortCustomerName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first.length > 14 ? `${first.slice(0, 13)}…` : first;
}

function isPlusKey(e: React.KeyboardEvent): boolean {
  return e.key === '+' || e.code === 'NumpadAdd';
}

function isMinusKey(e: React.KeyboardEvent): boolean {
  return e.key === '-' || e.code === 'NumpadSubtract';
}

export function PosShell({
  userId,
  displayName,
  role,
  onLogout,
  onBack,
  onReceiveStock,
  onAddProduct,
  editSale,
  onEditConsumed,
  onEditSaved,
}: Props) {
  const { t } = useI18n();
  const readOnly = useReadOnly();
  const [items, setItems] = useState<Product[]>([]);
  const link = useLink();
  const payUuidRef = useRef(new Map<string, string>());
  const [parties, setParties] = useState<Party[]>([]);
  // S1: open bills live in a per-user store, so leaving Sell keeps them (Sign Out asks in App).
  const [saleBoot] = useState(() => {
    const kept = readOpenSales<OpenSale>(userId);
    if (kept && kept.sales.length > 0) {
      return { sales: kept.sales, activeId: kept.activeId, seq: kept.seq };
    }
    const first = createEmptySale(1);
    return { sales: [first] as OpenSale[], activeId: first.id, seq: 2 };
  });
  const [sales, setSales] = useState<OpenSale[]>(saleBoot.sales);
  const [activeSaleId, setActiveSaleId] = useState(saleBoot.activeId);
  const seqRef = useRef(saleBoot.seq);
  const activeId = sales.some((s) => s.id === activeSaleId)
    ? activeSaleId
    : (sales[0]?.id ?? saleBoot.activeId);
  const activeSale =
    sales.find((s) => s.id === activeId) ?? sales[0] ?? saleBoot.sales[0];
  const cart = activeSale.lines;
  const partyId = activeSale.partyId;

  useEffect(() => {
    writeOpenSales<OpenSale>({ userId, sales, activeId, seq: seqRef.current });
  }, [userId, sales, activeId]);
  const [pickId, setPickId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  /** Bill row that +/- keys (and the row buttons) act on: last added / changed. */
  const [activeLineKey, setActiveLineKey] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const pickListRef = useRef<HTMLUListElement>(null);
  const partyNameRef = useRef<HTMLInputElement>(null);
  const cashTenderedRef = useRef<HTMLInputElement>(null);
  const lastAutoScanAtRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [shortageProductId, setShortageProductId] = useState<string | null>(
    null,
  );
  const [stockShortage, setStockShortage] = useState(false);
  /** Items short on the last refused sale, e.g. "Lays 30 g (0 left)". */
  const [shortageText, setShortageText] = useState('');
  const [catalogSoftWarn, setCatalogSoftWarn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<DoneSale | null>(null);
  const [viewReceipt, setViewReceipt] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [receiptFooter, setReceiptFooter] = useState<string | null>(null);
  const [receiptWidthMm, setReceiptWidthMm] = useState<58 | 80>(80);
  const [receiptPrinterName, setReceiptPrinterName] = useState<string | null>(
    null,
  );
  const [receiptPrintEnabled, setReceiptPrintEnabled] = useState(true);
  /** Brief post-sale toast on the till (print / sale done). */
  const [saleFlash, setSaleFlash] = useState<{
    msg: string;
    kind: 'ok' | 'err';
  } | null>(null);

  // Payment step — cash received → change / khata; customer always optional.
  const [payOpen, setPayOpen] = useState(false);
  const [cashTenderedRs, setCashTenderedRs] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  /** Overpay by a named customer: keep the extra on khata instead of change. */
  const [keepSurplusOnKhata, setKeepSurplusOnKhata] = useState(false);
  /** Arrow-key highlight in customer search results. */
  const [customerPickId, setCustomerPickId] = useState('');
  const [newPartyName, setNewPartyName] = useState('');
  const [newPartyPhone, setNewPartyPhone] = useState('');
  const [newPartyAddress, setNewPartyAddress] = useState('');
  const [partyModalOpen, setPartyModalOpen] = useState(false);
  const [partySaving, setPartySaving] = useState(false);
  const [partyModalError, setPartyModalError] = useState<string | null>(null);
  /** Bill tab id waiting on Discard confirm (items still on it). */
  const [pendingDiscardId, setPendingDiscardId] = useState<string | null>(null);
  /** Ticks so sale prices in the pick list follow the clock. */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Sales → Edit: open the saved bill as its own tab with the same customer and lines.
  useEffect(() => {
    if (!editSale) return;
    const fixedPrices: Record<string, number> = {};
    const lines: CartLine[] = [];
    for (const l of editSale.lines) {
      if (fixedPrices[l.product_id] == null) fixedPrices[l.product_id] = l.unit_price_paisa;
      const existing = lines.find((x) => x.key === l.product_id);
      if (existing) {
        existing.qty += l.qty;
        continue;
      }
      lines.push({
        key: l.product_id,
        productId: l.product_id,
        name: l.product_name,
        imageFile: l.image_file ?? null,
        unitLabel: l.unit_label,
        qty: l.qty,
        unitPricePaisa: l.unit_price_paisa,
        normalPricePaisa: l.unit_price_paisa,
      });
    }
    // Restore the old bill's whole-bill discount (points kept apart) and pay type.
    const manualDisc = Math.max(0, (editSale.discount_paisa ?? 0) - (editSale.loyalty_redeem_paisa ?? 0));
    const lbl = editSale.discount_label ?? '';
    const pct = /^([\d.]+)%$/.exec(lbl);
    const disc: BillDiscount | null =
      manualDisc > 0 ? (pct ? { kind: 'percent', value: Number(pct[1]) } : { kind: 'amount', value: manualDisc / 100 }) : null;
    const tab: OpenSale = {
      id: makeSaleId(),
      seq: seqRef.current,
      lines,
      disc,
      points: editSale.loyalty_redeem_points || undefined,
      payType: (PAY_TYPES as readonly string[]).includes(editSale.digital_method ?? '') ? (editSale.digital_method as PayType) : undefined,
      payRef: editSale.digital_ref ?? undefined,
      partyId: editSale.party?.id ?? '',
      edit: {
        saleId: editSale.id,
        shortId: editSale.short_id,
        paidPaisa: Math.max(0, editSale.cash_amount_paisa + editSale.kept_on_khata_paisa),
        fixedPrices,
      },
    };
    seqRef.current += 1;
    setSales((prev) => {
      // Same bill already open in a tab: just switch to it.
      const open = prev.find((x) => x.edit?.saleId === editSale.id);
      if (open) {
        setActiveSaleId(open.id);
        return prev;
      }
      const emptyOnly = prev.length === 1 && prev[0].lines.length === 0 && !prev[0].edit;
      setActiveSaleId(tab.id);
      return emptyOnly ? [tab] : [...prev, tab].slice(-MAX_OPEN_SALES);
    });
    onEditConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSale]);

  const focusSearch = useCallback(() => {
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  const refreshCatalog = useCallback(async () => {
    try {
      const r = await apiGet<{ items: Product[] }>('/catalog/products?for=sale');
      setItems(r.items);
      setCatalogSoftWarn(false);
      if (r.items.length > 0) {
        setPickId((prev) =>
          prev && r.items.some((p) => p.id === prev) ? prev : r.items[0].id,
        );
      } else {
        setPickId('');
      }
    } catch {
      setCatalogSoftWarn(true);
      setError('catalog_unavailable');
      throw new Error('catalog_unavailable');
    }
  }, []);

  const refreshParties = useCallback(async () => {
    const r = await apiGet<{ items: Party[] }>('/parties');
    setParties(r.items);
    // Keep each bill's customer only if still valid; never auto-pick (walk-in is default).
    setSales((prev) =>
      prev.map((s) =>
        s.partyId && !r.items.some((p) => p.id === s.partyId)
          ? { ...s, partyId: '' }
          : s,
      ),
    );
  }, []);

  useEffect(() => {
    refreshCatalog().catch(() => {
      /* soft warn already set */
    });
    refreshParties().catch(() => {
      /* parties optional until first open */
    });
    apiGet<{
      store?: {
        id: string;
        name: string;
        receipt_footer?: string | null;
        receipt_width_mm?: number;
        receipt_printer_name?: string | null;
        receipt_print_enabled?: boolean;
      } | null;
    }>('/auth/status')
      .then((s) => {
        if (s.store?.name) setStoreName(s.store.name);
        if (s.store?.receipt_footer) {
          setReceiptFooter(s.store.receipt_footer);
        } else {
          setReceiptFooter(null);
        }
        setReceiptWidthMm(s.store?.receipt_width_mm === 58 ? 58 : 80);
        setReceiptPrinterName(
          s.store?.receipt_printer_name?.trim()
            ? s.store.receipt_printer_name.trim()
            : null,
        );
        setReceiptPrintEnabled(s.store?.receipt_print_enabled !== false);
      })
      .catch(() => {
        /* store name optional fallback */
      });
  }, [refreshCatalog, refreshParties]);

  useEffect(() => {
    if (!partyModalOpen) return;
    partyNameRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || partySaving) return;
      setPartyModalOpen(false);
      setPartyModalError(null);
      setNewPartyName('');
      setNewPartyPhone('');
      setNewPartyAddress('');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [partyModalOpen, partySaving]);

  /** Latest submit for the window-level F8 shortcut (avoids stale closures). */
  const submitRef = useRef<(kind: 'cash' | 'khata') => void>(() => undefined);
  const cyclePayTypeRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!payOpen) return;
    const frame = window.requestAnimationFrame(() => {
      cashTenderedRef.current?.focus({ preventScroll: true });
      // Bring the whole payment block (down to the two pay buttons) into view.
      document
        .querySelector('[data-inline-checkout]')
        ?.scrollIntoView({ block: 'nearest' });
    });
    function onKey(e: KeyboardEvent) {
      if (partyModalOpen || pendingDiscardId) return;
      if (e.key === 'F8') {
        e.preventDefault();
        submitRef.current('khata');
        return;
      }
      if (e.key === 'F6') {
        e.preventDefault();
        cyclePayTypeRef.current();
        return;
      }
      if (e.key === 'F7') {
        e.preventDefault();
        const el = document.getElementById('bill-disc') as HTMLInputElement | null;
        el?.focus();
        el?.select();
        return;
      }
      if (e.key !== 'Escape' || busy) return;
      setPayOpen(false);
      setError(null);
      setShortageProductId(null);
      setStockShortage(false);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
    };
  }, [payOpen, busy, partyModalOpen, pendingDiscardId]);

  const selectedParty = partyId
    ? parties.find((p) => p.id === partyId)
    : undefined;
  const hasParty = Boolean(selectedParty);
  const subtotalPaisa = useMemo(
    () => cart.reduce((s, l) => s + lineTotal(l), 0),
    [cart],
  );
  const rules = useShopRules();
  const billDisc = activeSale.disc ?? null;
  const payType: PayType = activeSale.payType ?? 'cash';
  const payRef = activeSale.payRef ?? '';
  const manualDiscPaisa = discountPaisaOf(subtotalPaisa, billDisc);
  const partyPoints = Math.max(0, selectedParty?.loyalty_points ?? 0) + (activeSale.edit ? activeSale.points ?? 0 : 0);
  const loyaltyOn = rules.loyalty_enabled && hasParty;
  const redeemPoints = loyaltyOn
    ? Math.max(0, Math.min(activeSale.points ?? 0, partyPoints, Math.floor((subtotalPaisa - manualDiscPaisa) / Math.max(1, rules.loyalty_point_value_paisa))))
    : 0;
  const redeemPaisa = redeemPoints * rules.loyalty_point_value_paisa;
  const discountPaisa = manualDiscPaisa + redeemPaisa;
  const { totalPaisa, roundingPaisa } = billTotals(subtotalPaisa, discountPaisa, rules.round_to_paisa);
  const discountOverLimit =
    role !== 'owner' && role !== 'manager' &&
    manualDiscPaisa > 0 &&
    manualDiscPaisa > Math.floor((subtotalPaisa * rules.cashier_discount_max_bp) / 10000);
  const updateActive = (patch: Partial<OpenSale>) =>
    setSales((prev) => prev.map((s) => (s.id === activeId ? { ...s, ...patch } : s)));
  const overrideCreditRef = useRef(false);
  /** Lite: manager approval token for price overrides on this bill (cashier). */
  const priceApprovalRef = useRef<string | null>(null);
  const [priceAsk, setPriceAsk] = useState(false);
  const [priceFor, setPriceFor] = useState<string | null>(null);
  const [priceText, setPriceText] = useState('');
  const lastPayKindRef = useRef<'cash' | 'khata'>('cash');
  const [creditNote, setCreditNote] = useState<string | null>(null);

  const setCart = useCallback(
    (updater: CartLine[] | ((prev: CartLine[]) => CartLine[])) => {
      setSales((prev) =>
        prev.map((s) => {
          if (s.id !== activeId) return s;
          const lines =
            typeof updater === 'function' ? updater(s.lines) : updater;
          return { ...s, lines };
        }),
      );
    },
    [activeId],
  );

  /** Attach a customer to the open bill ('' = walk-in). */
  const setPartyId = useCallback(
    (id: string) => {
      setSales((prev) =>
        prev.map((s) => (s.id === activeId ? { ...s, partyId: id } : s)),
      );
    },
    [activeId],
  );

  function resetPayUi() {
    setPayOpen(false);
    setPartyModalOpen(false);
    setPartyModalError(null);
    setPartySaving(false);
    setNewPartyName('');
    setNewPartyPhone('');
    setCashTenderedRs('');
    setKeepSurplusOnKhata(false);
    setShortageProductId(null);
    setStockShortage(false);
  }

  function selectWalkIn() {
    setPartyId('');
    setCustomerQuery('');
    setCustomerPickId('');
    setKeepSurplusOnKhata(false);
  }

  function selectCustomer(id: string) {
    setPartyId(id);
    setCustomerQuery('');
    setCustomerPickId('');
    setKeepSurplusOnKhata(false);
    if (payOpen) {
      requestAnimationFrame(() => cashTenderedRef.current?.focus());
    } else {
      focusSearch();
    }
  }

  function selectSale(id: string) {
    if (id === activeId) return;
    setError(null);
    resetPayUi();
    setActiveSaleId(id);
    setActiveLineKey('');
    focusSearch();
  }

  function addSaleTab() {
    if (sales.length >= MAX_OPEN_SALES) {
      setError('sale_tabs_at_cap');
      return;
    }
    setError(null);
    resetPayUi();
    const next = createEmptySale(seqRef.current);
    seqRef.current += 1;
    setSales((prev) => [...prev, next]);
    setActiveSaleId(next.id);
    setActiveLineKey('');
    focusSearch();
  }

  function discardSaleTab(id: string) {
    const target = sales.find((s) => s.id === id);
    if (!target) return;
    setPendingDiscardId(null);
    setError(null);
    if (sales.length <= 1) {
      // Always keep one tab — reset it to empty walk-in.
      resetPayUi();
      setSales([{ ...target, lines: [], partyId: '', edit: undefined }]);
      setActiveSaleId(target.id);
      focusSearch();
      return;
    }
    const remaining = sales.filter((s) => s.id !== id);
    const nextActive =
      id === activeId
        ? remaining[0]?.id ?? activeId
        : activeId;
    if (id === activeId) resetPayUi();
    setSales(remaining);
    setActiveSaleId(nextActive);
    focusSearch();
  }

  function closeSaleTab(id: string) {
    const target = sales.find((s) => s.id === id);
    if (!target) return;
    if (target.lines.length > 0) {
      setPendingDiscardId(id);
      return;
    }
    discardSaleTab(id);
  }

  function renderDiscardModal() {
    if (!pendingDiscardId) return null;
    return (
      <ConfirmModal
        title={t('saleTabDiscardTitle')}
        message={t('saleTabDiscardConfirm')}
        confirmLabel={t('saleTabDiscard')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          const id = pendingDiscardId;
          discardSaleTab(id);
        }}
        onCancel={() => setPendingDiscardId(null)}
      />
    );
  }

  /** "Bill 1" for walk-in; the customer's first name when one is attached. */
  function saleTabText(sale: OpenSale): { label: string; full: string } {
    if (sale.edit) {
      const label = t('posEditTab').replace('{id}', sale.edit.shortId);
      return { label, full: label };
    }
    const bill = t('billTab').replace('{n}', String(sale.seq));
    const party = sale.partyId
      ? parties.find((p) => p.id === sale.partyId)
      : undefined;
    if (!party) return { label: bill, full: bill };
    return { label: shortCustomerName(party.name), full: party.name };
  }

  function renderSaleTabs() {
    return (
      <div
        className="pos-sale-tabs"
        role="tablist"
        aria-label={t('saleTabsList')}
      >
        <div className="pos-sale-tabs__list">
          {sales.map((sale) => {
            const selected = sale.id === activeId;
            const { label, full } = saleTabText(sale);
            const total = sale.lines.reduce((s, l) => s + lineTotal(l), 0);
            return (
              <div
                key={sale.id}
                className={`pos-sale-tab${selected ? ' is-active' : ''}${
                  sale.partyId ? ' pos-sale-tab--customer' : ''
                }`}
                role="presentation"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  id={`pos-sale-tab-${sale.id}`}
                  className="pos-sale-tab__hit"
                  disabled={busy}
                  title={full}
                  data-bill-tab={label}
                  onClick={() => selectSale(sale.id)}
                >
                  <span className="pos-sale-tab__label">{label}</span>
                  {sale.lines.length > 0 ? (
                    <span className="pos-sale-tab__total ltr-isolate">
                      {formatRs(total)}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="pos-sale-tab__close"
                  aria-label={t('saleTabClose')}
                  title={t('saleTabClose')}
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeSaleTab(sale.id);
                  }}
                >
                  <NavIcon name="close" className="pos-icon pos-icon--sm" />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="btn btn--ghost pos-sale-tabs__new"
          onClick={addSaleTab}
          disabled={busy || sales.length >= MAX_OPEN_SALES}
          title={
            sales.length >= MAX_OPEN_SALES
              ? t('saleTabsAtCap').replace('{n}', String(MAX_OPEN_SALES))
              : undefined
          }
        >
          <NavIcon name="plus" className="pos-icon pos-icon--sm" />
          {t('newBill')}
        </button>
        <button
          type="button"
          className="btn btn--ghost pos-sale-tabs__new"
          data-customer-display-toggle
          onClick={() => void toggleCustomerDisplay()}
        >
          {t('customerDisplay')}
        </button>
      </div>
    );
  }

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    // Bulk (loose) items only come up when searched, never in the plain list.
    if (!q) return items.filter((p) => p.product_type !== 'bulk');
    return items.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.name_ur ?? '').includes(searchQuery.trim()) ||
        codesOf(p).some((c) => c.toLowerCase().includes(q)),
    );
  }, [items, searchQuery]);

  const filteredParties = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return [] as Party[];
    return parties
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.phone ?? '').toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [parties, customerQuery]);

  useEffect(() => {
    if (filteredParties.length === 0) {
      setCustomerPickId('');
      return;
    }
    setCustomerPickId((prev) =>
      prev && filteredParties.some((p) => p.id === prev)
        ? prev
        : filteredParties[0].id,
    );
  }, [filteredParties]);

  function moveCustomerPick(delta: number) {
    if (filteredParties.length === 0) return;
    const idx = filteredParties.findIndex((p) => p.id === customerPickId);
    const cur = idx < 0 ? 0 : idx;
    const next =
      (cur + delta + filteredParties.length) % filteredParties.length;
    setCustomerPickId(filteredParties[next].id);
  }

  function onCustomerSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveCustomerPick(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveCustomerPick(-1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const party =
        filteredParties.find((p) => p.id === customerPickId) ??
        filteredParties[0];
      if (!party) return;
      selectCustomer(party.id);
      return;
    }
    if (e.key === 'Escape') {
      if (customerQuery) {
        e.preventDefault();
        e.stopPropagation();
        setCustomerQuery('');
        setCustomerPickId('');
      }
    }
  }

  // Keep arrow-key highlight valid when the filtered list changes.
  useEffect(() => {
    if (filteredItems.length === 0) {
      setPickId('');
      return;
    }
    setPickId((prev) =>
      prev && filteredItems.some((p) => p.id === prev)
        ? prev
        : filteredItems[0].id,
    );
  }, [filteredItems]);

  // Bill row highlight follows the open bill.
  useEffect(() => {
    if (cart.length === 0) {
      if (activeLineKey) setActiveLineKey('');
      return;
    }
    if (!cart.some((l) => l.key === activeLineKey)) {
      setActiveLineKey(cart[cart.length - 1].key);
    }
  }, [cart, activeLineKey]);

  function scrollPickIntoView(id: string) {
    const root = pickListRef.current;
    if (!root || !id) return;
    const row = root.querySelector(
      `.pos-pick-row[data-product-id="${CSS.escape(id)}"]`,
    ) as HTMLElement | null;
    row?.scrollIntoView({ block: 'nearest' });
  }

  function movePick(delta: number) {
    if (filteredItems.length === 0) return;
    const idx = filteredItems.findIndex((p) => p.id === pickId);
    const cur = idx < 0 ? 0 : idx;
    const next =
      (cur + delta + filteredItems.length) % filteredItems.length;
    const id = filteredItems[next].id;
    setPickId(id);
    requestAnimationFrame(() => scrollPickIntoView(id));
  }

  /** A full barcode typed by the scanner: exactly one product, no longer code starts with it. */
  function uniqueBarcodeMatch(code: string): Product | undefined {
    if (!/^\d{8,}$/.test(code)) return undefined;
    const exact = items.filter((p) => hasCode(p, code));
    if (exact.length !== 1) return undefined;
    const longer = items.some((p) => codesOf(p).some((c) => c.length > code.length && c.startsWith(code)));
    return longer ? undefined : exact[0];
  }

  function onSearchChange(value: string) {
    const match = uniqueBarcodeMatch(value.trim());
    if (match) {
      addOnePiece(match);
      setSearchQuery('');
      lastAutoScanAtRef.current = Date.now();
      return;
    }
    setSearchQuery(value);
  }

  async function addByCode(code: string) {
    let match = items.find((p) => hasCode(p, code));
    if (!match) {
      try {
        const raw = await apiGetRaw<{ ok: boolean; error?: string; product?: Product }>(
          `/catalog/lookup?barcode=${encodeURIComponent(code)}&for=sale`,
        );
        if (raw.status === 400 && raw.json?.error === 'bulk_not_sold_loose' && raw.json.product) {
          setError('bulk_not_sold_loose');
          focusSearch();
          return;
        }
        if (!raw.json?.ok || !raw.json.product) throw new Error('nf');
        match = raw.json.product;
      } catch {
        setError('barcode_not_found');
        focusSearch();
        return;
      }
    }
    addOnePiece(match);
    focusSearch();
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      movePick(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      movePick(-1);
      return;
    }
    if (searchQuery === '' && activeLineKey && (e.key === '*' || e.key === '/')) {
      // Empty box: * types the weight, / types a Rs amount on a loose row.
      const line = cart.find((l) => l.key === activeLineKey);
      if (line && allowsFraction(line.unitLabel)) {
        e.preventDefault();
        focusRowField(line.key, e.key === '*' ? 'qty' : 'rs');
        return;
      }
    }
    if (searchQuery === '' && (isPlusKey(e) || isMinusKey(e))) {
      // Empty box: + / − change the highlighted bill row.
      e.preventDefault();
      if (activeLineKey) changeQty(activeLineKey, isPlusKey(e) ? 1 : -1);
      return;
    }
    if (e.key === 'Escape') {
      if (searchQuery) {
        e.preventDefault();
        e.stopPropagation();
        setSearchQuery('');
      }
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = searchQuery.trim();
    if (!code) {
      if (Date.now() - lastAutoScanAtRef.current < SCAN_ENTER_GRACE_MS) return;
      if (payOpen) {
        cashTenderedRef.current?.focus();
        return;
      }
      if (cart.length > 0 && !busy) openPay();
      return;
    }
    const exact = items.find((p) => hasCode(p, code));
    if (exact) {
      addOnePiece(exact);
      setSearchQuery('');
      focusSearch();
      return;
    }
    const product =
      filteredItems.find((p) => p.id === pickId) ?? filteredItems[0];
    if (product) {
      setPickId(product.id);
      addOnePiece(product);
      setSearchQuery('');
      focusSearch();
      return;
    }
    if (/^[0-9A-Za-z-]{4,}$/.test(code)) {
      // Not on the loaded list: ask the shop's catalog for the exact code.
      setSearchQuery('');
      void addByCode(code);
    }
  }

  // ── Payment numbers ──
  // Edit: the customer already paid on the old bill, so the cash step works on
  // the difference only (collect more, or give back).
  const editInfo = activeSale.edit;
  const alreadyPaidPaisa = editInfo ? editInfo.paidPaisa : 0;
  const billTotalPaisa = totalPaisa;
  const editGiveBackPaisa = editInfo ? Math.max(0, alreadyPaidPaisa - billTotalPaisa) : 0;
  const payTotalPaisa = editInfo ? Math.max(0, billTotalPaisa - alreadyPaidPaisa) : billTotalPaisa;
  const cashFieldEmpty = cashTenderedRs.trim() === '';
  const parsedCashPaisa = cashFieldEmpty ? null : rsToPaisa(cashTenderedRs);
  const cashInvalid = !cashFieldEmpty && parsedCashPaisa == null;
  /** Empty field = exact cash (the total). */
  const receivedPaisa = cashFieldEmpty ? payTotalPaisa : (parsedCashPaisa ?? 0);
  const changePaisa = Math.max(0, receivedPaisa - payTotalPaisa) + editGiveBackPaisa;
  const shortPaisa = Math.max(0, payTotalPaisa - receivedPaisa);
  const keepSurplus = hasParty && changePaisa > 0 && keepSurplusOnKhata;
  /** Unpaid part that Add to khata puts on the customer's khata. */
  const khataUnpaidPaisa = cashFieldEmpty ? payTotalPaisa : shortPaisa;
  const canPayCash =
    !busy &&
    !discountOverLimit &&
    cart.length > 0 &&
    !cashInvalid &&
    (cashFieldEmpty || (parsedCashPaisa ?? 0) > 0 || payTotalPaisa === 0) &&
    // Walk-in can't leave a balance: cash must cover the bill.
    (shortPaisa === 0 || hasParty);
  /** Quick amounts from the bill total; partials (Rs 0 …) only when khata is possible. */
  const cashSuggestions: CashSuggestion[] = useMemo(
    () => suggestCashAmounts(payTotalPaisa, { allowPartial: hasParty }),
    [payTotalPaisa, hasParty],
  );
  const canPayKhata =
    !link.offline &&
    !busy && !discountOverLimit && cart.length > 0 && !cashInvalid && hasParty && khataUnpaidPaisa > 0;

  function addOnePiece(product: Product) {
    setError(null);
    const key = product.id;
    // Price at the moment of adding; the whole line follows the latest price.
    const fixed = activeSale.edit?.fixedPrices[product.id];
    const unitPricePaisa = fixed ?? currentPricePaisa(product, Date.now());
    const normalPricePaisa = fixed ?? Math.max(0, Math.round(product.price_paisa));
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) =>
          l.key === key
            ? { ...l, qty: l.qty + 1, unitPricePaisa, normalPricePaisa }
            : l,
        );
      }
      return [
        ...prev,
        {
          key,
          productId: product.id,
          name: product.name,
          nameUr: product.name_ur ?? null,
          imageFile: product.image_file ?? null,
          unitLabel: product.unit_label,
          qty: 1,
          unitPricePaisa,
          normalPricePaisa,
          ppc: Math.max(1, Math.floor(Number(product.pieces_per_carton) || 1)),
        },
      ];
    });
    setActiveLineKey(key);
  }

  /**
   * One step up or down on a bill row. Sell counts whole units (the API takes
   * whole pieces for every unit), so the step is 1; it never goes below 1 —
   * the row's remove button takes it off the bill.
   */
  function changeQty(key: string, delta: number) {
    setError(null);
    setCart((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              qty: allowsFraction(l.unitLabel)
                ? Math.max(Math.min(l.qty, 0.25), r3(l.qty + delta * 0.25))
                : Math.max(1, l.qty + delta),
            }
          : l,
      ),
    );
    setActiveLineKey(key);
  }



  const [scaleBusy, setScaleBusy] = useState(false);
  const scaleOn = getScaleSettings().enabled;
  /** Weighing scale → row weight (kg items). Manual entry stays as the fallback. */
  async function readScaleInto(key: string) {
    if (scaleBusy) return;
    setScaleBusy(true);
    setError(null);
    try {
      const kg = await readScale();
      setLineQty(key, kg);
    } catch (e) {
      setError(e instanceof Error && e.message.startsWith('scale_') ? e.message : 'scale_no_reading');
      focusRowField(key, 'qty');
    } finally {
      setScaleBusy(false);
    }
  }
  /** F4: change the price on the highlighted (else last) bill row. */
  const priceKeyRef = useRef<() => void>(() => undefined);
  priceKeyRef.current = () => {
    const target = cart.find((l) => l.key === activeLineKey) ?? cart[cart.length - 1];
    if (!target || busy) return;
    setPriceText(String((target.unitPricePaisa / 100).toFixed(2)).replace(/\.00$/, ''));
    setPriceFor(target.key);
  };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'F4') return;
      e.preventDefault();
      priceKeyRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  function savePrice() {
    const key = priceFor;
    const p = rsToPaisa(priceText);
    if (!key || p == null) return;
    setPriceFor(null);
    setSales((prev) =>
      prev.map((s) =>
        s.id !== activeId
          ? s
          : {
              ...s,
              lines: s.lines.map((l) => {
                if (l.key !== key) return l;
                const from = l.overrideFrom ?? l.unitPricePaisa;
                return p === from ? { ...l, unitPricePaisa: from, overrideFrom: undefined } : { ...l, unitPricePaisa: p, overrideFrom: from };
              }),
            },
      ),
    );
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  const scaleKeyRef = useRef<() => void>(() => undefined);
  scaleKeyRef.current = () => {
    const kgLines = cart.filter((l) => productUnit(l.unitLabel) === 'kg');
    const target = kgLines.find((l) => l.key === activeLineKey) ?? kgLines[kgLines.length - 1];
    if (target) void readScaleInto(target.key);
  };
  useEffect(() => {
    if (!scaleOn) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'F9') return;
      e.preventDefault();
      scaleKeyRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scaleOn]);

  /** Set a row's quantity exactly (loose items: weight, quick buttons, Rs worth). */
  function setLineQty(key: string, qty: number) {
    setError(null);
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, qty: r3(qty) } : l)));
    setActiveLineKey(key);
  }

  function focusRowField(key: string, field: 'qty' | 'rs') {
    const el = document.querySelector<HTMLInputElement>(
      `[data-bill-row-key="${CSS.escape(key)}"] [data-${field}-input]`,
    );
    el?.focus();
    el?.select();
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
    focusSearch();
  }

  /**
   * Re-price the bill from the loaded catalog at this instant (a discount may have
   * started or ended since the items were added). Returns the new total, and
   * whether anything changed.
   */
  function repriceCart(): { total: number; changed: boolean } {
    const at = Date.now();
    let changed = false;
    const next = cart.map((l) => {
      const product = items.find((p) => p.id === l.productId);
      if (!product) return l;
      // Edit: lines from the old bill keep the old bill's price.
      if (activeSale.edit?.fixedPrices[l.productId] != null) return l;
      // A changed price stays; only the shelf price it replaced moves.
      if (l.overrideFrom != null) {
        const shelf = currentPricePaisa(product, at);
        if (shelf === l.overrideFrom) return l;
        changed = true;
        return { ...l, overrideFrom: shelf, normalPricePaisa: Math.max(0, Math.round(product.price_paisa)) };
      }
      const unitPricePaisa = currentPricePaisa(product, at);
      if (unitPricePaisa === l.unitPricePaisa) return l;
      changed = true;
      return {
        ...l,
        unitPricePaisa,
        normalPricePaisa: Math.max(0, Math.round(product.price_paisa)),
      };
    });
    if (changed) setCart(next);
    return { total: next.reduce((s, l) => s + lineTotal(l), 0), changed };
  }

  function applyPriceChanges(changes: PriceChange[]) {
    setCart((prev) =>
      prev.map((l) => {
        const c = changes.find((x) => x.productId === l.productId);
        if (!c) return l;
        if (l.overrideFrom != null) return { ...l, overrideFrom: c.unitPricePaisa, normalPricePaisa: c.normalPricePaisa };
        return { ...l, unitPricePaisa: c.unitPricePaisa, normalPricePaisa: c.normalPricePaisa };
      }),
    );
  }

  function openPay() {
    if (isReadOnly()) { notifyReadOnly(); return; }
    if (cart.length === 0) return;
    const priced = repriceCart();
    if (priced.changed) {
      // Let the cashier see the new total before taking money.
      setError('prices_updated');
      return;
    }
    setError(null);
    setShortageProductId(null);
    setStockShortage(false);
    setPayOpen(true);
    setPartyModalOpen(false);
    setPartySaving(false);
    setPartyModalError(null);
    setNewPartyName('');
    setNewPartyPhone('');
    setNewPartyAddress('');
    setKeepSurplusOnKhata(false);
    // Empty = exact cash (placeholder shows total).
    setCashTenderedRs('');
    refreshParties().catch(() => undefined);
  }

  function closePay() {
    setPayOpen(false);
    setError(null);
    setShortageProductId(null);
    setStockShortage(false);
    focusSearch();
  }

  function onCashChange(value: string) {
    setCashTenderedRs(value);
    setKeepSurplusOnKhata(false);
  }

  /** Quick amount: SETS cash received (Exact = total, Rs 0 = whole bill on khata). */
  function tapSuggestion(paisa: number) {
    setCashTenderedRs(rupeesPlain(paisa));
    setKeepSurplusOnKhata(false);
    setError(null);
    cashTenderedRef.current?.focus();
  }


  function closePartyModal() {
    if (partySaving) return;
    setPartyModalOpen(false);
    setPartyModalError(null);
    setNewPartyName('');
    setNewPartyPhone('');
    setNewPartyAddress('');
  }

  function openPartyModal() {
    setPartyModalError(null);
    setNewPartyName('');
    setNewPartyPhone('');
    setNewPartyAddress('');
    setPartyModalOpen(true);
  }

  async function saveNewParty(e: React.FormEvent) {
    e.preventDefault();
    const name = newPartyName.trim();
    if (!name) {
      setPartyModalError('name_required');
      return;
    }
    setPartySaving(true);
    setPartyModalError(null);
    try {
      const res = await apiPost<
        { ok: true; party: Party } | { ok: false; error: string }
      >('/parties', {
        name,
        phone: newPartyPhone.trim() || null,
        address: newPartyAddress.trim() || null,
      });
      if (!res.ok) {
        setPartyModalError(res.error);
        return;
      }
      await refreshParties();
      setPartyId(res.party.id);
      setPartyModalOpen(false);
      setNewPartyName('');
      setNewPartyPhone('');
      setNewPartyAddress('');
    } catch {
      setPartyModalError('parties_unavailable');
    } finally {
      setPartySaving(false);
    }
  }


  /**
   * Finish the open bill.
   * - 'cash' (Cash received): paid sale; change returned (or kept on khata by a
   *   named customer). A named customer paying part leaves the rest on khata.
   *   Walk-in must cover the bill.
   * - 'khata' (Add to khata): named customer only; the unpaid part (total −
   *   cash received, or the whole total when nothing was entered) goes on khata.
   */
  async function completePay(kind: 'cash' | 'khata') {
    if (isReadOnly()) { notifyReadOnly(); return; }
    if (cart.length === 0 || busy) return;
    lastPayKindRef.current = kind;
    if (cashInvalid) {
      setError('invalid_cash_tendered');
      return;
    }
    if (kind === 'cash' && !canPayCash) return;
    if (kind === 'khata' && !canPayKhata) return;

    // Freeze the tab we are paying so a switch mid-request cannot clear another bill.
    const paidId = activeId;
    const cartLines = cart;
    const paidTotalPaisa = totalPaisa;

    let method: PaymentMethod;
    let cashAmt: number;
    let udhaarAmt: number;
    let paidCashTenderedPaisa: number;

    // Edit: cash on the new bill = cash already paid + cash handed over now.
    const prePaid = activeSale.edit ? activeSale.edit.paidPaisa : 0;
    if (kind === 'cash') {
      const receivedFull = prePaid + receivedPaisa;
      paidCashTenderedPaisa = receivedFull;
      if (receivedFull >= paidTotalPaisa) {
        method = 'cash';
        cashAmt = paidTotalPaisa;
        udhaarAmt = 0;
      } else if (receivedFull <= 0) {
        method = 'udhaar';
        cashAmt = 0;
        udhaarAmt = paidTotalPaisa;
      } else {
        method = 'split';
        cashAmt = receivedFull;
        udhaarAmt = paidTotalPaisa - receivedFull;
      }
    } else {
      const given = prePaid + (cashFieldEmpty ? 0 : (parsedCashPaisa ?? 0));
      paidCashTenderedPaisa = given;
      if (given <= 0) {
        method = 'udhaar';
        cashAmt = 0;
        udhaarAmt = paidTotalPaisa;
      } else {
        method = 'split';
        cashAmt = given;
        udhaarAmt = paidTotalPaisa - given;
      }
    }

    const resolvedPartyId = partyId && selectedParty ? partyId : null;
    const partyName = selectedParty?.name;
    const paidChangePaisa =
      method === 'cash' ? Math.max(0, paidCashTenderedPaisa - paidTotalPaisa) : 0;
    const keepSurplus =
      kind === 'cash' &&
      Boolean(resolvedPartyId) &&
      paidChangePaisa > 0 &&
      keepSurplusOnKhata;

    setBusy(true);
    setError(null);
    try {
      // One id per bill payment: a retry after a lost answer never records the bill twice.
      let payUuid = payUuidRef.current.get(paidId);
      if (!payUuid) {
        payUuid = newUuid();
        payUuidRef.current.set(paidId, payUuid);
      }
      const body: Record<string, unknown> = {
        clientUuid: payUuid,
        paymentMethod: method,
        clientDeviceAt: new Date().toISOString(),
        lines: cartLines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unit: l.pack ?? 'piece',
          // API refuses with price_changed if the till price moved since.
          expectedUnitPricePaisa: l.overrideFrom ?? l.unitPricePaisa,
          ...(l.overrideFrom != null ? { overridePricePaisa: l.unitPricePaisa } : {}),
        })),
      };
      if (priceApprovalRef.current) body.approval = priceApprovalRef.current;
      priceApprovalRef.current = null;
      if (resolvedPartyId) {
        body.partyId = resolvedPartyId;
      }
      if (method === 'split') {
        body.cashAmountPaisa = cashAmt;
        body.udhaarAmountPaisa = udhaarAmt;
      }
      body.tenderedPaisa = method === 'udhaar' ? 0 : paidCashTenderedPaisa;
      if (keepSurplus) {
        body.applySurplusToKhata = true;
      }
      if (billDisc && manualDiscPaisa > 0) body.discount = billDisc;
      if (redeemPoints > 0) body.loyaltyRedeemPoints = redeemPoints;
      const digital = payType !== 'cash' && method !== 'udhaar' && cashAmt > 0;
      if (digital) {
        body.digitalPaisa = cashAmt;
        body.digitalMethod = payType;
        if (payRef.trim()) body.digitalRef = payRef.trim();
        body.tenderedPaisa = cashAmt;
      }
      if (overrideCreditRef.current) body.overrideCreditLimit = true;
      overrideCreditRef.current = false;

      const res = await apiPostRaw<
        | {
            ok: true;
            sale: {
              id: string;
              shortId: string;
              totalPaisa: number;
              paymentMethod: PaymentMethod;
              partyId: string | null;
              cashAmountPaisa: number;
              udhaarAmountPaisa: number;
              tenderedPaisa?: number;
              changePaisa?: number;
              surplusCreditedPaisa?: number;
              clientDeviceAt: string;
              recordedAt: string;
              lines?: Array<{
                productId?: string;
                productName: string;
                qtyInput: number;
                unit: string;
                unitPricePaisa: number;
                lineTotalPaisa: number;
              }>;
              /** Tax V1 snapshot (inclusive; total unchanged). */
              taxEnabled?: boolean;
              taxRateBp?: number;
              taxPaisa?: number;
              taxBasePaisa?: number | null;
            };
          }
        | {
            ok: false;
            error?: string;
            message?:
              | string
              | {
                  ok?: boolean;
                  error?: string;
                  shortages?: Array<{ productId?: string; productName: string; onHand: number }>;
                  prices?: PriceChange[];
                };
            shortages?: Array<{ productId?: string; productName: string; onHand: number }>;
            prices?: PriceChange[];
          }
      >(
        activeSale.edit ? `/sales/${encodeURIComponent(activeSale.edit.saleId)}/replace` : '/sales',
        body,
      );

      if (res.status === 409 || (res.json && 'ok' in res.json && !res.json.ok)) {
        const bodyJson = res.json as {
          ok?: boolean;
          error?: string;
          message?:
            | string
            | {
                error?: string;
                shortages?: Array<{ productId?: string; productName: string; onHand: number }>;
                prices?: PriceChange[];
              };
          shortages?: Array<{ productId?: string; productName: string; onHand: number }>;
          prices?: PriceChange[];
        } | null;
        const nested =
          bodyJson && typeof bodyJson.message === 'object'
            ? bodyJson.message
            : null;
        const errCode =
          nested?.error ?? bodyJson?.error ?? 'insufficient_stock';
        const shortages = nested?.shortages ?? bodyJson?.shortages ?? [];
        if (errCode === 'manager_approval_needed') {
          setPriceAsk(true);
          return;
        }
        if (errCode === 'price_changed') {
          // A sale started or ended mid-checkout: show the new cart total first.
          applyPriceChanges(nested?.prices ?? bodyJson?.prices ?? []);
          setShortageProductId(null);
          setStockShortage(false);
          setPayOpen(false);
          setError('price_changed');
          await refreshCatalog().catch(() => undefined);
          return;
        }
        if (errCode === 'insufficient_stock') {
          const detail = shortages
            .map((s) => {
              const left = Math.max(0, Math.round(Number(s.onHand) * 1000) / 1000);
              return `${s.productName} (${t('sellShortageLeft').replace('{n}', String(left))})`;
            })
            .join(', ');
          setShortageText(detail);
          setError('insufficient_stock');
          const firstId =
            shortages.find((s) => s.productId)?.productId ??
            (() => {
              const name = shortages[0]?.productName;
              if (!name) return null;
              const matches = items.filter((prod) => prod.name === name);
              return matches.length === 1 ? matches[0].id : null;
            })();
          setShortageProductId(firstId);
          setStockShortage(true);
        } else {
          setError(errCode);
          setShortageProductId(null);
          setStockShortage(false);
        }
        await refreshCatalog().catch(() => undefined);
        return;
      }

      if (!res.ok || !res.json || !('ok' in res.json) || !res.json.ok) {
        const fail = res.json as { error?: string } | null;
        setError(fail?.error ?? 'sale_failed');
        return;
      }

      payUuidRef.current.delete(paidId);
      const sale = res.json.sale as typeof res.json.sale & {
        subtotalPaisa?: number;
        discountPaisa?: number;
        discountLabel?: string | null;
        roundingPaisa?: number;
        digitalPaisa?: number;
        digitalMethod?: string | null;
        digitalRef?: string | null;
        loyaltyEarnedPoints?: number;
        loyaltyBalance?: number | null;
      };
      const cw = (res.json as { creditWarning?: { limitPaisa: number; balanceAfterPaisa: number } | null }).creditWarning;
      setCreditNote(
        cw
          ? t('creditOverLimit')
              .replace('{balance}', formatRs(cw.balanceAfterPaisa))
              .replace('{limit}', formatRs(cw.limitPaisa))
          : null,
      );
      if (rules.drawer_kick && !digital && method !== 'udhaar') void kickDrawer(receiptPrinterName);
      const unitByProduct = new Map(cartLines.map((l) => [l.productId, l.pack ?? l.unitLabel]));
      const receiptLines: ReceiptLineInput[] = (sale.lines ?? []).map((l) => ({
        name: l.productName,
        qtyInput: l.qtyInput,
        unit: (l.productId && unitByProduct.get(l.productId)) || l.unit,
        unitPricePaisa: l.unitPricePaisa,
        lineTotalPaisa: l.lineTotalPaisa,
      }));
      // Fallback lines from cart if API omitted them
      const linesOut: ReceiptLineInput[] =
        receiptLines.length > 0
          ? receiptLines
          : cartLines.map((l) => ({
              name: l.name,
              qtyInput: l.qty,
              unit: l.unitLabel || 'piece',
              unitPricePaisa: l.unitPricePaisa,
              lineTotalPaisa: lineTotal(l),
            }));

      const doneSale: DoneSale = {
        shortId: sale.shortId,
        saleId: sale.id,
        totalPaisa: sale.totalPaisa,
        paymentMethod: sale.paymentMethod,
        cashAmountPaisa: sale.cashAmountPaisa ?? cashAmt,
        udhaarAmountPaisa: sale.udhaarAmountPaisa ?? udhaarAmt,
        tenderedPaisa:
          sale.tenderedPaisa ?? (method === 'udhaar' ? 0 : paidCashTenderedPaisa),
        changePaisa:
          sale.changePaisa ??
          (keepSurplus
            ? 0
            : method === 'udhaar'
              ? 0
              : Math.max(0, paidCashTenderedPaisa - (sale.cashAmountPaisa ?? cashAmt))),
        surplusCreditedPaisa:
          sale.surplusCreditedPaisa ?? (keepSurplus ? paidChangePaisa : 0),
        partyName,
        clientDeviceAt: sale.clientDeviceAt,
        recordedAt: sale.recordedAt,
        taxEnabled: sale.taxEnabled === true,
        taxRateBp: sale.taxEnabled === true ? Number(sale.taxRateBp) || 0 : 0,
        taxPaisa: sale.taxEnabled === true ? Number(sale.taxPaisa) || 0 : 0,
        storeName: storeName || t('storeNamePlaceholder'),
        receiptFooter,
        lines: linesOut,
        replacesShortId: activeSale.edit?.shortId ?? null,
        subtotalPaisa: sale.subtotalPaisa ?? subtotalPaisa,
        discountPaisa: sale.discountPaisa ?? discountPaisa,
        discountLabel: sale.discountLabel ?? null,
        roundingPaisa: sale.roundingPaisa ?? roundingPaisa,
        digitalPaisa: sale.digitalPaisa ?? 0,
        digitalMethod: sale.digitalMethod ?? null,
        digitalRef: sale.digitalRef ?? null,
        loyaltyEarned: sale.loyaltyEarnedPoints ?? 0,
        loyaltyBalance: rules.loyalty_enabled && sale.partyId ? (sale.loyaltyBalance ?? null) : null,
      };
      if (rules.loyalty_enabled && sale.partyId) void refreshParties();
      setDisplayDone({
        totalPaisa: doneSale.totalPaisa,
        changePaisa: doneSale.changePaisa,
        id: doneSale.shortId,
        at: Date.now(),
        method: doneSale.paymentMethod,
        tenderedPaisa: doneSale.tenderedPaisa,
        cashPaisa: doneSale.cashAmountPaisa,
        udhaarPaisa: doneSale.udhaarAmountPaisa,
        digitalPaisa: doneSale.digitalPaisa,
        digitalLabel: doneSale.digitalMethod ? DIGITAL_LABEL[doneSale.digitalMethod] ?? doneSale.digitalMethod : null,
        taxPaisa: doneSale.taxPaisa,
        surplusCreditedPaisa: doneSale.surplusCreditedPaisa,
        pointsEarned: doneSale.loyaltyEarned,
        party: doneSale.partyName ?? null,
      });
      if (activeSale.edit) onEditSaved?.(sale.id);
      setPayOpen(false);
      setCustomerQuery('');
      setCustomerPickId('');
      setKeepSurplusOnKhata(false);
      // Clear the paid tab; close it if other bills remain, else leave one empty walk-in bill.
      const othersAtPay = sales.filter((s) => s.id !== paidId);
      if (othersAtPay.length > 0) {
        setSales(othersAtPay);
        setActiveSaleId(othersAtPay[0].id);
      } else {
        setSales((prev) =>
          prev.map((s) =>
            s.id === paidId
              ? { ...s, lines: [], partyId: '', edit: undefined, disc: null, payType: 'cash', payRef: '' }
              : s,
          ),
        );
      }
      await refreshCatalog().catch(() => undefined);
      if (resolvedPartyId || method === 'udhaar' || method === 'split') {
        await refreshParties();
      }

      // Prefer ready till: print when configured, never park on a heavy details page.
      await settleAfterSale(doneSale);
    } catch {
      setError('sale_failed');
    } finally {
      setBusy(false);
    }
  }

  function receiptPrintLabels() {
    return {
      total: t('receiptTotal'),
      payment: t('receiptPayment'),
      cash: t('receiptCash'),
      udhaar: t('receiptUdhaar'),
      paid: t('receiptPaid'),
      change: t('receiptChange'),
      party: t('receiptParty'),
      split: t('receiptSplit'),
      clientTime: t('receiptClientTime'),
      recordedTime: t('receiptRecordedTime'),
      sale: t('receiptSaleId'),
      salesTaxIncl: t('receiptSalesTaxIncl'),
    };
  }

  async function settleAfterSale(doneSale: DoneSale) {
    const autoPrint = shouldAutoPrintReceipt({
      printerName: receiptPrinterName,
      printEnabled: receiptPrintEnabled,
    });

    if (autoPrint) {
      const printed = await printThermalReceipt({
        fields: receiptFieldsFromDone(doneSale),
        widthMm: receiptWidthMm,
        printerName: receiptPrinterName,
        labels: receiptPrintLabels(),
        noteLine: doneSale.replacesShortId
          ? t('receiptReplaces').replace('{id}', doneSale.replacesShortId)
          : null,
      });
      if (printed === 'ok') {
        setSaleFlash({
          kind: 'ok',
          msg: t('receiptPrinted').replace('{id}', doneSale.shortId),
        });
      } else {
        // Sale already saved — show print error and stay ready for next sale.
        setSaleFlash({ kind: 'err', msg: t('receiptPrintFailed') });
      }
    } else if (doneSale.replacesShortId) {
      setSaleFlash({
        kind: 'ok',
        msg: t('posEditSaved')
          .replace('{new}', doneSale.shortId)
          .replace('{old}', doneSale.replacesShortId),
      });
    } else {
      const surplus = doneSale.surplusCreditedPaisa ?? 0;
      const base = t('saleDoneFlash')
        .replace('{id}', doneSale.shortId)
        .replace('{total}', formatRs(doneSale.totalPaisa));
      setSaleFlash({
        kind: 'ok',
        msg:
          surplus > 0
            ? `${base} · ${t('surplusCredited')}: ${formatRs(surplus)}`
            : base,
      });
    }

    setDone(null);
    setViewReceipt(false);
    setError(null);
    setShortageProductId(null);
    setStockShortage(false);
    resetPayUi();
    setSearchQuery('');
    focusSearch();
    window.setTimeout(() => setSaleFlash(null), 3200);
  }

  function newSale() {
    // After a completed ticket: dismiss receipt chrome and land on remaining tabs
    // (paid tab already cleared/closed in completePay).
    setDone(null);
    setViewReceipt(false);
    setError(null);
    setShortageProductId(null);
    setStockShortage(false);
    resetPayUi();
    setSearchQuery('');
    focusSearch();
  }

  function receiptFieldsFromDone(d: DoneSale): SaleReceiptFields {
    return {
      saleId: d.saleId,
      shortId: d.shortId,
      storeName: d.storeName,
      paymentMethod: d.paymentMethod,
      lines: d.lines,
      totalPaisa: d.totalPaisa,
      cashAmountPaisa: d.cashAmountPaisa,
      udhaarAmountPaisa: d.udhaarAmountPaisa,
      tenderedPaisa: d.tenderedPaisa,
      changePaisa: d.changePaisa,
      partyName: d.partyName ?? null,
      clientDeviceAt: d.clientDeviceAt,
      recordedAt: d.recordedAt,
      receiptFooter: d.receiptFooter ?? null,
      taxEnabled: d.taxEnabled,
      taxRateBp: d.taxRateBp,
      taxPaisa: d.taxPaisa,
      subtotalPaisa: d.subtotalPaisa,
      discountPaisa: d.discountPaisa,
      discountLabel: d.discountLabel,
      roundingPaisa: d.roundingPaisa,
      digitalPaisa: d.digitalPaisa,
      digitalMethod: d.digitalMethod,
      digitalRef: d.digitalRef,
      loyaltyEarned: d.loyaltyEarned,
      loyaltyBalance: d.loyaltyBalance,
    };
  }


  // Customer screen follows the open bill (a finished sale stays up until the next item).
  const [displayDone, setDisplayDone] = useState<DisplayDone | null>(null);
  useEffect(() => {
    if (cart.length > 0 && displayDone) setDisplayDone(null);
  }, [cart.length, displayDone]);
  useEffect(() => {
    publishDisplay({
      store: storeName,
      lines: cart.map((l) => ({
        name: l.name,
        qty: `${formatQty(l.qty)} ${l.pack === 'dozen' ? t('packDozen') : l.pack === 'carton' ? t('packCarton') : t(productUnitKey(l.unitLabel))}`,
        totalPaisa: lineTotal(l),
        key: l.key,
        qtyNum: l.qty,
        unitPricePaisa: l.qty > 0 ? Math.round(lineTotal(l) / l.qty) : l.unitPricePaisa,
        imageFile: l.imageFile ?? null,
      })),
      subtotalPaisa,
      discountPaisa,
      roundingPaisa,
      totalPaisa,
      party: selectedParty?.name ?? null,
      points: loyaltyOn ? partyPoints : null,
      done: cart.length === 0 ? displayDone : null,
    });
  }, [cart, storeName, subtotalPaisa, discountPaisa, roundingPaisa, totalPaisa, selectedParty, loyaltyOn, partyPoints, displayDone, t]);

  const payStatusKey = `${changePaisa > 0}-${shortPaisa > 0}-${keepSurplus}`;
  useEffect(() => {
    if (!payOpen) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector('.pos-pay-actions')
        ?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [payOpen, payStatusKey]);

  submitRef.current = (kind) => {
    void completePay(kind);
  };
  cyclePayTypeRef.current = () => {
    const i = PAY_TYPES.indexOf(payType);
    updateActive({ payType: PAY_TYPES[(i + 1) % PAY_TYPES.length] });
  };

  const alertText = error
    ? error === 'sale_tabs_at_cap'
      ? t('saleTabsAtCap').replace('{n}', String(MAX_OPEN_SALES))
      : error === 'insufficient_stock' && shortageText
        ? t('sellShortage').replace('{items}', shortageText)
        : translateError(t, error)
    : null;

  // The bill pane scrolls; bring a new error into view (e.g. after Cash received).
  const alertRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (alertText) alertRef.current?.scrollIntoView({ block: 'nearest' });
  }, [alertText]);

  const partyModalAlert = partyModalError
    ? translateError(t, partyModalError)
    : null;

  if (done && viewReceipt) {
    return (
      <ReceiptView
        fields={receiptFieldsFromDone(done)}
        onBack={() => {
          setViewReceipt(false);
          setDone(null);
        }}
        onNewSale={newSale}
        receiptWidthMm={receiptWidthMm}
        printerName={receiptPrinterName}
      />
    );
  }

  function renderBalanceTag(party: Party) {
    if (party.balance_paisa > 0) {
      return (
        <span className="pos-udhaar-tag" data-previous-udhaar>
          <NavIcon name="khata" className="pos-icon pos-icon--sm" />
          <span>{withAmount(t('previousUdhaar'), party.balance_paisa)}</span>
        </span>
      );
    }
    if (party.balance_paisa < 0) {
      return (
        <span className="pos-advance-tag" data-advance>
          {withAmount(t('advanceCredit'), -party.balance_paisa)}
        </span>
      );
    }
    return null;
  }

  /** Put an amount into a translated sentence; only the amount is LTR-isolated (RTL safe). */
  function withAmount(template: string, paisa: number) {
    const [before, after = ''] = template.split('{amount}');
    return (
      <>
        {before}
        <span className="ltr-isolate">{formatRs(paisa)}</span>
        {after}
      </>
    );
  }

  function unitPriceLine(unitLabel: string, pricePaisa: number) {
    return (
      <>
        {t(productUnitKey(unitLabel))}
        {' · '}
        <span className="ltr-isolate">{formatRs(pricePaisa)}</span>
      </>
    );
  }

  function renderPaymentStatus() {
    if (cashInvalid) return null;
    if (changePaisa > 0) {
      return (
        <div className="pos-pay-status" data-change-area>
          {keepSurplus ? (
            <p className="pos-khata-line pos-khata-line--credit" data-surplus-confirm>
              <span>{withAmount(t('surplusStaysOnKhata'), changePaisa)}</span>
            </p>
          ) : (
            <p className="pos-change-big" data-change>
              <span>{withAmount(t('returnChangeBig'), changePaisa)}</span>
            </p>
          )}
          {/* Named customer only: Return change (default) | Keep on khata. Walk-in = change only. */}
          {hasParty ? (
            <div className="pos-surplus-choice" data-surplus-choice>
              <p className="pos-surplus-choice__hint muted">{t('surplusChoiceHint')}</p>
              <div className="pos-surplus-seg" role="group" aria-label={t('surplusChoiceHint')}>
                {([false, true] as const).map((keep) => (
                  <button
                    key={keep ? 'keep' : 'return'}
                    type="button"
                    className={`pos-surplus-seg__btn${keepSurplusOnKhata === keep ? ' is-active' : ''}`}
                    aria-pressed={keepSurplusOnKhata === keep}
                    disabled={busy}
                    data-surplus-option={keep ? 'keep' : 'return'}
                    onClick={() => {
                      setKeepSurplusOnKhata(keep);
                      cashTenderedRef.current?.focus();
                    }}
                  >
                    {keep ? t('keepAsKhataCredit') : t('returnChange')}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      );
    }
    if (shortPaisa > 0) {
      return hasParty ? (
        <p className="pos-khata-line" data-remainder>
          <NavIcon name="khata" className="pos-icon" />
          <span>{withAmount(t('remainderToKhata'), shortPaisa)}</span>
        </p>
      ) : (
        <p className="pos-short-line" data-short>
          <NavIcon name="warning" className="pos-icon" />
          <span>{withAmount(t('walkInShort'), shortPaisa)}</span>
        </p>
      );
    }
    return (
      <p className="pos-exact-line" data-exact-cash>
        <span className="chip chip--method-cash">{t('exactCash')}</span>
      </p>
    );
  }

  function renderCheckout() {
    return (
      <div
        className="pos-inline-checkout"
        data-pay-sheet
        data-inline-checkout
      >
        <div className="pos-checkout-head">
          <p className="pos-amount pos-pay-bar__total">
            {t('cartTotal')}:{' '}
            <span className="ltr-isolate">{formatRs(totalPaisa)}</span>
          </p>
          {editInfo ? (
            <p className="pos-edit-paid" data-edit-paid>
              <span className="muted">{t('posAlreadyPaid')}</span>{' '}
              <span className="ltr-isolate">{formatRs(alreadyPaidPaisa)}</span>
              {' · '}
              {editGiveBackPaisa > 0 ? (
                <>
                  <span className="muted">{t('posEditGiveBack')}</span>{' '}
                  <strong className="ltr-isolate">{formatRs(editGiveBackPaisa)}</strong>
                </>
              ) : (
                <>
                  <span className="muted">{t('posEditToCollect')}</span>{' '}
                  <strong className="ltr-isolate">{formatRs(payTotalPaisa)}</strong>
                </>
              )}
            </p>
          ) : null}
          <p className="pos-checkout-customer" data-checkout-customer>
            {selectedParty ? selectedParty.name : t('walkInDefault')}
          </p>
          <button
            type="button"
            className="btn btn--ghost pos-checkout-back"
            disabled={busy}
            onClick={closePay}
          >
            {t('back')}
            <kbd className="pos-kbd pos-kbd--muted">Esc</kbd>
          </button>
        </div>

        <div className="pos-bill-extras" data-bill-extras>
          <div className="pos-paytype" role="group" aria-label={t('payType')}>
            {PAY_TYPES.map((pt) => (
              <button
                key={pt}
                type="button"
                className={`chip${payType === pt ? ' is-active' : ''}`}
                aria-pressed={payType === pt}
                disabled={busy}
                data-pay-type={pt}
                onClick={() => updateActive({ payType: pt })}
              >
                {pt === 'cash' ? t('payTypeCash') : DIGITAL_LABEL[pt]}
              </button>
            ))}
            <kbd className="pos-kbd pos-kbd--muted">F6</kbd>
            {payType !== 'cash' ? (
              <input
                className="input pos-payref"
                placeholder={t('payRef')}
                value={payRef}
                maxLength={60}
                disabled={busy}
                data-pay-ref
                onChange={(e) => updateActive({ payRef: e.target.value })}
              />
            ) : null}
          </div>
          <div className="pos-billdisc">
            <label htmlFor="bill-disc">{t('billDiscount')}</label>
            <span className="pos-billdisc__kind" role="group">
              {(['amount', 'percent'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`chip${(billDisc?.kind ?? 'amount') === k ? ' is-active' : ''}`}
                  disabled={busy}
                  onClick={() => updateActive({ disc: { kind: k, value: billDisc?.value ?? 0 } })}
                >
                  {k === 'amount' ? 'Rs' : '%'}
                </button>
              ))}
            </span>
            <input
              id="bill-disc"
              className="input pos-billdisc__input ltr-isolate"
              inputMode="decimal"
              placeholder="0"
              disabled={busy}
              data-bill-discount
              value={billDisc && billDisc.value > 0 ? String(billDisc.value) : ''}
              onChange={(e) => {
                const v = Number(e.target.value.replace(/[^\d.]/g, ''));
                updateActive({
                  disc: { kind: billDisc?.kind ?? 'amount', value: Number.isFinite(v) ? Math.min(v, (billDisc?.kind ?? 'amount') === 'percent' ? 100 : 1e7) : 0 },
                });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  cashTenderedRef.current?.focus();
                }
              }}
            />
            <kbd className="pos-kbd pos-kbd--muted">F7</kbd>
          </div>
          {discountPaisa > 0 || roundingPaisa !== 0 ? (
            <p className="pos-billsum muted ltr-isolate" data-bill-sum>
              {formatRs(subtotalPaisa)}
              {discountPaisa > 0 ? ` − ${formatRs(discountPaisa)}` : ''}
              {roundingPaisa !== 0 ? ` ${roundingPaisa > 0 ? '+' : '−'} ${formatRs(Math.abs(roundingPaisa))} ${t('billRounding').toLowerCase()}` : ''}
            </p>
          ) : null}
          {loyaltyOn ? (
            <div className="pos-billdisc" data-loyalty>
              <label htmlFor="bill-points">
                {t('loyaltyPoints')} <span className="muted ltr-isolate">{partyPoints}</span>
              </label>
              <input
                id="bill-points"
                className="input pos-billdisc__input ltr-isolate"
                inputMode="numeric"
                placeholder="0"
                disabled={busy || partyPoints <= 0}
                data-loyalty-input
                value={activeSale.points ? String(activeSale.points) : ''}
                onChange={(e) => {
                  const v = Math.floor(Number(e.target.value.replace(/\D/g, '')) || 0);
                  updateActive({ points: Math.min(v, partyPoints) });
                }}
              />
              <button
                type="button"
                className="chip"
                disabled={busy || partyPoints <= 0}
                data-loyalty-all
                onClick={() => updateActive({ points: partyPoints })}
              >
                {t('loyaltyUseAll')}
              </button>
              {redeemPaisa > 0 ? <span className="muted ltr-isolate">−{formatRs(redeemPaisa)}</span> : null}
            </div>
          ) : null}
          {discountOverLimit ? (
            <p className="pos-short-line" role="alert" data-disc-over>
              <NavIcon name="warning" className="pos-icon" />
              <span>
                {t('discountOverLimit').replace('{max}', String(rules.cashier_discount_max_bp / 100))}
              </span>
            </p>
          ) : null}
        </div>

        <div className="field pos-checkout-field">
          <label htmlFor="cash-tendered">{payType === 'cash' ? t('cashTendered') : `${DIGITAL_LABEL[payType]} ${t('payReceived')}`}</label>
          <MoneyInput
            id="cash-tendered"
            ref={cashTenderedRef}
            className="pos-cash-input"
            value={cashTenderedRs}
            onValueChange={onCashChange}
            placeholder={rupeesPlain(payTotalPaisa)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              void completePay(e.ctrlKey || e.metaKey ? 'khata' : 'cash');
            }}
          />
        </div>

        <div className="pos-note-keys" role="group" aria-label={t('noteKeys')}>
          {/* Two tidy rows when khata is possible: [Rs 0 · partials · Exact] then [higher notes]. */}
          {(hasParty
            ? [
                cashSuggestions.filter((x) => x.kind !== 'above'),
                cashSuggestions.filter((x) => x.kind === 'above'),
              ]
            : [cashSuggestions]
          )
            .filter((row) => row.length > 0)
            .map((row, i) => (
              <div key={i} className="pos-note-keys__row">
                {row.map((sug) => (
                  <button
                    key={`${sug.kind}-${sug.paisa}`}
                    type="button"
                    className={`pos-note-key pos-note-key--${sug.kind}${
                      sug.kind === 'exact' ? '' : ' ltr-isolate'
                    }`}
                    onClick={() => tapSuggestion(sug.paisa)}
                    disabled={busy}
                    data-note={sug.kind === 'exact' ? 'exact' : rupeesPlain(sug.paisa)}
                    data-note-kind={sug.kind}
                  >
                    {sug.kind === 'exact' ? t('noteExact') : formatRs(sug.paisa)}
                  </button>
                ))}
              </div>
            ))}
        </div>

        {renderPaymentStatus()}

        {alertText && error !== 'credit_limit_exceeded' ? (
          <p className="pos-alert" role="alert" ref={alertRef}>
            {alertText}
          </p>
        ) : null}

        <div className="pos-pay-actions">
          <button
            type="button"
            className="pos-pay-btn pos-pay-btn--cash"
            disabled={!canPayCash}
            onClick={() => void completePay('cash')}
            data-complete-pay
            data-pay-cash
          >
            <NavIcon name="cash" className="pos-icon pos-icon--lg" />
            <span className="pos-pay-btn__text">
              <span className="pos-pay-btn__label">
                {busy ? t('loading') : t('payCashReceived')}
              </span>
              <span className="pos-pay-btn__sub">
                <kbd className="pos-kbd">Enter</kbd>
              </span>
            </span>
          </button>
          <button
            type="button"
            className="pos-pay-btn pos-pay-btn--khata"
            disabled={!canPayKhata}
            onClick={() => void completePay('khata')}
            data-pay-khata
            title={hasParty ? undefined : t('pickCustomerHint')}
          >
            <NavIcon name="khata" className="pos-icon pos-icon--lg" />
            <span className="pos-pay-btn__text">
              <span className="pos-pay-btn__label">{t('payAddToKhata')}</span>
              <span className="pos-pay-btn__sub">
                {hasParty ? (
                  khataUnpaidPaisa > 0 ? (
                    <span className="ltr-isolate">{formatRs(khataUnpaidPaisa)}</span>
                  ) : null
                ) : (
                  <span className="pos-pay-btn__hint" data-pick-customer-hint>
                    {t('pickCustomerHint')}
                  </span>
                )}
                <kbd className="pos-kbd">F8</kbd>
              </span>
            </span>
          </button>
        </div>

      </div>
    );
  }

  const priceLine = priceFor ? cart.find((l) => l.key === priceFor) ?? null : null;
  const priceNew = rsToPaisa(priceText);

  return (
    <>
    {priceLine ? (
      <ConfirmModal
        title={`${t('posOverrideTitle')} · ${priceLine.name}`}
        message={t('posOverrideWas').replace('{rs}', formatRs(priceLine.overrideFrom ?? priceLine.unitPricePaisa))}
        tone="primary"
        confirmLabel={t('save')}
        cancelLabel={t('cancel')}
        confirmDisabled={priceNew == null}
        onConfirm={savePrice}
        onCancel={() => {
          setPriceFor(null);
          requestAnimationFrame(() => searchRef.current?.focus());
        }}
      >
        <form
          data-price-override-form
          onSubmit={(e) => {
            e.preventDefault();
            savePrice();
          }}
        >
          <div className="field">
            <label htmlFor="pos-override">{t('posOverridePrice')}</label>
            <MoneyInput id="pos-override" value={priceText} onValueChange={setPriceText} autoFocus />
          </div>
          <button type="submit" hidden />
        </form>
      </ConfirmModal>
    ) : null}
    {priceAsk ? (
      <ManagerApproval
        action="price_override"
        onCancel={() => setPriceAsk(false)}
        onApproved={(tok) => {
          setPriceAsk(false);
          priceApprovalRef.current = tok;
          void completePay(lastPayKindRef.current);
        }}
      />
    ) : null}
    <div className="card pos-card">
      <PageHeader title={<>{t('sell')}<UrHint k="sell" /></>} subtitle={displayName} />

      {renderSaleTabs()}

      {saleFlash ? (
        <p
          className={`pos-sale-flash${saleFlash.kind === 'err' ? ' pos-sale-flash--err' : ''}`}
          role="status"
          aria-live="polite"
          data-sale-flash={saleFlash.kind}
        >
          {saleFlash.msg}
        </p>
      ) : null}

      {catalogSoftWarn ? (
        <p className="pos-banner-warn" role="status">
          {t('catalogUnavailable')}
        </p>
      ) : null}

      <section
        className="pos-customer-bar pos-customer-strip"
        aria-label={t('sellCustomerBar')}
        data-sell-customer-bar
      >
        <div className="pos-customer-bar__row">
          <div
            className="pos-customer-bar__chips"
            role="group"
            aria-label={t('sellCustomerBar')}
          >
            <button
              type="button"
              className={`chip pos-customer-bar__chip${partyId ? '' : ' is-active'}`}
              aria-pressed={!partyId}
              disabled={busy}
              onClick={selectWalkIn}
            >
              {t('walkInDefault')}
            </button>
            {selectedParty ? (
              <>
                <span
                  className="chip pos-customer-bar__chip is-active"
                  data-customer-selected
                >
                  <span className="pos-customer-bar__chip-name">
                    {selectedParty.name}
                  </span>
                  {selectedParty.phone ? (
                    <span className="muted ltr-isolate pos-customer-bar__chip-phone">
                      {selectedParty.phone}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="pos-customer-bar__chip-x"
                    disabled={busy}
                    onClick={selectWalkIn}
                    aria-label={t('clearCustomer')}
                    title={t('clearCustomer')}
                  >
                    <NavIcon name="close" className="pos-icon pos-icon--sm" />
                  </button>
                </span>
                {renderBalanceTag(selectedParty)}
              </>
            ) : null}
          </div>
          <div className="field pos-customer-bar__search">
            <label htmlFor="pos-customer-search" className="visually-hidden">
              {t('searchCustomersSell')}
            </label>
            <input
              id="pos-customer-search"
              type="search"
              className="pos-customer-bar__input"
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
              onKeyDown={onCustomerSearchKeyDown}
              placeholder={t('searchCustomersSell')}
              autoComplete="off"
              disabled={busy}
              aria-autocomplete="list"
              aria-controls="pos-customer-results"
            />
            {filteredParties.length > 0 ? (
              <ul
                id="pos-customer-results"
                className="pos-customer-bar__results"
                role="listbox"
                aria-label={t('searchCustomersSell')}
              >
                {filteredParties.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={p.id === customerPickId}
                      className={`pos-customer-bar__result${
                        p.id === customerPickId ? ' is-active' : ''
                      }`}
                      onClick={() => selectCustomer(p.id)}
                    >
                      <strong>{p.name}</strong>
                      {p.phone ? (
                        <span className="muted ltr-isolate">{p.phone}</span>
                      ) : null}
                      {p.balance_paisa > 0 ? (
                        <span className="pos-customer-bar__result-due">
                          {withAmount(t('previousUdhaar'), p.balance_paisa)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : customerQuery.trim() ? (
              <p className="pos-customer-bar__empty muted">
                {t('partiesNoMatches')}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={openPartyModal}
          >
            {t('newCustomerSell')}
          </button>
        </div>
      </section>

      <div className="pos-sell">
        <section className="pos-pane" aria-label={t('productList')}>
          {items.length === 0 ? (
            <EmptyState
              className="pos-empty"
              title={
                role === 'cashier'
                  ? t('emptyStateCatalogCashierTitle')
                  : t('emptyStateCatalogTitle')
              }
              description={
                role === 'cashier'
                  ? t('emptyStateCatalogCashierDesc')
                  : t('emptyStateCatalogDesc')
              }
              action={
                role === 'owner' && onAddProduct ? (
                  <button
                    type="button"
                    className="btn btn--teal"
                    onClick={() => onAddProduct()}
                  >
                    {t('addProduct')}
                  </button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="pos-find">
                <label htmlFor="pos-search" className="visually-hidden">
                  {t('sellSearchPlaceholder')}
                </label>
                <NavIcon name="scan" className="pos-icon pos-find__icon" />
                <input
                  id="pos-search"
                  ref={searchRef}
                  className="pos-find__input"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder={t('sellSearchPlaceholder')}
                  autoComplete="off"
                  autoFocus
                  spellCheck={false}
                  disabled={busy}
                  aria-controls="pos-pick-list"
                  aria-activedescendant={
                    pickId ? `pos-pick-${pickId}` : undefined
                  }
                  data-sell-search
                />
              </div>

              {filteredItems.length === 0 ? (
                <p className="pos-empty">{t('sellNoItemMatch')}</p>
              ) : (
                <ul
                  id="pos-pick-list"
                  ref={pickListRef}
                  className="pos-pick-list"
                  role="listbox"
                  aria-label={t('productList')}
                >
                  {filteredItems.map((p) => {
                    const soft = p.qty_on_hand <= 0;
                    const isSel = p.id === pickId;
                    const onSale = discountStatusOf(p, now) === 'active';
                    const tillPrice = currentPricePaisa(p, now);
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          id={`pos-pick-${p.id}`}
                          data-product-id={p.id}
                          role="option"
                          aria-selected={isSel}
                          tabIndex={-1}
                          className={`pos-pick-row${isSel ? ' is-selected' : ''}`}
                          onClick={() => {
                            setPickId(p.id);
                            addOnePiece(p);
                            focusSearch();
                          }}
                        >
                          <ProductThumb name={p.name} imageFile={p.image_file} />
                          <span className="pos-pick-row__main">
                            <strong className="pos-pick-row__name">
                              {p.name}
                              {p.product_type === 'bulk' ? <TypeTag type="bulk" /> : null}
                            </strong>
                            <span className="pos-pick-row__sub">
                              {unitPriceLine(p.unit_label, tillPrice)}
                              {onSale ? (
                                <>
                                  {' '}
                                  <span className="chip chip--success pos-sale-chip">
                                    {t('discountBadge')}
                                  </span>
                                </>
                              ) : null}
                              {onSale && tillPrice !== p.price_paisa ? (
                                <>
                                  {' '}
                                  <s className="ltr-isolate pos-price-was">
                                    <span className="visually-hidden">{t('discountNormalPrice')}: </span>
                                    {formatRs(p.price_paisa)}
                                  </s>
                                </>
                              ) : null}
                            </span>
                          </span>
                          <span className="pos-pick-row__stock">
                            {soft ? (
                              <span className="chip chip--warn">{t('softStock')}</span>
                            ) : (
                              <span className="ltr-isolate muted" title={t('estStock')}>
                                <NavIcon name="stock" className="pos-icon pos-icon--sm" />
                                {p.qty_on_hand}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>

        <section className="pos-pane pos-pane--cart" aria-label={t('cart')}>
          <h3 className="pos-bill-title">
            <NavIcon name="receipt" className="pos-icon" />
            {t('cart')}
          </h3>
          {cart.length === 0 ? (
            <p className="pos-empty">{t('cartEmpty')}</p>
          ) : (
            <ul
              className={`pos-cart-list${payOpen ? ' pos-cart-list--paying' : ''}`}
            >
              {cart.map((l) => {
                const unitWord = t(productUnitKey(l.unitLabel));
                const loose = allowsFraction(l.unitLabel);
                return (
                  <li
                    key={l.key}
                    className={`pos-cart-line${l.key === activeLineKey ? ' is-active' : ''}`}
                    data-bill-row={l.productId}
                    data-bill-row-key={l.key}
                  >
                    <ProductThumb name={l.name} imageFile={l.imageFile} className="initial-badge--sm" />
                    <span className="pos-cart-line__main">
                      <span className="pos-cart-line__name">{l.name}</span>
                      
                      <span className="pos-cart-line__sub">
                        {unitPriceLine(l.unitLabel, l.unitPricePaisa)}
                        {l.overrideFrom != null ? (
                          <>
                            {' '}
                            <span className="chip chip--warn pos-sale-chip" data-price-override>
                              {t('posOverrideKey')}
                            </span>{' '}
                            <s className="ltr-isolate pos-price-was">{formatRs(l.overrideFrom)}</s>
                          </>
                        ) : l.unitPricePaisa < l.normalPricePaisa ? (
                          <>
                            {' '}
                            <span className="chip chip--success pos-sale-chip">
                              {t('discountBadge')}
                            </span>{' '}
                            <s className="ltr-isolate pos-price-was">
                              <span className="visually-hidden">{t('discountNormalPrice')}: </span>
                              {formatRs(l.normalPricePaisa)}
                            </s>
                          </>
                        ) : null}
                      </span>
                      {loose ? (
                        <span className="pos-loose" data-loose-quick>
                          {scaleOn && productUnit(l.unitLabel) === 'kg' ? (
                            <button
                              type="button"
                              className="pos-loose__btn pos-loose__btn--scale"
                              disabled={busy || scaleBusy}
                              data-scale-read
                              title="F9"
                              onClick={() => void readScaleInto(l.key)}
                            >
                              {scaleBusy ? t('scaleReading') : t('scaleRead')}
                            </button>
                          ) : null}
                          {quickWeights(l.unitLabel).map(([q, label]) => (
                            <button
                              key={label}
                              type="button"
                              className={`pos-loose__btn${l.qty === q ? ' is-on' : ''}`}
                              disabled={busy}
                              onClick={() => {
                                setLineQty(l.key, q);
                                focusSearch();
                              }}
                              data-quick-weight={q}
                            >
                              {label}
                            </button>
                          ))}
                          <label className="pos-loose__rs">
                            <span>Rs</span>
                            <input
                              data-rs-input
                              inputMode="decimal"
                              placeholder={t('qtyRsWorth')}
                              disabled={busy || l.unitPricePaisa <= 0}
                              aria-label={`${t('qtyRsWorth')} — ${l.name}`}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  e.currentTarget.value = '';
                                  focusSearch();
                                  return;
                                }
                                if (e.key !== 'Enter') return;
                                e.preventDefault();
                                const rs = Number(e.currentTarget.value.trim());
                                if (Number.isFinite(rs) && rs > 0 && l.unitPricePaisa > 0) {
                                  const q = r3((rs * 100) / l.unitPricePaisa);
                                  if (q > 0) setLineQty(l.key, q);
                                }
                                e.currentTarget.value = '';
                                focusSearch();
                              }}
                            />
                          </label>
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="pos-qty"
                      role="group"
                      aria-label={`${l.name}: ${l.qty} ${unitWord}`}
                    >
                      <button
                        type="button"
                        className="pos-qty__btn"
                        onClick={() => changeQty(l.key, -1)}
                        disabled={busy || (loose ? l.qty <= 0.25 : l.qty <= 1)}
                        aria-label={`${t('qtyDecrease')} — ${l.name}`}
                        title={t('qtyDecrease')}
                        data-qty-minus
                      >
                        <NavIcon name="minus" className="pos-icon" />
                      </button>
                      {loose ? (
                        <input
                          key={`q-${l.qty}`}
                          className="pos-qty__input ltr-isolate"
                          data-qty
                          data-qty-input
                          inputMode="decimal"
                          defaultValue={formatQty(l.qty)}
                          disabled={busy}
                          aria-label={`${t('qtyWeight')} — ${l.name}`}
                          onFocus={(e) => e.currentTarget.select()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'Escape') {
                              e.preventDefault();
                              if (e.key === 'Enter') {
                                const q = parseQtyInput(e.currentTarget.value, l.unitLabel);
                                if (q != null) setLineQty(l.key, q);
                              }
                              focusSearch();
                            }
                          }}
                          onBlur={(e) => {
                            const q = parseQtyInput(e.currentTarget.value, l.unitLabel);
                            if (q != null && q !== l.qty) setLineQty(l.key, q);
                            else e.currentTarget.value = formatQty(l.qty);
                          }}
                        />
                      ) : (
                        <span className="pos-qty__value ltr-isolate" data-qty>
                          {l.qty}
                        </span>
                      )}
                      <button
                        type="button"
                        className="pos-qty__btn"
                        onClick={() => changeQty(l.key, 1)}
                        disabled={busy}
                        aria-label={`${t('qtyIncrease')} — ${l.name}`}
                        title={t('qtyIncrease')}
                        data-qty-plus
                      >
                        <NavIcon name="plus" className="pos-icon" />
                      </button>
                    </span>
                    <strong className="pos-cart-line__total ltr-isolate">
                      {formatRs(lineTotal(l))}
                    </strong>
                    <button
                      type="button"
                      className="pos-cart-line__remove"
                      onClick={() => removeLine(l.key)}
                      disabled={busy}
                      aria-label={`${t('removeLine')} — ${l.name}`}
                      title={t('removeLine')}
                      data-remove-line
                    >
                      <NavIcon name="close" className="pos-icon pos-icon--sm" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {alertText && (!payOpen || error === 'credit_limit_exceeded') ? (
            <p className="pos-alert" role="alert">
              {alertText}
              {error === 'credit_limit_exceeded' && (role === 'owner' || role === 'manager') ? (
                <button
                  type="button"
                  className="btn btn--ghost pos-alert__btn"
                  data-credit-override
                  disabled={busy}
                  onClick={() => {
                    overrideCreditRef.current = true;
                    void completePay(lastPayKindRef.current);
                  }}
                >
                  {t('creditAllowOnce')}
                </button>
              ) : null}
            </p>
          ) : null}
          {creditNote ? (
            <p className="pos-banner-warn" role="status" data-credit-warn>
              {creditNote}
            </p>
          ) : null}

          {stockShortage ? (
            role === 'owner' && onReceiveStock ? (
              <div className="nav-row" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn--teal"
                  onClick={() => onReceiveStock(shortageProductId ?? undefined)}
                >
                  {t('goReceiveStock')}
                </button>
              </div>
            ) : role === 'cashier' ? (
              <p className="muted" style={{ marginTop: 8 }}>
                {t('askOwnerReceive')}
              </p>
            ) : null
          ) : null}

          {readOnly ? (
            <div className="pos-ro-lock" data-readonly-lock>
              <span>Read-only · activate to sell</span>
              <button type="button" className="btn btn--teal" onClick={openActivation}>Activate</button>
            </div>
          ) : payOpen ? (
            renderCheckout()
          ) : (
            <div className="pos-pay-bar">
              <p className="pos-amount pos-pay-bar__total">
                {t('cartTotal')}:{' '}
                <span className="ltr-isolate">{formatRs(totalPaisa)}</span>
              </p>
              <div className="pos-pay-bar__actions">
                <button
                  type="button"
                  className="btn btn--teal pos-pay-bar__go"
                  disabled={busy || cart.length === 0}
                  onClick={openPay}
                  data-open-pay
                >
                  {t('paySheet')}
                  <kbd className="pos-kbd">Enter</kbd>
                </button>
                {onBack ? (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={onBack}
                  >
                    {t('cashierToday')}
                  </button>
                ) : null}
                {onLogout ? (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={onLogout}
                  >
                    {t('signOut')}
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
    {partyModalOpen ? (
      <div className="pos-modal-backdrop" onClick={closePartyModal}>
        <form
          className="pos-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-party-title"
          data-new-party-modal
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => void saveNewParty(e)}
        >
          <h3 id="new-party-title">{t('createParty')}</h3>
          <div className="field">
            <label htmlFor="new-party-name">{t('partyName')}</label>
            <input
              id="new-party-name"
              ref={partyNameRef}
              value={newPartyName}
              onChange={(e) => setNewPartyName(e.target.value)}
              required
              maxLength={120}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="new-party-phone">{t('partyPhone')}</label>
            <input
              id="new-party-phone"
              className="ltr-isolate"
              value={newPartyPhone}
              onChange={(e) => setNewPartyPhone(e.target.value)}
              inputMode="tel"
              maxLength={32}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="new-party-address">{t('partyAddress')}</label>
            <input
              id="new-party-address"
              value={newPartyAddress}
              onChange={(e) => setNewPartyAddress(e.target.value)}
              maxLength={240}
              autoComplete="street-address"
              dir="auto"
            />
          </div>
          {partyModalAlert ? (
            <p className="pos-alert" role="alert">
              {partyModalAlert}
            </p>
          ) : null}
          <div className="pos-modal__actions">
            <button
              type="submit"
              className="btn btn--teal"
              disabled={partySaving || !newPartyName.trim()}
            >
              {partySaving ? t('loading') : t('createParty')}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={partySaving}
              onClick={closePartyModal}
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      </div>
    ) : null}
    {renderDiscardModal()}
    </>
  );
}
