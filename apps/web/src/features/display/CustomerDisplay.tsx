import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatRsShort as formatRs } from '../../lib/money';
import { productImageUrl } from '../shared/ProductThumb';
import { useDisplayState, type DisplayDone, type DisplayState } from './displayChannel';

/** How long the payment summary, then the thank-you, stay up before the screen goes back to Welcome. */
const PAY_MS = 9000;
const THANKS_MS = 4000;

type Line = DisplayState['lines'][number];

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

const timeFmt = new Intl.DateTimeFormat('en-PK', { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function Thumb({ line }: { line: Line }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [line.imageFile]);
  if (line.imageFile && !failed) {
    return (
      <span className="cdx-thumb">
        <img src={productImageUrl(line.imageFile)} alt="" draggable={false} onError={() => setFailed(true)} />
      </span>
    );
  }
  const ch = Array.from(line.name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span className="cdx-thumb cdx-thumb--letter" aria-hidden="true">
      {ch}
    </span>
  );
}

/** Payment summary → thank you → welcome, timed on this screen only. */
function useDonePhase(done: DisplayDone | null): 'pay' | 'thanks' | 'over' | null {
  const [phase, setPhase] = useState<'pay' | 'thanks' | 'over' | null>(null);
  const sig = done ? `${done.id ?? ''}|${done.at ?? ''}|${done.totalPaisa}` : '';
  useEffect(() => {
    if (!done) {
      setPhase(null);
      return;
    }
    const age = done.at ? Date.now() - done.at : 0;
    if (age >= PAY_MS + THANKS_MS) {
      setPhase('over');
      return;
    }
    setPhase(age >= PAY_MS ? 'thanks' : 'pay');
    const t1 = window.setTimeout(() => setPhase('thanks'), Math.max(0, PAY_MS - age));
    const t2 = window.setTimeout(() => setPhase('over'), PAY_MS + THANKS_MS - age);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return phase;
}

/** Customer-facing screen: the open bill, big and clear. No API calls. */
export function CustomerDisplay() {
  const s = useDisplayState();
  const now = useClock();
  useEffect(() => {
    document.title = 'DukaanDesk Pro — Customer';
  }, []);
  const lines = s?.lines ?? [];
  const done = s?.done ?? null;
  const phase = useDonePhase(done);
  const store = s?.store || 'DukaanDesk Pro';

  // Highlight the line that was just added or changed, and keep it in view.
  const prev = useRef<Map<string, string>>(new Map());
  const [hiKey, setHiKey] = useState<string | null>(null);
  const keyOf = (l: Line, i: number) => l.key ?? `${l.name}-${i}`;
  useEffect(() => {
    const next = new Map<string, string>();
    let changed: string | null = null;
    lines.forEach((l, i) => {
      const k = keyOf(l, i);
      const v = `${l.qty}|${l.totalPaisa}`;
      next.set(k, v);
      if (prev.current.get(k) !== v) changed = k;
    });
    prev.current = next;
    setHiKey((cur) => changed ?? (cur && next.has(cur) ? cur : lines.length ? keyOf(lines[lines.length - 1], lines.length - 1) : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);
  const listRef = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    if (!hiKey) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-line-key="${CSS.escape(hiKey)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [hiKey, lines.length]);

  const view: 'idle' | 'bill' | 'pay' | 'thanks' =
    done && lines.length === 0 ? (phase === 'pay' ? 'pay' : phase === 'thanks' ? 'thanks' : 'idle') : lines.length ? 'bill' : 'idle';

  const latest = lines.find((l, i) => keyOf(l, i) === hiKey) ?? null;
  const pieces = lines.reduce((n, l) => n + (l.qtyNum != null && Number.isInteger(l.qtyNum) ? l.qtyNum : 1), 0);
  const sub = s?.subtotalPaisa ?? 0;
  const disc = s?.discountPaisa ?? 0;
  const round = s?.roundingPaisa ?? 0;

  return (
    <div className={`cdx cdx--${view}`} data-customer-display data-display-state={view}>
      <header className="cdx-head">
        <div className="cdx-brand">
          <span className="cdx-brand__mark" aria-hidden="true">
            {Array.from(store.trim())[0]?.toUpperCase() ?? 'D'}
          </span>
          <span className="cdx-brand__name">{store}</span>
        </div>
        <div className="cdx-head__right">
          {s?.party && view === 'bill' ? (
            <span className="cdx-party" data-display-party>
              {s.party}
              {s.points != null ? <span className="cdx-party__pts ltr-isolate">{s.points} pts</span> : null}
            </span>
          ) : null}
          <span className="cdx-clock ltr-isolate">{timeFmt.format(now)}</span>
        </div>
      </header>

      {view === 'idle' ? (
        <main className="cdx-idle">
          <p className="cdx-idle__welcome">Welcome</p>
          <p className="cdx-idle__ur" lang="ur">
            خوش آمدید
          </p>
          <p className="cdx-idle__date">{dateFmt.format(now)}</p>
        </main>
      ) : view === 'thanks' ? (
        <main className="cdx-idle cdx-idle--thanks" data-display-done>
          <p className="cdx-idle__welcome">Thank you</p>
          <p className="cdx-idle__ur" lang="ur">
            شکریہ
          </p>
          <p className="cdx-idle__date">{store}</p>
        </main>
      ) : view === 'pay' && done ? (
        <main className="cdx-pay" data-display-done>
          <PayPanel done={done} />
        </main>
      ) : (
        <main className="cdx-bill">
          <section className="cdx-items" aria-label="Bill">
            <div className="cdx-items__head" aria-hidden="true">
              <span>Item</span>
              <span>
                Qty<span className="cdx-line__each"> × Price</span>
              </span>
              <span>Amount</span>
            </div>
            <ol className="cdx-lines" ref={listRef}>
              {lines.map((l, i) => {
                const k = keyOf(l, i);
                return (
                  <li key={k} data-line-key={k} className={`cdx-line${k === hiKey ? ' is-latest' : ''}`}>
                    <Thumb line={l} />
                    <span className="cdx-line__name">{l.name}</span>
                    <span className="cdx-line__qty ltr-isolate">
                      {l.qty}
                      {l.unitPricePaisa != null ? <span className="cdx-line__each"> × {formatRs(l.unitPricePaisa)}</span> : null}
                    </span>
                    <span className="cdx-line__amt ltr-isolate">{formatRs(l.totalPaisa)}</span>
                  </li>
                );
              })}
            </ol>
          </section>
          <aside className="cdx-sum">
            {latest ? (
              <div className="cdx-last" data-display-latest>
                <Thumb line={latest} />
                <p className="cdx-last__name">{latest.name}</p>
                <p className="cdx-last__qty ltr-isolate">
                  {latest.qty}
                  {latest.unitPricePaisa != null ? ` × ${formatRs(latest.unitPricePaisa)}` : ''}
                </p>
                <p className="cdx-last__amt ltr-isolate">{formatRs(latest.totalPaisa)}</p>
              </div>
            ) : null}
            <dl className="cdx-sum__rows">
              <div>
                <dt>Items</dt>
                <dd className="ltr-isolate" data-display-count>
                  {lines.length}
                  {pieces !== lines.length ? <span className="cdx-sum__pcs"> · {pieces} pcs</span> : null}
                </dd>
              </div>
              <div>
                <dt>Subtotal</dt>
                <dd className="ltr-isolate">{formatRs(sub)}</dd>
              </div>
              {disc > 0 ? (
                <div className="cdx-sum__save">
                  <dt>Discount</dt>
                  <dd className="ltr-isolate">−{formatRs(disc)}</dd>
                </div>
              ) : null}
              {round !== 0 ? (
                <div>
                  <dt>Rounding</dt>
                  <dd className="ltr-isolate">{round > 0 ? '+' : '−'}{formatRs(Math.abs(round))}</dd>
                </div>
              ) : null}
            </dl>
            <div className="cdx-total" data-display-total>
              <span className="cdx-total__label">Total</span>
              <span className="cdx-total__value ltr-isolate">{formatRs(s?.totalPaisa ?? 0)}</span>
            </div>
          </aside>
        </main>
      )}
    </div>
  );
}

function PayPanel({ done }: { done: DisplayDone }) {
  const method = done.method ?? 'cash';
  const udhaar = done.udhaarPaisa ?? (method === 'udhaar' ? done.totalPaisa : 0);
  const digital = done.digitalPaisa ?? 0;
  const tendered = done.tenderedPaisa ?? 0;
  const rows: Array<{ k: string; v: string; cls?: string }> = [];
  if (tendered > 0) rows.push({ k: 'Cash received', v: formatRs(tendered) });
  if (digital > 0) rows.push({ k: done.digitalLabel ? `Paid by ${done.digitalLabel}` : 'Paid online', v: formatRs(digital) });
  const khataOnly = udhaar > 0 && tendered === 0 && digital === 0;
  if (udhaar > 0 && !khataOnly) rows.push({ k: 'Added to khata', v: formatRs(udhaar), cls: 'cdx-pay__row--khata' });
  if ((done.surplusCreditedPaisa ?? 0) > 0) rows.push({ k: 'Kept on khata', v: formatRs(done.surplusCreditedPaisa ?? 0) });
  if ((done.taxPaisa ?? 0) > 0) rows.push({ k: 'Tax included', v: formatRs(done.taxPaisa ?? 0), cls: 'cdx-pay__row--muted' });
  if ((done.pointsEarned ?? 0) > 0) rows.push({ k: 'Points earned', v: String(done.pointsEarned), cls: 'cdx-pay__row--muted' });
  return (
    <div className="cdx-pay__card">
      <p className="cdx-pay__title">
        {khataOnly ? 'Added to khata' : 'Paid'}
        {done.party ? <span className="cdx-pay__party">{done.party}</span> : null}
      </p>
      <div className="cdx-pay__total">
        <span>Total</span>
        <span className="ltr-isolate">{formatRs(done.totalPaisa)}</span>
      </div>
      {rows.length ? (
        <dl className="cdx-pay__rows">
          {rows.map((r) => (
            <div key={r.k} className={r.cls}>
              <dt>{r.k}</dt>
              <dd className="ltr-isolate">{r.v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {done.changePaisa > 0 ? (
        <div className="cdx-pay__change" data-display-change>
          <span>Change</span>
          <span className="cdx-pay__value ltr-isolate">{formatRs(done.changePaisa)}</span>
        </div>
      ) : null}
    </div>
  );
}
