import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { setNavGuard } from '../shared/navGuard';
import { ConfirmModal } from '../shared/ConfirmModal';
import { OrdersPanel } from './OrdersPanel';
import { PurchasesShell, type RestockPrefill } from './PurchasesShell';

type Tab = 'orders' | 'bills' | 'new';

type Props = {
  displayName: string;
  showMoney?: boolean;
  isOwner: boolean;
  initialInvoiceId?: string | null;
  onInitialInvoiceConsumed?: () => void;
  initialRestock?: RestockPrefill[] | null;
  onInitialRestockConsumed?: () => void;
};

/** Purchases: Orders | Bills | New bill. Alt+1/2/3 switch tabs. */
export function PurchasesHub(props: Props) {
  const { showMoney = true } = props;
  const [tab, setTab] = useState<Tab>(props.initialRestock?.length ? 'new' : props.initialInvoiceId ? 'bills' : 'orders');
  const [billId, setBillId] = useState<string | null>(props.initialInvoiceId ?? null);
  const [gen, setGen] = useState(0);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const { t } = useI18n();
  /** PU2: a half-typed bill / order / receive is open in the current tab. */
  const dirtyRef = useRef(false);
  const onDirtyChange = (d: boolean) => {
    dirtyRef.current = d;
  };
  const confirmDrop = () => !dirtyRef.current || window.confirm(t('poLeaveUnsaved'));
  /** Tab switch with unsaved work: ask in-app (Stay keeps the bill as typed). */
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);
  const goTab = (next: Tab) => {
    dirtyRef.current = false;
    setTab(next);
    setGen((g) => g + 1);
  };
  const askTab = (next: Tab) => {
    if (dirtyRef.current) setPendingTab(next);
    else goTab(next);
  };
  const askTabRef = useRef(askTab);
  askTabRef.current = askTab;

  // Leaving Purchases (rail, bell, Sign Out) or closing the window with unsaved work: ask first.
  useEffect(() => {
    setNavGuard(() => confirmDrop());
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      setNavGuard(null);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    if (props.initialInvoiceId) {
      setBillId(props.initialInvoiceId);
      setTab('bills');
    }
  }, [props.initialInvoiceId]);
  useEffect(() => {
    if (props.initialRestock?.length) setTab('new');
  }, [props.initialRestock]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey) return;
      const map: Record<string, Tab> = { '1': 'orders', '2': 'bills', '3': 'new' };
      const next = map[e.key];
      if (!next) return;
      e.preventDefault();
      // Re-picking New bill must not wipe a half-typed bill (remount on gen bump).
      if (next === 'new' && tabRef.current === 'new') return;
      askTabRef.current(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const tabs: Array<[Tab, string, string]> = [
    ['orders', t('poTabOrders'), 'Alt+1'],
    ['bills', t('poTabBills'), 'Alt+2'],
    ['new', t('poTabNewBill'), 'Alt+3'],
  ];
  return (
    <div className="purchases-hub">
      <div className="po-tabs analytics-tabs" role="tablist" aria-label={t('poTabsAria')}>
        {tabs.map(([id, label, key]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            title={key}
            className={`analytics-tab${tab === id ? ' is-active' : ''}`}
            onClick={() => {
              if (id === 'new' && tab === 'new') return;
              askTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'orders' ? (
        <section className="card">
          <OrdersPanel
            key={`o${gen}`}
            displayName={props.displayName}
            showMoney={showMoney}
            isOwner={props.isOwner}
            onDirtyChange={onDirtyChange}
            onOpenBill={(id) => {
              setBillId(id);
              setTab('bills');
              setGen((g) => g + 1);
            }}
          />
        </section>
      ) : (
        <PurchasesShell
          key={`${tab}${gen}`}
          displayName={props.displayName}
          showMoney={showMoney}
          startEntry={tab === 'new'}
          onDirtyChange={onDirtyChange}
          onEntryDone={() => setTab('bills')}
          initialInvoiceId={tab === 'bills' ? billId : null}
          onInitialInvoiceConsumed={() => {
            setBillId(null);
            props.onInitialInvoiceConsumed?.();
          }}
          initialRestock={tab === 'new' ? props.initialRestock : null}
          onInitialRestockConsumed={props.onInitialRestockConsumed}
        />
      )}
      {pendingTab ? (
        <ConfirmModal
          title={t('poLeaveTitle')}
          message={t('poLeaveUnsaved')}
          confirmLabel={t('poLeaveYes')}
          cancelLabel={t('poLeaveStay')}
          onConfirm={() => {
            const next = pendingTab;
            setPendingTab(null);
            goTab(next);
          }}
          onCancel={() => setPendingTab(null)}
        />
      ) : null}
    </div>
  );
}
