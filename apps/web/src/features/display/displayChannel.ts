import { useEffect, useState } from 'react';

/** What the customer-facing screen shows. Same-origin windows only; nothing leaves the PC. */
/** Finished sale as the customer screen shows it. Extra fields are optional (older tabs may omit them). */
export type DisplayDone = {
  totalPaisa: number;
  changePaisa: number;
  /** Sale short id + time, so the screen can tell one sale from the next. */
  id?: string;
  at?: number;
  method?: 'cash' | 'udhaar' | 'split';
  tenderedPaisa?: number;
  cashPaisa?: number;
  udhaarPaisa?: number;
  digitalPaisa?: number;
  digitalLabel?: string | null;
  taxPaisa?: number;
  surplusCreditedPaisa?: number;
  pointsEarned?: number;
  /** Customer on the sale (name only; balances are never sent). */
  party?: string | null;
};

/** What the customer-facing screen shows. Same-origin windows only; nothing leaves the PC. */
export type DisplayState = {
  store: string;
  lines: Array<{
    name: string;
    qty: string;
    totalPaisa: number;
    key?: string;
    unitPricePaisa?: number;
    qtyNum?: number;
    imageFile?: string | null;
  }>;
  subtotalPaisa: number;
  discountPaisa: number;
  roundingPaisa?: number;
  totalPaisa: number;
  party: string | null;
  points: number | null;
  /** Shown for a few seconds after a sale. */
  done: DisplayDone | null;
};

const CH = 'dd-display';
const KEY = 'dd-display-state';
let chan: BroadcastChannel | null = null;
function channel() {
  if (!chan && typeof BroadcastChannel !== 'undefined') chan = new BroadcastChannel(CH);
  return chan;
}

let last = '';
export function publishDisplay(s: DisplayState) {
  const j = JSON.stringify(s);
  if (j === last) return;
  last = j;
  channel()?.postMessage(s);
  try {
    localStorage.setItem(KEY, j);
  } catch {
    /* ignore */
  }
}

export function useDisplayState(): DisplayState | null {
  const [s, setS] = useState<DisplayState | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? 'null') as DisplayState | null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const c = channel();
    const on = (e: MessageEvent<DisplayState>) => setS(e.data);
    c?.addEventListener('message', on);
    const onStore = (e: StorageEvent) => {
      if (e.key === KEY && e.newValue) setS(JSON.parse(e.newValue) as DisplayState);
    };
    window.addEventListener('storage', onStore);
    return () => {
      c?.removeEventListener('message', on);
      window.removeEventListener('storage', onStore);
    };
  }, []);
  return s;
}

/** Open / close the customer screen (Electron: second monitor; browser: popup). */
export async function toggleCustomerDisplay(): Promise<void> {
  const b = (window as unknown as { dukaandesk?: { toggleCustomerDisplay?: () => Promise<unknown> } }).dukaandesk;
  if (b?.toggleCustomerDisplay) {
    await b.toggleCustomerDisplay();
    return;
  }
  const u = new URL(window.location.href);
  u.search = '?display=1';
  u.hash = '';
  window.open(u.toString(), 'dd-customer-display', 'popup,width=820,height=540');
}

export function isDisplayWindow(): boolean {
  return new URLSearchParams(window.location.search).get('display') === '1';
}
