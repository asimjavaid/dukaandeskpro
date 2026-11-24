import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { PinLogin } from '../features/auth/PinLogin';
import { RecoveryCodeModal } from '../features/auth/RecoveryCodeModal';
import { FirstRunSetup } from '../features/setup/FirstRunSetup';
import { CatalogShell } from '../features/catalog/CatalogShell';
import { PosShell } from '../features/pos/PosShell';
import { PartiesShell } from '../features/parties/PartiesShell';
import { BackupShell } from '../features/backup/BackupShell';
import { AnalyticsShell } from '../features/analytics/AnalyticsShell';
import { ExpensesShell } from '../features/expenses/ExpensesShell';
import { TillShell } from '../features/till/TillShell';
import { LinkStatus, useLink } from '../features/tills/TillLink';
import { TillsShell } from '../features/tills/TillsShell';
import { SuppliersShell } from '../features/suppliers/SuppliersShell';
import { type RestockPrefill } from '../features/purchases/PurchasesShell';
import { PurchasesHub } from '../features/purchases/PurchasesHub';
import { OpeningStockShell } from '../features/opening/OpeningStockShell';
import { StockCountShell } from '../features/stock-count/StockCountShell';
import { StaffShell } from '../features/staff/StaffShell';
import { SettingsShell } from '../features/settings/SettingsShell';
import { TaxShell } from '../features/tax/TaxShell';
import { CashierTodayShell } from '../features/cashier/CashierTodayShell';
import { SalesShell, type EditableSale } from '../features/sales/SalesShell';
import { ReturnsShell } from '../features/returns/ReturnsShell';
import { StockCareShell } from '../features/stockcare/StockCareShell';
import { RepackShell } from '../features/stockcare/RepackShell';
import type { RepackIntent } from '../features/stockcare/RepackPanel';
import { ActivityShell } from '../features/activity/ActivityShell';
import { ShortcutsSheet } from '../features/shared/ShortcutsSheet';
import { ShellRail, type RailSection } from '../features/shared/ShellRail';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { ThemeSwitcher } from '../features/shared/ThemeSwitcher';
import type { AlertTarget } from '../features/notifications/alerts';
import { apiGet, apiGetRaw, apiPost, setSessionToken } from '../lib/api';
import { canNavigate } from '../features/shared/navGuard';
import { clearOpenSales, openBillsWithItems } from '../features/pos/openSalesStore';

const RAIL_COLLAPSED_KEY = 'dukaandesk_nav_collapsed';

function readRailCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeRailCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore quota / private mode */
  }
}

type Session = {
  userId: string;
  displayName: string;
  role: 'owner' | 'manager' | 'cashier' | 'data_entry';
  storeId: string;
};

type ReadyView =
  | 'catalog'
  | 'stockCount'
  | 'openingStock'
  | 'sell'
  | 'sales'
  | 'returns'
  | 'parties'
  | 'backup'
  | 'analytics'
  | 'expenses'
  | 'tax'
  | 'suppliers'
  | 'purchases'
  | 'staff'
  | 'settings'
  | 'till'
  | 'tills'
  | 'stockCare'
  | 'repack'
  | 'activity'
  | 'today';

type Boot =
  | { kind: 'loading' }
  | { kind: 'setup' }
  | { kind: 'login' }
  | {
      kind: 'ready';
      session: Session;
      view: ReadyView;
    };

// Left rail follows standard retail POS grouping: Sell first, then
// Sales → Inventory → Finance, with System pinned to the bottom.
// D31: Tax management is under Finance. FBR queue stays hidden.
const OWNER_SECTIONS: RailSection<ReadyView>[] = [
  {
    id: 'main',
    items: [{ view: 'sell', labelKey: 'sell', icon: 'sell' }],
  },
  {
    id: 'sales',
    headingKey: 'navGroupSales',
    items: [
      { view: 'sales', labelKey: 'salesTitle', icon: 'receipt' },
      { view: 'returns', labelKey: 'returnsTitle', icon: 'returns' },
      { view: 'till', labelKey: 'tillTitle', icon: 'till' },
      { view: 'parties', labelKey: 'parties', icon: 'parties' },
    ],
  },
  {
    id: 'inventory',
    headingKey: 'navGroupInventory',
    items: [
      { view: 'catalog', labelKey: 'catalog', icon: 'catalog' },
      { view: 'purchases', labelKey: 'purchasesTitle', icon: 'purchases' },
      { view: 'suppliers', labelKey: 'suppliersTitle', icon: 'suppliers' },
      { view: 'stockCount', labelKey: 'stockCountTitle', icon: 'stockCount' },
      { view: 'openingStock', labelKey: 'osTitle', icon: 'stock' },
      { view: 'stockCare', labelKey: 'stockCare', icon: 'warning' },
      { view: 'repack', labelKey: 'repackTitle', icon: 'repack' },
    ],
  },
  {
    id: 'finance',
    headingKey: 'navGroupFinance',
    items: [
      { view: 'expenses', labelKey: 'expensesTitle', icon: 'expenses' },
      { view: 'analytics', labelKey: 'analytics', icon: 'analytics' },
      { view: 'tax', labelKey: 'taxTitle', icon: 'tax' },
    ],
  },
];

const OWNER_SYSTEM: RailSection<ReadyView> = {
  id: 'system',
  headingKey: 'navGroupSystem',
  items: [
    { view: 'settings', labelKey: 'settings', icon: 'settings' },
    { view: 'tills', labelKey: 'tillsTitle', icon: 'till' },
    { view: 'staff', labelKey: 'staff', icon: 'staff' },
    { view: 'activity', labelKey: 'activityTitle', icon: 'receipt' },
    { view: 'backup', labelKey: 'backup', icon: 'backup' },
  ],
};

const CASHIER_SECTIONS: RailSection<ReadyView>[] = [
  {
    id: 'main',
    items: [
      { view: 'today', labelKey: 'cashierToday', icon: 'today' },
      { view: 'sell', labelKey: 'sell', icon: 'sell' },
      { view: 'sales', labelKey: 'salesTitle', icon: 'receipt' },
      { view: 'returns', labelKey: 'returnsTitle', icon: 'returns' },
      { view: 'till', labelKey: 'tillTitle', icon: 'till' },
    ],
  },
];

// Manager: the cashier's screens plus every till.
const MANAGER_SECTIONS: RailSection<ReadyView>[] = [
  {
    id: 'main',
    items: [
      ...CASHIER_SECTIONS[0].items,
      { view: 'tills', labelKey: 'tillsTitle', icon: 'till' },
    ],
  },
];

// Data entry: inventory work only, selling prices visible, no cost or money.
const DATA_ENTRY_SECTIONS: RailSection<ReadyView>[] = [
  {
    id: 'inventory',
    headingKey: 'navGroupInventory',
    items: [
      { view: 'catalog', labelKey: 'catalog', icon: 'catalog' },
      { view: 'purchases', labelKey: 'purchasesTitle', icon: 'purchases' },
      { view: 'suppliers', labelKey: 'suppliersTitle', icon: 'suppliers' },
      // Stock Count is Owner-only (D28, re-affirmed 2026-10-19): no entry for Data entry.
      { view: 'stockCare', labelKey: 'stockCare', icon: 'warning' },
      { view: 'repack', labelKey: 'repackTitle', icon: 'repack' },
    ],
  },
  {
    id: 'sales',
    headingKey: 'navGroupSales',
    items: [
      { view: 'sales', labelKey: 'salesTitle', icon: 'receipt' },
      { view: 'parties', labelKey: 'parties', icon: 'parties' },
    ],
  },
];

const DATA_ENTRY_VIEWS: ReadyView[] = ['catalog', 'purchases', 'suppliers', 'stockCare', 'repack', 'sales', 'parties'];

function defaultView(role: Session['role']): ReadyView {
  return role === 'cashier' || role === 'manager' ? 'today' : 'catalog';
}

function roleLabelKey(role: Session['role']): 'owner' | 'cashier' | 'roleDataEntry' | 'roleManager' {
  return role === 'owner' ? 'owner' : role === 'data_entry' ? 'roleDataEntry' : role === 'manager' ? 'roleManager' : 'cashier';
}

/** While a till sells offline only Sell is open. */
function offlineOnly(sections: RailSection<ReadyView>[]): RailSection<ReadyView>[] {
  return sections
    .map((sec) => ({ ...sec, items: sec.items.filter((i) => i.view === 'sell') }))
    .filter((sec) => sec.items.length > 0);
}

export function App() {
  const { t } = useI18n();
  const link = useLink();
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  const [purchaseFocusId, setPurchaseFocusId] = useState<string | null>(null);
  const [tillFocusId, setTillFocusId] = useState<string | null>(null);
  // One-shot nav state from Analytics: Restock → New purchase, udhaar list / khata → Customers.
  const [restockItems, setRestockItems] = useState<RestockPrefill[] | null>(null);
  const [repackIntent, setRepackIntent] = useState<RepackIntent>(null);
  const [partiesIntent, setPartiesIntent] = useState<{ owedOnly?: boolean; partyId?: string } | null>(
    null,
  );
  const [railCollapsed, setRailCollapsed] = useState(readRailCollapsed);
  // Narrow windows (900–1099px wide) show the rail as icons unless opened for this session.
  const narrow = useMediaQuery('(min-width: 900px) and (max-width: 1099px)');
  const [narrowOpen, setNarrowOpen] = useState(false);
  const railIcons = narrow ? !narrowOpen : railCollapsed;
  // One-shot: open a bill on the Sales screen (from Today).
  const [saleFocusId, setSaleFocusId] = useState<string | null>(null);
  // One-shot: open a bill on the Returns screen (Return items from Sales).
  const [returnSaleId, setReturnSaleId] = useState<string | null>(null);
  // One-shot: open a bill in Sell as an Edit tab (Owner, from Sales).
  const [editSale, setEditSale] = useState<EditableSale | null>(null);

  function toggleRailCollapsed() {
    if (narrow) {
      setNarrowOpen((v) => !v);
      return;
    }
    setRailCollapsed((prev) => {
      const next = !prev;
      writeRailCollapsed(next);
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await apiGet<{
          needsSetup: boolean;
        }>('/auth/status');
        if (cancelled) return;
        if (status.needsSetup) {
          setBoot({ kind: 'setup' });
          return;
        }
        try {
          const me = await apiGet<{ session: Session }>('/auth/me');
          if (!cancelled) {
            setBoot({
              kind: 'ready',
              session: me.session,
              view: defaultView(me.session.role),
            });
          }
        } catch {
          if (!cancelled) setBoot({ kind: 'login' });
        }
      } catch {
        if (!cancelled) setBoot({ kind: 'login' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    // Same guard as nav: don't drop unsaved Stock Count lines or a half-typed purchase.
    if (!canNavigate()) return;
    // S1: open Sell bills survive screen changes but not Sign Out — ask first.
    const openBills = openBillsWithItems(boot.kind === 'ready' ? boot.session.userId : undefined);
    if (openBills > 0 && !window.confirm(t('sellSignOutOpenBills').replace('{n}', String(openBills)))) return;
    clearOpenSales();
    try {
      await apiPost('/auth/logout');
    } catch {
      /* ignore */
    }
    setSessionToken(null);
    setBoot({ kind: 'login' });
  }

  function onSession(session: Session) {
    setBoot({
      kind: 'ready',
      session,
      view: defaultView(session.role),
    });
  }

  function setView(view: ReadyView) {
    if (boot.kind !== 'ready') return;
    if (view !== boot.view && !canNavigate()) return;
    setBoot({ kind: 'ready', session: boot.session, view });
  }

  const offlineSections = (x: RailSection<ReadyView>[]) => (link.offline ? offlineOnly(x) : x);

  // Offline: jump to Sell. Back online: a sign-in made offline may need the PIN again.
  useEffect(() => {
    if (link.offline && boot.kind === 'ready' && boot.view !== 'sell' && (boot.session.role !== 'data_entry')) {
      setBoot({ kind: 'ready', session: boot.session, view: 'sell' });
    }
  }, [link.offline, boot]);
  useEffect(() => {
    const onBack = async () => {
      const r = await apiGetRaw<{ session?: Session }>('/auth/me').catch(() => null);
      if (r && r.status === 401) {
        setSessionToken(null);
        setBoot({ kind: 'login' });
      }
    };
    window.addEventListener('dd:reconnected', onBack);
    return () => window.removeEventListener('dd:reconnected', onBack);
  }, []);

  const isReady = boot.kind === 'ready';
  const isOwnerReady = isReady && boot.session.role === 'owner';
  const isCashierReady = isReady && (boot.session.role === 'cashier' || boot.session.role === 'manager');
  const isManagerReady = isReady && boot.session.role === 'manager';
  const isDataEntryReady =
    isReady && boot.session.role === 'data_entry' && DATA_ENTRY_VIEWS.includes(boot.view);
  /** Owner or Data entry: inventory screens. */
  const isInventoryReady = isOwnerReady || isDataEntryReady;
  const showMoney = isOwnerReady;
  const withRail = isOwnerReady || isCashierReady || (isReady && boot.session.role === 'data_entry');
  const ownerId = isOwnerReady ? boot.session.userId : null;
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    (async () => {
      try {
        const st = await apiGet<{ has_code: boolean; acknowledged: boolean }>('/auth/recovery');
        if (cancelled || st.acknowledged) return;
        const g = await apiPost<{ ok: boolean; code: string }>('/auth/recovery/generate');
        if (!cancelled && g.ok) setRecoveryCode(g.code);
      } catch {
        /* offline: ask again next login */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerId]);

  async function ackRecovery() {
    setRecoveryBusy(true);
    await apiPost('/auth/recovery/ack').catch(() => null);
    setRecoveryBusy(false);
    setRecoveryCode(null);
  }

  return (
    <div
      className={`shell${withRail ? ' shell--with-rail' : ''}`}
    >
      <header className="shell__header">
        <h1 className="shell__title">{t('appName')}</h1>
        <div className="shell__header-end">
          <LinkStatus />
          <ThemeSwitcher />
          {isOwnerReady ? (
            <NotificationBell
              userId={boot.session.userId}
              view={boot.view}
              onNavigate={(target: AlertTarget) => setView(target)}
            />
          ) : null}
          {isReady ? (
            <span className="chip chip--session">
              {boot.session.displayName} ·{' '}
              {t(roleLabelKey(boot.session.role))}
            </span>
          ) : null}
        </div>
      </header>

      <div
        className={['shell__body', withRail && railIcons ? 'shell__body--rail-collapsed' : '']
          .filter(Boolean)
          .join(' ')}
      >
        {isOwnerReady ? (
          <ShellRail
            ariaLabel={t('owner')}
            sections={link.offline ? offlineOnly(OWNER_SECTIONS) : OWNER_SECTIONS}
            footSection={link.offline ? undefined : OWNER_SYSTEM}
            view={boot.view}
            collapsed={railIcons}
            onNavigate={setView}
            onToggleCollapsed={toggleRailCollapsed}
            onSignOut={() => void logout()}
          />
        ) : null}

        {isReady && boot.session.role === 'data_entry' ? (
          <ShellRail
            ariaLabel={t('roleDataEntry')}
            sections={DATA_ENTRY_SECTIONS}
            view={boot.view}
            collapsed={railIcons}
            onNavigate={setView}
            onToggleCollapsed={toggleRailCollapsed}
            onSignOut={() => void logout()}
          />
        ) : null}

        {isCashierReady ? (
          <ShellRail
            ariaLabel={t('cashier')}
            sections={offlineSections(isManagerReady ? MANAGER_SECTIONS : CASHIER_SECTIONS)}
            view={boot.view}
            collapsed={railIcons}
            onNavigate={setView}
            onToggleCollapsed={toggleRailCollapsed}
            onSignOut={() => void logout()}
          />
        ) : null}

        <main id="shell-main" className="shell__main">
          {boot.kind === 'loading' ? (
            <p className="muted">{t('loading')}</p>
          ) : null}
          {boot.kind === 'setup' ? (
            <FirstRunSetup onDone={onSession} />
          ) : null}
          {boot.kind === 'login' ? <PinLogin onLoggedIn={onSession} /> : null}
          {recoveryCode && isOwnerReady ? (
            <RecoveryCodeModal code={recoveryCode} busy={recoveryBusy} onDone={() => void ackRecovery()} />
          ) : null}

          {isInventoryReady && boot.view === 'catalog' ? (
            <CatalogShell
              displayName={boot.session.displayName}
              showCost={showMoney}
              onRepack={(bulkId) => {
                setRepackIntent({ bulkId });
                setView('repack');
              }}
            />
          ) : null}
          {isOwnerReady && boot.view === 'tax' ? (
            <TaxShell displayName={boot.session.displayName} />
          ) : null}
          {/* Owner-only: Dashboard / Execution / Review / Approve never render for other roles. */}
          {isOwnerReady && boot.view === 'stockCount' ? (
            <StockCountShell
              displayName={boot.session.displayName}
              onOpenCatalog={() => setView('catalog')}
            />
          ) : null}
          {isOwnerReady && boot.view === 'openingStock' ? <OpeningStockShell displayName={boot.session.displayName} /> : null}
          {isInventoryReady && boot.view === 'parties' ? (
            <PartiesShell
              displayName={boot.session.displayName}
              canCollect={showMoney}
              isOwner={boot.session.role === 'owner'}
              initialOwedOnly={partiesIntent?.owedOnly}
              initialPartyId={partiesIntent?.partyId ?? null}
              onInitialConsumed={() => setPartiesIntent(null)}
            />
          ) : null}
          {isInventoryReady && boot.view === 'suppliers' ? (
            <SuppliersShell
              displayName={boot.session.displayName}
              showMoney={showMoney}
              onOpenPurchase={(id) => {
                setPurchaseFocusId(id);
                setView('purchases');
              }}
            />
          ) : null}
          {isInventoryReady && boot.view === 'purchases' ? (
            <PurchasesHub
              displayName={boot.session.displayName}
              showMoney={showMoney}
              isOwner={boot.session.role === 'owner'}
              initialInvoiceId={purchaseFocusId}
              onInitialInvoiceConsumed={() => setPurchaseFocusId(null)}
              initialRestock={restockItems}
              onInitialRestockConsumed={() => setRestockItems(null)}
            />
          ) : null}
          {isInventoryReady && boot.view === 'repack' ? (
            <div className={showMoney ? undefined : 'dd-no-money'}>
              <RepackShell displayName={boot.session.displayName} isOwner={boot.session.role === 'owner'} intent={repackIntent} onIntentUsed={() => setRepackIntent(null)} />
            </div>
          ) : null}
          {isInventoryReady && boot.view === 'stockCare' ? (
            <StockCareShell
              displayName={boot.session.displayName}
              isOwner={boot.session.role === 'owner'}
              onMakePurchase={(items) => {
                setRestockItems(items);
                setView('purchases');
              }}
            />
          ) : null}
          {isOwnerReady && boot.view === 'activity' ? (
            <ActivityShell displayName={boot.session.displayName} />
          ) : null}
          {isOwnerReady && boot.view === 'backup' ? (
            <BackupShell displayName={boot.session.displayName} />
          ) : null}
          {isOwnerReady && boot.view === 'analytics' ? (
            <AnalyticsShell
              displayName={boot.session.displayName}
              onSell={() => setView('sell')}
              onCatalog={() => setView('catalog')}
              onUdhaarList={() => {
                setPartiesIntent({ owedOnly: true });
                setView('parties');
              }}
              onOpenKhata={(partyId) => {
                setPartiesIntent({ partyId });
                setView('parties');
              }}
              onRestock={(items) => {
                setRestockItems(items);
                setView('purchases');
              }}
            />
          ) : null}
          {(isOwnerReady || isCashierReady) && boot.view === 'till' ? (
            <TillShell
              displayName={boot.session.displayName}
              supervisor={isOwnerReady || isManagerReady}
              tillId={tillFocusId}
            />
          ) : null}
          {(isOwnerReady || isManagerReady) && boot.view === 'tills' ? (
            <TillsShell
              isOwner={isOwnerReady}
              onOpenTill={(id) => {
                setTillFocusId(id);
                setView('till');
              }}
            />
          ) : null}
          {isOwnerReady && boot.view === 'expenses' ? (
            <ExpensesShell displayName={boot.session.displayName} />
          ) : null}
          {isOwnerReady && boot.view === 'staff' ? (
            <StaffShell displayName={boot.session.displayName} />
          ) : null}
          {isOwnerReady && boot.view === 'settings' ? (
            <SettingsShell displayName={boot.session.displayName} />
          ) : null}

          {isCashierReady && boot.view === 'today' ? (
            <CashierTodayShell
              displayName={boot.session.displayName}
              onSell={() => setView('sell')}
              onOpenSale={(id) => {
                setSaleFocusId(id);
                setView('sales');
              }}
            />
          ) : null}

          {isReady && boot.view === 'sales' ? (
            <SalesShell
              key={boot.session.userId}
              displayName={boot.session.displayName}
              role={boot.session.role}
              initialSaleId={saleFocusId}
              onInitialConsumed={() => setSaleFocusId(null)}
              onReturnItems={
                boot.session.role === 'data_entry'
                  ? undefined
                  : (id) => {
                      setReturnSaleId(id);
                      setView('returns');
                    }
              }
              onEditSale={
                isOwnerReady
                  ? (sale) => {
                      setEditSale(sale);
                      setView('sell');
                    }
                  : undefined
              }
            />
          ) : null}

          {isReady && boot.view === 'returns' && boot.session.role !== 'data_entry' ? (
            <ReturnsShell
              key={boot.session.userId}
              displayName={boot.session.displayName}
              role={boot.session.role}
              initialSaleId={returnSaleId}
              onInitialConsumed={() => setReturnSaleId(null)}
            />
          ) : null}

          {isReady && boot.view === 'sell' && boot.session.role !== 'data_entry' ? (
            <PosShell
              userId={boot.session.userId}
              displayName={boot.session.displayName}
              role={boot.session.role}
              onLogout={undefined}
              onBack={
                isCashierReady ? () => setView('today') : undefined
              }
              onReceiveStock={
                isOwnerReady ? () => setView('purchases') : undefined
              }
              onAddProduct={
                isOwnerReady ? () => setView('catalog') : undefined
              }
              editSale={isOwnerReady ? editSale : null}
              onEditConsumed={() => setEditSale(null)}
              onEditSaved={(saleId) => {
                setSaleFocusId(saleId);
              }}
            />
          ) : null}
        </main>
      </div>
      {isReady ? <ShortcutsSheet /> : null}
    </div>
  );
}

function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}
