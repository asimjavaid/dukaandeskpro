/** Monthly payslip on the receipt printer (same paper as receipts). */
import { printHtml, type PrintReceiptResult } from '../pos/printReceipt';

export type Payslip = {
  storeName: string;
  name: string;
  roleLabel: string;
  position: string | null;
  monthLabel: string;
  salaryPaisa: number;
  bonusPaisa: number;
  deductionPaisa: number;
  paidPaisa: number;
  balancePaisa: number;
  advancePaisa: number;
  printedAt: string;
};

export type PayslipLabels = {
  title: string;
  salary: string;
  bonus: string;
  deduction: string;
  paid: string;
  balance: string;
  advance: string;
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
  return `Rs ${(v / 100).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function buildPayslipHtml(p: Payslip, L: PayslipLabels, widthMm: 58 | 80): string {
  const printable = widthMm === 58 ? 52 : 72;
  const row = (label: string, paisa: number, cls = '') =>
    `<div class="row${cls ? ` ${cls}` : ''}"><span>${esc(label)}</span><span>${esc(rs(paisa))}</span></div>`;
  const rows = [row(L.salary, p.salaryPaisa)];
  if (p.bonusPaisa > 0) rows.push(row(L.bonus, p.bonusPaisa));
  if (p.deductionPaisa > 0) rows.push(row(L.deduction, -p.deductionPaisa));
  rows.push(row(L.paid, p.paidPaisa));
  rows.push(row(L.balance, p.balancePaisa, 'total'));
  if (p.advancePaisa > 0) rows.push(row(L.advance, p.advancePaisa));
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Payslip</title><style>
@page { size: ${widthMm}mm auto; margin: ${widthMm === 58 ? 3 : 4}mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #000; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.35; }
.ticket { width: ${printable}mm; }
h1 { margin: 0 0 2px; text-align: center; font-size: 14px; }
.mark { margin: 2px 0 4px; text-align: center; font-size: 14px; font-weight: 700; letter-spacing: 2px; }
.c { margin: 0; text-align: center; font-size: 11px; }
.lines { border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 6px 0; margin: 6px 0; }
.row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
.row.total { font-weight: 700; font-size: 13px; border-top: 1px dashed #000; padding-top: 4px; }
.sign { margin-top: 18px; border-top: 1px solid #000; padding-top: 2px; text-align: center; font-size: 11px; }
</style></head><body><article class="ticket">
<h1>${esc(p.storeName)}</h1>
<p class="mark">${esc(L.title)}</p>
<p class="c">${esc(p.name)} · ${esc(p.roleLabel)}${p.position ? ` · ${esc(p.position)}` : ''}</p>
<p class="c">${esc(p.monthLabel)}</p>
<div class="lines">${rows.join('\n')}</div>
<p class="c">${esc(p.printedAt)}</p>
<p class="sign">${esc(L.signature)}</p>
</article></body></html>`;
}

export function printPayslip(
  slip: Payslip,
  labels: PayslipLabels,
  opts: { widthMm: 58 | 80; printerName: string | null },
): Promise<PrintReceiptResult> {
  return printHtml(buildPayslipHtml(slip, labels, opts.widthMm), opts.printerName);
}
