/** Day-end Z report on the receipt printer (same paper as receipts). */
import { printHtml, type PrintReceiptResult } from '../pos/printReceipt';
import type { TillMove, TillShift, TillSummary } from './tillTypes';

export type ZLabels = {
  title: string;
  opened: string;
  closed: string;
  float: string;
  cashSales: string;
  udhaarReceived: string;
  refunds: string;
  expenses: string;
  cashIn: string;
  cashOut: string;
  expected: string;
  counted: string;
  overShort: string;
  sales: string;
  udhaarGiven: string;
  returns: string;
  moves: string;
  signature: string;
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
  return `${v < 0 ? '−' : ''}Rs ${(Math.abs(v) / 100).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function buildZReportHtml(
  storeName: string,
  r: { shift: TillShift; summary: TillSummary; moves: TillMove[] },
  L: ZLabels,
  fmtTime: (iso: string) => string,
  widthMm: 58 | 80,
): string {
  const printable = widthMm === 58 ? 52 : 72;
  const s = r.summary;
  const row = (label: string, value: string, cls = '') =>
    `<div class="row${cls ? ` ${cls}` : ''}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
  const cash = [
    row(L.float, rs(s.opening_float_paisa)),
    row(L.cashSales, rs(s.cash_sales_paisa)),
    row(L.udhaarReceived, rs(s.udhaar_received_paisa)),
    row(L.refunds, rs(-s.refunds_cash_paisa)),
    row(L.expenses, rs(-s.expenses_paisa)),
    row(L.cashIn, rs(s.cash_in_paisa)),
    ...(s.digital_paisa ? [row('JazzCash / Easypaisa / Bank (not in drawer)', rs(s.digital_paisa))] : []),
    row(L.cashOut, rs(-s.cash_out_paisa)),
    row(L.expected, rs(r.shift.expected_paisa ?? s.expected_paisa), 'total'),
  ];
  if (r.shift.counted_paisa != null) {
    cash.push(row(L.counted, rs(r.shift.counted_paisa)));
    const os = r.shift.over_short_paisa ?? 0;
    cash.push(row(L.overShort, `${os > 0 ? '+' : ''}${rs(os)}`, 'total'));
  }
  const day = [
    row(`${L.sales} (${s.sale_count})`, rs(s.sales_total_paisa)),
    row(L.udhaarGiven, rs(s.udhaar_given_paisa)),
    row(`${L.returns} (${s.return_count})`, rs(s.returns_total_paisa)),
  ];
  const moves = r.moves.length
    ? `<div class="lines"><p class="h">${esc(L.moves)}</p>${r.moves
        .map((m) => row(`${m.kind === 'in' ? '+' : '−'} ${m.reason ?? ''}`, rs(m.amount_paisa)))
        .join('\n')}</div>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Z report</title><style>
@page { size: ${widthMm}mm auto; margin: ${widthMm === 58 ? 3 : 4}mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #000; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.35; }
.ticket { width: ${printable}mm; }
h1 { margin: 0 0 2px; text-align: center; font-size: 14px; }
.mark { margin: 2px 0 4px; text-align: center; font-size: 14px; font-weight: 700; letter-spacing: 2px; }
.c { margin: 0; text-align: center; font-size: 11px; }
.h { margin: 0 0 2px; font-weight: 700; }
.lines { border-top: 1px dashed #000; padding: 6px 0; margin: 6px 0 0; }
.row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
.row.total { font-weight: 700; font-size: 13px; border-top: 1px dashed #000; padding-top: 4px; }
.sign { margin-top: 18px; border-top: 1px solid #000; padding-top: 2px; text-align: center; font-size: 11px; }
</style></head><body><article class="ticket">
<h1>${esc(storeName)}</h1>
<p class="mark">${esc(L.title)}</p>
<p class="c">${esc(L.opened)}: ${esc(fmtTime(r.shift.opened_at))}${r.shift.opened_by_name ? ` · ${esc(r.shift.opened_by_name)}` : ''}</p>
${r.shift.closed_at ? `<p class="c">${esc(L.closed)}: ${esc(fmtTime(r.shift.closed_at))}${r.shift.closed_by_name ? ` · ${esc(r.shift.closed_by_name)}` : ''}</p>` : ''}
<div class="lines">${cash.join('\n')}</div>
<div class="lines">${day.join('\n')}</div>
${moves}
${r.shift.note ? `<p class="c">${esc(r.shift.note)}</p>` : ''}
<p class="sign">${esc(L.signature)}</p>
</article></body></html>`;
}

export function printZReport(
  storeName: string,
  r: { shift: TillShift; summary: TillSummary; moves: TillMove[] },
  labels: ZLabels,
  fmtTime: (iso: string) => string,
  opts: { widthMm: 58 | 80; printerName: string | null },
): Promise<PrintReceiptResult> {
  return printHtml(buildZReportHtml(storeName, r, labels, fmtTime, opts.widthMm), opts.printerName);
}
