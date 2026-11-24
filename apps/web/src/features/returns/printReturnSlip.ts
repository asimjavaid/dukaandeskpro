import { formatQty } from '../shared/productUnits';
/** Return slip for the thermal printer. Same printer and paper as receipts. */
import { printHtml, type PrintReceiptResult } from '../pos/printReceipt';

export type ReturnSlip = {
  storeName: string;
  returnNo: string;
  billNo: string;
  recordedAt: string;
  partyName: string | null;
  lines: Array<{ name: string; qty: number; unitPricePaisa: number; lineTotalPaisa: number }>;
  totalPaisa: number;
  cashPaisa: number;
  khataPaisa: number;
  footer?: string | null;
};

export type ReturnSlipLabels = {
  title: string;
  returnNo: string;
  bill: string;
  total: string;
  cash: string;
  khata: string;
  party: string;
};

function esc(raw: string): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rs(paisa: number): string {
  const v = Math.round(Number(paisa) || 0);
  const whole = v % 100 === 0;
  return `Rs ${(v / 100).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function buildReturnSlipHtml(slip: ReturnSlip, L: ReturnSlipLabels, widthMm: 58 | 80): string {
  const printable = widthMm === 58 ? 52 : 72;
  const when = (() => {
    const d = new Date(slip.recordedAt);
    return Number.isNaN(d.getTime()) ? slip.recordedAt : d.toLocaleString('en-PK', { hour12: true, timeZone: 'Asia/Karachi' });
  })();
  const lines = slip.lines
    .map(
      (l) => `<div class="line"><div class="top"><span>${esc(l.name)}</span><span>${esc(rs(l.lineTotalPaisa))}</span></div>
<div class="meta">${formatQty(l.qty)} × ${esc(rs(l.unitPricePaisa))}</div></div>`,
    )
    .join('\n');
  const rows = [`<div class="row total"><span>${esc(L.total)}</span><span>${esc(rs(slip.totalPaisa))}</span></div>`];
  if (slip.cashPaisa > 0) rows.push(`<div class="row"><span>${esc(L.cash)}</span><span>${esc(rs(slip.cashPaisa))}</span></div>`);
  if (slip.khataPaisa > 0) rows.push(`<div class="row"><span>${esc(L.khata)}</span><span>${esc(rs(slip.khataPaisa))}</span></div>`);
  if (slip.partyName) rows.push(`<div class="row"><span>${esc(L.party)}</span><span>${esc(slip.partyName)}</span></div>`);
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Return</title><style>
@page { size: ${widthMm}mm auto; margin: ${widthMm === 58 ? 3 : 4}mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #000; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.35; }
.ticket { width: ${printable}mm; }
h1 { margin: 0 0 2px; text-align: center; font-size: 14px; }
.mark { margin: 2px 0 4px; text-align: center; font-size: 14px; font-weight: 700; letter-spacing: 2px; }
.c { margin: 0; text-align: center; font-size: 11px; }
.lines { border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 6px 0; margin: 6px 0; }
.line { margin-bottom: 4px; } .top, .row { display: flex; justify-content: space-between; gap: 8px; }
.top { font-weight: 600; } .meta { font-size: 11px; } .row.total { font-weight: 700; font-size: 13px; }
.footer { margin-top: 8px; border-top: 1px dashed #000; padding-top: 6px; text-align: center; white-space: pre-wrap; font-size: 11px; }
</style></head><body><article class="ticket">
<h1>${esc(slip.storeName)}</h1>
<p class="mark">${esc(L.title)}</p>
<p class="c">${esc(L.returnNo)}: ${esc(slip.returnNo)} · ${esc(L.bill)}: #${esc(slip.billNo)}</p>
<p class="c">${esc(when)}</p>
<div class="lines">${lines}</div>
${rows.join('\n')}
${slip.footer ? `<p class="footer">${esc(slip.footer)}</p>` : ''}
</article></body></html>`;
}

export function printReturnSlip(
  slip: ReturnSlip,
  labels: ReturnSlipLabels,
  opts: { widthMm: 58 | 80; printerName: string | null },
): Promise<PrintReceiptResult> {
  return printHtml(buildReturnSlipHtml(slip, labels, opts.widthMm), opts.printerName);
}
