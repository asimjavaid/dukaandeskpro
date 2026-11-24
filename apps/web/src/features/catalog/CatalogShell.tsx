import { usePricing } from '../purchases/pricing';
import { PageHeader } from '../shared/PageHeader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { UrHint, translateError, useI18n } from '../../i18n';
import { EmptyState } from '../shared/EmptyState';
import { Pager } from '../shared/Pager';
import {
  PRODUCT_UNITS,
  productUnit,
  productUnitKey,
  type ProductUnit,
} from '../shared/productUnits';
import { apiGet, apiPostRaw, apiPatchRaw, apiDelete } from '../../lib/api';
import { ProductThumb, resizeImageFile } from '../shared/ProductThumb';
import { parseMoneyRs } from '../shared/amount';
import {
  currentPricePaisa,
  discountStatusOf,
  formatStoreDateTime,
  salePricePaisa,
  type ProductDiscountFields,
} from '../shared/discount';
import {
  DiscountFields,
  EMPTY_DISCOUNT,
  checkDiscountDraft,
  discountPayload,
  draftFromProduct,
  type DiscountDraft,
} from './DiscountFields';
import { StickerPrint } from './StickerPrint';
import { stockLevel } from '../shared/stock';
import { MoneyInput } from '../shared/MoneyInput';
import { formatRsShort } from '../../lib/money';
import { ImportModal } from './ImportModal';
import { PriceHistoryModal } from './PriceHistoryModal';
import { ProductPacksPanel } from './ProductPacksPanel';
import { ConfirmModal } from '../shared/ConfirmModal';
import { TypeTag, type ProductType } from '../shared/TypeTag';
import { BuyFields, buyPayload, type BuyDraft } from './BuyFields';
import { ExtraBarcodes } from './ExtraBarcodes';
import { defaultMeasure } from '../purchases/measures';

/** "Lays Rs 30" priced Rs 30 → "Rs 30". */
function printedHint(name: string, pricePaisa: number | null): string | null {
  const m = /\bRs\.?\s*(\d+)\b/i.exec(name);
  if (!m || pricePaisa == null) return null;
  return Number(m[1]) * 100 === pricePaisa ? `Rs ${m[1]}` : null;
}

type Product = ProductDiscountFields & {
  id: string;
  name: string;
  name_ur: string | null;
  unit_label: string;
  price_paisa: number;
  qty_on_hand: number;
  barcode?: string | null;
  extra_barcodes?: string[];
  image_file?: string | null;
  size_group_id?: string | null;
  size_qty?: number | null;
  last_unit_cost_paisa?: number | null;
  reorder_level?: number | null;
  fixed_price?: number;
  markup_bp?: number | null;
  product_type?: ProductType;
  buy_unit?: string | null;
  buy_measure?: string | null;
  repack_from_id?: string | null;
};

type PanelMode = 'none' | 'edit' | 'add';

type Props = {
  displayName: string;
  /** Open the Repack screen for this bulk item. */
  onRepack?: (bulkId: string) => void;
  /** Owner only: purchase cost and margin columns. */
  showCost?: boolean;
};

const PAGE_SIZE = 20;
const EMPTY_BUY: BuyDraft = { loose: false, measure: '', bulkId: '', packKg: '' };

const formatRs = formatRsShort;
/** Barcode stickers keep the printed 2-decimal format. */
function formatRsSticker(paisa: number): string {
  return `Rs ${(paisa / 100).toFixed(2)}`;
}

/** Price field text → paisa, or null when blank/invalid (shared sanitizer). */
function pricePaisaFrom(raw: string): number | null {
  if (raw.trim() === '') return null;
  const rs = parseMoneyRs(raw);
  return rs == null ? null : Math.round(rs * 100);
}


export function CatalogShell({ displayName, showCost = true, onRepack }: Props) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [panel, setPanel] = useState<PanelMode>('none');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [addedMsg, setAddedMsg] = useState<string | null>(null);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [labelSize, setLabelSize] = useState<'38x25' | '50x25' | '50x30' | '40x30'>('50x25');
  const [labelPerRow, setLabelPerRow] = useState(3);

  const [name, setName] = useState('');
  const [priceRs, setPriceRs] = useState('');
  const [barcode, setBarcode] = useState('');
  const [unit, setUnit] = useState<ProductUnit>('piece');
  const [editName, setEditName] = useState('');
  const pricingDefault = String(usePricing().default_markup_bp / 100);
  const [editPriceRs, setEditPriceRs] = useState('');
  const [editBarcode, setEditBarcode] = useState('');
  const [editExtra, setEditExtra] = useState<string[]>([]);
  const [addExtra, setAddExtra] = useState<string[]>([]);
  const [editUnit, setEditUnit] = useState<ProductUnit>('piece');
  const [editReorder, setEditReorder] = useState('');
  const [editFixed, setEditFixed] = useState(false);
  const [editMarkup, setEditMarkup] = useState('');
  const [editBuyD, setEditBuyD] = useState<BuyDraft>(EMPTY_BUY);
  const [addBuyD, setAddBuyD] = useState<BuyDraft>(EMPTY_BUY);
  const [bulkOptions, setBulkOptions] = useState<Array<{ id: string; name: string }>>([]);
  const loadBulks = (exceptId?: string) =>
    apiGet<{ bulks: Array<{ id: string; name: string }> }>('/product-types/review')
      .then((r) => setBulkOptions(r.bulks.filter((b) => b.id !== exceptId)))
      .catch(() => setBulkOptions([]));
  const [importOpen, setImportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [discount, setDiscount] = useState<DiscountDraft>(EMPTY_DISCOUNT);
  const [editDiscount, setEditDiscount] = useState<DiscountDraft>(EMPTY_DISCOUNT);
  /** Re-render once a minute so sale / scheduled tags follow the clock. */
  const [now, setNow] = useState(() => Date.now());

  const addNameRef = useRef<HTMLInputElement>(null);
  /** Add another size: product whose photo the new one copies. */
  const [sizeFrom, setSizeFrom] = useState<Product | null>(null);
  const [addSizeQty, setAddSizeQty] = useState('');
  type SizePlan = { id: string; name: string; size_qty: number; old_price_paisa: number; new_price_paisa: number };
  const [sizePlan, setSizePlan] = useState<SizePlan[] | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    const q = search.trim();
    if (q) params.set('q', q);
    const r = await apiGet<{ items: Product[]; total?: number }>(
      `/catalog/products?${params.toString()}`,
    );
    setItems(r.items);
    setTotal(r.total ?? r.items.length);
    setLoaded(true);
    setLoadFailed(false);
    return r.items;
  }, [page, search]);

  useEffect(() => {
    refresh().catch(() => {
      setLoadFailed(true);
      setError('catalog_unavailable');
    });
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const selected = items.find((p) => p.id === selectedId) ?? null;
  const when = (iso: string) => formatStoreDateTime(iso, locale);

  /** Add product uses the same side panel as Edit; opening it closes Edit. */
  function openAdd() {
    if (panel === 'add') {
      // Already open: keep what was typed, just bring focus back.
      addNameRef.current?.focus();
      return;
    }
    resetAddForm();
    void loadBulks();
    setSelectedId(null);
    setPanel('add');
    setAddedMsg(null);
    setError(null);
  }

  function selectRow(productId: string) {
    setSelectedId(productId);
    setAddedMsg(null);
  }

  useEffect(() => {
    apiGet<{
      store?: { label_size?: string; label_per_row?: number };
    }>('/settings/store')
      .then((res) => {
        const size = res.store?.label_size;
        if (
          size === '38x25' ||
          size === '50x25' ||
          size === '50x30' ||
          size === '40x30'
        ) {
          setLabelSize(size);
        }
        const per = Math.floor(Number(res.store?.label_per_row));
        if (per >= 1 && per <= 5) setLabelPerRow(per);
      })
      .catch(() => {
        /* stickers still open with 50x25 and 3 per row */
      });
  }, []);

  // Escape closes the Add or Edit side panel (not while saving).
  useEffect(() => {
    if (panel !== 'add' && panel !== 'edit') return;
    const closing = panel;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || busy || e.defaultPrevented) return;
      setPanel('none');
      setError(null);
      if (closing === 'add') window.setTimeout(() => addButtonRef.current?.focus(), 0);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, busy]);

  function closePanel() {
    const wasAdd = panel === 'add';
    setPanel('none');
    setError(null);
    if (wasAdd) window.setTimeout(() => addButtonRef.current?.focus(), 0);
  }

  function resetAddForm() {
    setSizeFrom(null);
    setAddSizeQty('');
    setName('');
    setPriceRs('');
    setBarcode('');
    setAddExtra([]);
    setUnit('piece');
    setAddBuyD(EMPTY_BUY);
    setDiscount(EMPTY_DISCOUNT);
  }

  function openEdit(productId?: string) {
    const id = productId ?? selectedId;
    const product = items.find((p) => p.id === id);
    if (!product) return;
    setSelectedId(product.id);
    setEditName(product.name);
    setEditPriceRs((product.price_paisa / 100).toFixed(2));
    setEditBarcode(product.barcode ?? '');
    setEditExtra(product.extra_barcodes ?? []);
    setEditUnit(productUnit(product.unit_label));
    setEditReorder(product.reorder_level != null ? String(product.reorder_level) : '');
    setEditFixed(product.fixed_price === 1);
    setEditMarkup(product.markup_bp != null ? String(product.markup_bp / 100) : '');
    setEditBuyD({
      loose: product.product_type === 'bulk',
      measure: defaultMeasure(product),
      bulkId: product.product_type === 'packed' ? product.repack_from_id ?? '' : '',
      packKg: product.product_type === 'packed' && product.size_qty ? String(product.size_qty) : '',
    });
    void loadBulks(product.id);
    setEditDiscount(draftFromProduct(product));
    setAddedMsg(null);
    setPanel('edit');
    setError(null);
  }

  function replaceItem(product: Product) {
    setItems((prev) => prev.map((p) => (p.id === product.id ? { ...p, ...product } : p)));
  }

  async function uploadPhoto(file: File) {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const image = await resizeImageFile(file);
      const res = await apiPostRaw<{ ok: true; product: Product } | { ok: false; error: string }>(
        `/catalog/products/${selectedId}/image`,
        { image },
      );
      if (!res.json || res.json.ok !== true) {
        setError(res.json && 'error' in res.json ? res.json.error : 'invalid_image');
        return;
      }
      replaceItem(res.json.product);
    } catch {
      setError('invalid_image');
    } finally {
      setBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }

  async function removePhoto() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiDelete<{ ok: true; product: Product }>(
        `/catalog/products/${selectedId}/image`,
      );
      replaceItem(r.product);
    } catch {
      setError('add_failed');
    } finally {
      setBusy(false);
    }
  }

  async function addProduct(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trimmed = name.trim();
      if (!trimmed) {
        setError('invalid_name');
        return;
      }
      const pricePaisa = pricePaisaFrom(priceRs);
      if (pricePaisa == null) {
        setError('invalid_price');
        return;
      }
      const discountErr = checkDiscountDraft(discount, pricePaisa).error;
      if (discountErr) {
        setError(discountErr);
        return;
      }
      const res = await apiPostRaw<
        | { ok: true; product: Product }
        | { ok: false; error: string }
      >('/catalog/products', {
        name: trimmed,
        pricePaisa,
        barcode: barcode.trim(),
        extraBarcodes: addExtra,
        unitLabel: unit,
        discount: discountPayload(discount),
        ...buyPayload(addBuyD, unit),
      });
      if (!res.json || res.json.ok !== true) {
        setError(res.json && 'error' in res.json ? res.json.error : 'add_failed');
        return;
      }
      const added = res.json.product;
      if (sizeFrom) {
        const q = Number(addSizeQty);
        if (q > 0) await apiPostRaw(`/catalog/products/${added.id}/size-link`, { withProductId: sizeFrom.id, qty: q }).catch(() => null);
      }
      if (sizeFrom?.image_file) {
        await apiPostRaw(`/catalog/products/${added.id}/image/copy`, { fromProductId: sizeFrom.id }).catch(() => null);
      }
      resetAddForm();
      const list = await refresh();
      setSelectedId(added.id);
      if (!list.some((p) => p.id === added.id)) {
        // Not on this page or outside the current search: show it by name.
        setSearch(added.name);
        setPage(1);
      }
      setAddedMsg(`${t('productAdded')}: ${added.name}`);
      setPanel('none');
    } catch {
      setError('add_failed');
    } finally {
      setBusy(false);
    }
  }

  function editInputs() {
    const trimmed = editName.trim();
    if (!trimmed) return { error: 'invalid_name' } as const;
    const pricePaisa = pricePaisaFrom(editPriceRs);
    if (pricePaisa == null) return { error: 'invalid_price' } as const;
    const discountErr = checkDiscountDraft(editDiscount, pricePaisa).error;
    if (discountErr) return { error: discountErr } as const;
    return { trimmed, pricePaisa } as const;
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const v = editInputs();
    if ('error' in v) {
      setError(v.error ?? 'add_failed');
      return;
    }
    await doSaveEdit(false);
  }

  async function doSaveEdit(updateSizes: boolean) {
    if (!selectedId || !selected) return;
    const v = editInputs();
    if ('error' in v) {
      setError(v.error ?? 'add_failed');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiPatchRaw<
        | { ok: true; product: Product }
        | { ok: false; error: string }
      >(`/catalog/products/${selectedId}`, {
        name: v.trimmed,
        pricePaisa: v.pricePaisa,
        barcode: editBarcode.trim(),
        extraBarcodes: editExtra,
        unitLabel: editUnit,
        discount: discountPayload(editDiscount),
        reorderLevel: editReorder.trim() === '' ? null : Number(editReorder),
        fixedPrice: editFixed,
        markupPct: editFixed || editMarkup.trim() === '' ? null : Number(editMarkup),
        ...buyPayload(editBuyD, editUnit),
        updateSizes,
      });
      if (!res.json || res.json.ok !== true) {
        setError(res.json && 'error' in res.json ? res.json.error : 'add_failed');
        return;
      }
      setSizePlan(null);
      await refresh();
      setSelectedId(res.json.product.id);
      setPanel('none');
    } catch {
      setError('add_failed');
    } finally {
      setBusy(false);
    }
  }

  const isEmptyCatalog = loaded && total === 0 && !search.trim();
  const isEmptySearch = loaded && total === 0 && !!search.trim();

  return (
    <div className={`card catalog${showCost ? "" : " dd-no-cost"}`}>
      <PageHeader title={<>{t('catalog')}<UrHint k="catalog" /></>} subtitle={displayName} />

      {loadFailed ? (
        <p className="catalog-banner-warn" role="status">
          {t('catalogUnavailable')}
        </p>
      ) : null}

      <div className="catalog__toolbar">
        <div className="catalog-search field">
          <label htmlFor="catalog-search" className="visually-hidden">
            {t('searchCatalog')}
          </label>
          <input
            id="catalog-search"
            className="catalog-search__input"
            type="search"
            placeholder={t('searchCatalog')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
              setAddedMsg(null);
            }}
            disabled={!loaded && !loadFailed}
          />
        </div>
        <div className="catalog__toolbar-actions">
          <button type="button" className="btn btn--ghost" onClick={() => setImportOpen(true)} data-import-open>
            {t('importTitle')}
          </button>
          <button
            ref={addButtonRef}
            type="button"
            className="btn btn--teal"
            onClick={openAdd}
            disabled={busy}
            aria-expanded={panel === 'add'}
            aria-controls={panel === 'add' ? 'catalog-add-panel' : undefined}
          >
            {t('addProduct')}
          </button>
        </div>
      </div>

      <div className={`catalog__body${panel === 'none' ? ' catalog__body--solo' : ''}`}>
        <section className="catalog__list-pane" aria-label={t('productList')}>
          {panel === 'none' && addedMsg ? (
            <p className="catalog-success catalog-added" role="status">
              {addedMsg}
            </p>
          ) : null}
          {panel === 'none' && selected ? (
            <div className="catalog-selection">
              <div className="catalog-selection__copy">
                <span
                  className="catalog-selection__name"
                  dir="auto"
                  title={selected.name}
                >
                  {selected.name}
                </span>
                <span className="muted ltr-isolate">
                  {t('onHand')}: {selected.qty_on_hand}
                </span>
                <SaleNote product={selected} now={now} when={when} />
              </div>
              <div className="catalog-selection__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => openEdit(selected.id)}
                >
                  {t('editProduct')}
                </button>
                <button
                  type="button"
                  className="btn btn--teal"
                  onClick={() => setStickerOpen(true)}
                >
                  {t('stickerPrint')}
                </button>
                {selected.product_type === 'bulk' && onRepack ? (
                  <button type="button" className="btn btn--ghost" onClick={() => onRepack(selected.id)} data-repack-shortcut>
                    {t('ptRepackBtn')}
                  </button>
                ) : null}
                <button type="button" className="btn btn--ghost" onClick={() => setHistoryOpen(true)} data-price-history-btn>
                  {t('priceHistory')}
                </button>
              </div>
            </div>
          ) : null}
          {!loaded && !loadFailed ? (
            <p className="muted catalog-empty" role="status">
              {t('loading')}
            </p>
          ) : isEmptyCatalog ? (
            <EmptyState
              className="catalog-empty"
              title={t('emptyStateCatalogTitle')}
              description={t('emptyStateCatalogDesc')}
              action={
                <button
                  type="button"
                  className="btn btn--teal"
                  onClick={openAdd}
                >
                  {t('addProduct')}
                </button>
              }
            />
          ) : isEmptySearch ? (
            <p className="muted catalog-empty" role="status">
              {t('catalogNoMatches')}
            </p>
          ) : items.length > 0 ? (
            <>
              <p className="catalog-table-count muted">
                {t('catalogShowing')
                  .replace('{from}', String((page - 1) * PAGE_SIZE + 1))
                  .replace('{to}', String((page - 1) * PAGE_SIZE + items.length))
                  .replace('{total}', String(total))}
              </p>
              <div className="catalog-table-wrap">
                <table className="catalog-table">
                  <caption className="visually-hidden">{t('productList')}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="catalog-table__col-product">
                        {t('catalogColProduct')}
                      </th>
                      <th scope="col">{t('unit')}</th>
                      <th scope="col" className="catalog-table__num">
                        {t('catalogColPrice')}
                      </th>
                      <th scope="col" className="catalog-table__num">
                        {t('catalogColStock')}
                      </th>
                      <th scope="col" className="catalog-table__num dd-cost">
                        {t('lastUnitCost')}
                      </th>
                      <th
                        scope="col"
                        className="catalog-table__num dd-cost"
                        title={t('catalogMarginHint')}
                      >
                        {t('catalogColMargin')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => {
                      const active = p.id === selectedId;
                      const stock = stockLevel(p.qty_on_hand);
                      const cost = p.last_unit_cost_paisa;
                      const sale = discountStatusOf(p, now);
                      // Margin follows what the till charges right now.
                      const selling = currentPricePaisa(p, now);
                      const margin = cost == null ? null : selling - cost;
                      const marginPct =
                        margin == null || selling <= 0
                          ? null
                          : Math.round((margin / selling) * 100);
                      return (
                        <tr
                          key={p.id}
                          className={active ? 'is-selected' : undefined}
                          onClick={() => selectRow(p.id)}
                        >
                          <td className="catalog-table__col-product">
                            <button
                              type="button"
                              className="catalog-table__select"
                              aria-pressed={active}
                              title={p.name}
                              onClick={() => selectRow(p.id)}
                            >
                              <ProductThumb name={p.name} imageFile={p.image_file} />
                              <span className="catalog-table__text">
                              <span className="catalog-table__name" dir="auto">
                                {p.name}
                                <TypeTag type={p.product_type} />
                              </span>
                              {p.barcode ? (
                                <span className="catalog-table__meta">
                                  {p.barcode ? (
                                    <span className="catalog-table__barcode ltr-isolate">
                                      <span className="visually-hidden">{t('barcode')}: </span>
                                      {p.barcode}
                                    </span>
                                  ) : null}
                                  {p.extra_barcodes?.length ? (
                                    <span className="muted ltr-isolate" data-extra-count>
                                      {' '}+{p.extra_barcodes.length}
                                    </span>
                                  ) : null}

                                </span>
                              ) : null}
                              </span>
                            </button>
                          </td>
                          <td>{t(productUnitKey(p.unit_label))}</td>
                          <td className="catalog-table__num catalog-table__price">
                            {sale === 'active' ? (
                              <span
                                className="catalog-price catalog-price--sale"
                                title={
                                  p.discount_end_at
                                    ? t('discountUntil').replace('{date}', when(p.discount_end_at))
                                    : t('discountUntilCleared')
                                }
                              >
                                <span className="catalog-price__now">
                                  <span className="catalog-badge catalog-badge--sale">
                                    {t('discountBadge')}
                                  </span>
                                  <span className="ltr-isolate">{formatRs(selling)}</span>
                                </span>
                                <s className="catalog-price__was ltr-isolate">
                                  <span className="visually-hidden">{t('discountNormalPrice')}: </span>
                                  {formatRs(p.price_paisa)}
                                </s>
                              </span>
                            ) : sale === 'scheduled' && p.discount_start_at ? (
                              <span className="catalog-price">
                                <span className="ltr-isolate">{formatRs(p.price_paisa)}</span>
                                <span className="catalog-price__note">
                                  {t('discountStartsOn').replace('{date}', when(p.discount_start_at))}
                                  {' · '}
                                  <span className="ltr-isolate">{formatRs(salePricePaisa(p))}</span>
                                </span>
                              </span>
                            ) : (
                              <span className="ltr-isolate">{formatRs(p.price_paisa)}</span>
                            )}
                          </td>
                          <td className="catalog-table__num">
                            <span className={`catalog-stock catalog-stock--${stock}`}>
                              {stock === 'out' ? (
                                <span className="catalog-badge catalog-badge--danger">
                                  {t('catalogStockOut')}
                                </span>
                              ) : stock === 'low' ? (
                                <span className="catalog-badge catalog-badge--warn">
                                  {t('catalogStockLow')}
                                </span>
                              ) : null}
                              <span className="catalog-stock__qty ltr-isolate">
                                {p.qty_on_hand}
                              </span>
                            </span>
                          </td>
                          <td className="catalog-table__num dd-cost">
                            {cost == null ? (
                              <span className="catalog-table__none" title={t('costUnknown')}>
                                <span aria-hidden="true">—</span>
                                <span className="visually-hidden">{t('costUnknown')}</span>
                              </span>
                            ) : (
                              <span className="ltr-isolate">{formatRs(cost)}</span>
                            )}
                          </td>
                          <td className="catalog-table__num dd-cost">
                            {margin == null ? (
                              <span className="catalog-table__none" title={t('costUnknown')}>
                                <span aria-hidden="true">—</span>
                                <span className="visually-hidden">{t('costUnknown')}</span>
                              </span>
                            ) : (
                              <span
                                className={`catalog-margin${margin < 0 ? ' catalog-margin--loss' : ''}`}
                              >
                                <span className="ltr-isolate">
                                  {margin < 0 ? '−' : ''}
                                  {formatRs(Math.abs(margin))}
                                </span>
                                {marginPct != null ? (
                                  <span className="catalog-margin__pct ltr-isolate">
                                    {marginPct < 0 ? '−' : ''}
                                    {Math.abs(marginPct)}%
                                  </span>
                                ) : null}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                disabled={busy}
                onPage={setPage}
              />
            </>
          ) : null}
        </section>

        {panel === 'edit' ? (
          <section
            key="edit"
            className="catalog__panel"
            aria-label={t('editProduct')}
          >
            <h3 className="catalog__panel-title">{t('editProduct')}</h3>
            <form className="catalog-form" onSubmit={saveEdit}>
              {selected ? (
                <div className="field">
                  <label>{t('productPhoto')}</label>
                  <div className="catalog-photo">
                    <ProductThumb
                      name={selected.name}
                      imageFile={selected.image_file}
                      className="product-thumb--lg"
                      preview={false}
                    />
                    <div className="catalog-photo__actions">
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadPhoto(f);
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={busy}
                        onClick={() => photoInputRef.current?.click()}
                      >
                        {selected.image_file ? t('changePhoto') : t('addPhoto')}
                      </button>
                      {selected.image_file ? (
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={busy}
                          onClick={() => void removePhoto()}
                        >
                          {t('removePhoto')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="field">
                <label htmlFor="edit-name">{t('productNameEn')}</label>
                <input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="field">
                <label htmlFor="edit-unit">{t('unit')}</label>
                <select
                  id="edit-unit"
                  value={editUnit}
                  onChange={(e) => {
                    const u = e.target.value as ProductUnit;
                    setEditUnit(u);
                    if (u !== 'kg') setEditBuyD((d) => ({ ...d, loose: false }));
                    else setEditBuyD((d) => ({ ...d, bulkId: '' }));
                  }}
                >
                  {PRODUCT_UNITS.map((code) => (
                    <option key={code} value={code}>
                      {t(productUnitKey(code))}
                    </option>
                  ))}
                </select>
              </div>
              <BuyFields
                idp="edit"
                unit={editUnit}
                draft={editBuyD}
                onChange={setEditBuyD}
                onLoose={(on) => on && setEditUnit('kg')}
                bulks={bulkOptions}
              />
              <div className="field">
                <label htmlFor="edit-price">{t('piecePriceRs')}</label>
                <MoneyInput
                  id="edit-price"
                  value={editPriceRs}
                  onValueChange={(v) => setEditPriceRs(v)}
                  aria-invalid={editPriceRs.trim() !== '' && pricePaisaFrom(editPriceRs) == null}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="edit-barcode">{t('barcodeOptional')}</label>
                <input
                  id="edit-barcode"
                  className="ltr-isolate"
                  value={editBarcode}
                  onChange={(e) => setEditBarcode(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <ExtraBarcodes idp="edit" codes={editExtra} primary={editBarcode} onChange={setEditExtra} />
              <div className="field">
                <label htmlFor="edit-reorder">{t('reorderLevel')}</label>
                <input
                  id="edit-reorder"
                  className="ltr-isolate"
                  inputMode="decimal"
                  value={editReorder}
                  onChange={(e) => setEditReorder(e.target.value.replace(/[^\d.]/g, ''))}
                  data-reorder-input
                />
              </div>
              <div className="field field--check catalog-pricing" data-pricing-fields>
                <label className="settings-check">
                  <input type="checkbox" checked={editFixed} onChange={(e) => setEditFixed(e.target.checked)} data-fixed-price />
                  <span>Printed price (MRP)</span>
                </label>
                {!editFixed && printedHint(editName, pricePaisaFrom(editPriceRs)) ? (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditFixed(true)} data-mrp-hint>
                    Printed {printedHint(editName, pricePaisaFrom(editPriceRs))}?
                  </button>
                ) : null}
              </div>
              {!editFixed ? (
                <div className="field">
                  <label htmlFor="edit-markup">Markup %</label>
                  <input
                    id="edit-markup"
                    className="ltr-isolate"
                    inputMode="decimal"
                    placeholder={pricingDefault}
                    value={editMarkup}
                    onChange={(e) => setEditMarkup(e.target.value.replace(/[^\d.]/g, ''))}
                    data-markup-input
                  />
                </div>
              ) : null}
              <DiscountFields
                idPrefix="edit"
                draft={editDiscount}
                onChange={setEditDiscount}
                pricePaisa={pricePaisaFrom(editPriceRs)}
                hadDiscount={Boolean(selected?.discount_kind)}
                disabled={busy}
              />
              {selected ? <ProductPacksPanel productId={selected.id} unitLabel={t(productUnitKey(editUnit))} /> : null}
              {error && panel === 'edit' ? (
                <p className="catalog-alert" role="alert">
                  {translateError(t, error)}
                </p>
              ) : null}
              <div className="catalog-form__actions">
                <button
                  className="btn btn--teal"
                  type="submit"
                  disabled={busy || !editName.trim() || editPriceRs === ''}
                >
                  {t('saveProduct')}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={closePanel}
                  disabled={busy}
                >
                  {t('cancel')}
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {panel === 'add' ? (
          <section
            key="add"
            id="catalog-add-panel"
            className="catalog__panel"
            aria-label={t('addProduct')}
          >
            <h3 className="catalog__panel-title">{sizeFrom ? t('addAnotherSize') : t('addProduct')}</h3>
            {sizeFrom ? (
              <div className="catalog-size-from" data-size-from>
                <ProductThumb name={sizeFrom.name} imageFile={sizeFrom.image_file} />
                <span>{sizeFrom.name}</span>
              </div>
            ) : null}
            <form className="catalog-form" onSubmit={(e) => void addProduct(e)}>
              <div className="field">
                <label htmlFor="add-name">{t('productNameEn')}</label>
                <input
                  id="add-name"
                  ref={addNameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="add-unit">{t('unit')}</label>
                <select
                  id="add-unit"
                  value={unit}
                  onChange={(e) => {
                    const u = e.target.value as ProductUnit;
                    setUnit(u);
                    setAddBuyD((d) => ({ ...d, loose: u === 'kg', bulkId: u === 'kg' ? '' : d.bulkId }));
                  }}
                >
                  {PRODUCT_UNITS.map((code) => (
                    <option key={code} value={code}>
                      {t(productUnitKey(code))}
                    </option>
                  ))}
                </select>
              </div>
              <BuyFields
                idp="add"
                unit={unit}
                draft={addBuyD}
                onChange={setAddBuyD}
                onLoose={(on) => on && setUnit('kg')}
                bulks={bulkOptions}
              />
              {sizeFrom ? (
                <div className="field">
                  <label htmlFor="add-size-qty">{t('sizeQty')}</label>
                  <input
                    id="add-size-qty"
                    className="ltr-isolate"
                    inputMode="decimal"
                    value={addSizeQty}
                    onChange={(e) => setAddSizeQty(e.target.value.replace(/[^\d.]/g, ''))}
                    required
                    data-add-size-qty
                  />
                </div>
              ) : null}
              <div className="field">
                <label htmlFor="add-price">{t('piecePriceRs')}</label>
                <MoneyInput
                  id="add-price"
                  value={priceRs}
                  onValueChange={(v) => setPriceRs(v)}
                  aria-invalid={priceRs.trim() !== '' && pricePaisaFrom(priceRs) == null}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="add-barcode">{t('barcodeOptional')}</label>
                <input
                  id="add-barcode"
                  className="ltr-isolate"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <ExtraBarcodes idp="add" codes={addExtra} primary={barcode} onChange={setAddExtra} />
              <DiscountFields
                idPrefix="add"
                draft={discount}
                onChange={setDiscount}
                pricePaisa={pricePaisaFrom(priceRs)}
                disabled={busy}
              />
              {error && panel === 'add' ? (
                <p className="catalog-alert" role="alert">
                  {translateError(t, error)}
                </p>
              ) : null}
              <div className="catalog-form__actions">
                <button
                  className="btn btn--teal"
                  type="submit"
                  disabled={busy || !name.trim() || priceRs === '' || (sizeFrom != null && !(Number(addSizeQty) > 0))}
                >
                  {busy ? t('loading') : t('addProduct')}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={closePanel}
                  disabled={busy}
                >
                  {t('cancel')}
                </button>
              </div>
            </form>
          </section>
        ) : null}
      </div>

      {sizePlan && selected ? (
        <ConfirmModal
          title={t('sizePricesTitle')}
          message={`${selected.name}: ${formatRs(selected.price_paisa)} → ${formatRs(pricePaisaFrom(editPriceRs) ?? 0)}`}
          confirmLabel={t('sizePricesAll')}
          secondaryLabel={t('sizePricesOne')}
          cancelLabel={t('cancel')}
          tone="primary"
          busy={busy}
          onConfirm={() => void doSaveEdit(true)}
          onSecondary={() => void doSaveEdit(false)}
          onCancel={() => setSizePlan(null)}
        >
          <table className="catalog-table size-plan-table" data-size-plan>
            <thead>
              <tr>
                <th scope="col">{t('catalogColProduct')}</th>
                <th scope="col" className="num">{t('sizeQty')}</th>
                <th scope="col" className="num">{t('sizeOldPrice')}</th>
                <th scope="col" className="num">{t('sizeNewPrice')}</th>
              </tr>
            </thead>
            <tbody>
              {sizePlan.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td className="num ltr-isolate">{x.size_qty}</td>
                  <td className="num ltr-isolate">{formatRs(x.old_price_paisa)}</td>
                  <td className="num ltr-isolate"><strong>{formatRs(x.new_price_paisa)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ConfirmModal>
      ) : null}
      {importOpen ? (
        <ImportModal onClose={() => setImportOpen(false)} onDone={() => void refresh()} />
      ) : null}
      {historyOpen && selected ? (
        <PriceHistoryModal productId={selected.id} name={selected.name} onClose={() => setHistoryOpen(false)} />
      ) : null}
      {stickerOpen && selected ? (
        <StickerPrint
          product={{
            name: selected.name,
            priceLabel: formatRsSticker(selected.price_paisa),
            barcode: selected.barcode ?? '',
          }}
          onClose={() => setStickerOpen(false)}
          initialSize={labelSize}
          initialPerRow={labelPerRow}
        />
      ) : null}

      {error && panel === 'none' ? (
        <p className="catalog-alert" role="alert">
          {translateError(t, error)}
        </p>
      ) : null}
    </div>
  );
}

/** "Sale until …" / "Sale starts …" line for the selection bar. */
function SaleNote({
  product,
  now,
  when,
}: {
  product: Product;
  now: number;
  when: (iso: string) => string;
}) {
  const { t } = useI18n();
  const status = discountStatusOf(product, now);
  if (status === 'active') {
    return (
      <span className="catalog-sale-note">
        <span className="catalog-badge catalog-badge--sale">{t('discountBadge')}</span>
        <span className="ltr-isolate">{formatRs(currentPricePaisa(product, now))}</span>
        <span>
          {product.discount_end_at
            ? t('discountUntil').replace('{date}', when(product.discount_end_at))
            : t('discountUntilCleared')}
        </span>
      </span>
    );
  }
  if (status === 'scheduled' && product.discount_start_at) {
    return (
      <span className="catalog-sale-note">
        <span className="catalog-badge catalog-badge--scheduled">
          {t('discountScheduledBadge')}
        </span>
        <span>{t('discountStartsOn').replace('{date}', when(product.discount_start_at))}</span>
      </span>
    );
  }
  return null;
}
