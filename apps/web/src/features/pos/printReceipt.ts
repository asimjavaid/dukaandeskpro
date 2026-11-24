/**
 * Thermal receipt print — Electron silent to named printer when available,
 * otherwise iframe + browser print dialog. Sale is never blocked on failure.
 */

import {
  buildReceiptPayload,
  type SaleReceiptFields,
} from './receipt';

export type PrintReceiptResult = 'ok' | 'failed';

type ReceiptLabels = {
  total: string;
  payment: string;
  cash: string;
  udhaar: string;
  paid: string;
  change: string;
  party: string;
  split: string;
  clientTime: string;
  recordedTime: string;
  sale: string;
  /** "Incl. Sales Tax" — used only when the sale has a tax snapshot. */
  salesTaxIncl?: string;
};

type PrintOpts = {
  fields: SaleReceiptFields;
  widthMm?: 58 | 80;
  printerName?: string | null;
  labels: ReceiptLabels;
  /** Reprint from Sales: printed under the bill no (e.g. "COPY"). */
  copyMark?: string | null;
  /** Edited bill: printed under the bill no (e.g. "Replaces #1A2B3C4D"). */
  noteLine?: string | null;
};

type ElectronPrintBridge = {
  printReceipt?: (payload: {
    html: string;
    deviceName?: string;
    silent?: boolean;
  }) => Promise<{ ok?: boolean; reason?: string | null }>;
};

function escapeHtml(raw: string): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRs(paisa: number): string {
  return `Rs ${(Math.round(Number(paisa) || 0) / 100).toFixed(2)}`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-PK', { hour12: true });
  } catch {
    return iso;
  }
}

function getBridge(): ElectronPrintBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { dukaandesk?: ElectronPrintBridge };
  return w.dukaandesk ?? null;
}

/** Self-contained HTML document for thermal 58/80mm print. */
export function buildReceiptPrintHtml(opts: PrintOpts): string {
  const widthMm = opts.widthMm === 58 ? 58 : 80;
  const printableMm = widthMm === 58 ? 52 : 72;
  const payload = buildReceiptPayload(opts.fields);
  const L = opts.labels;
  const pb = payload.payment_breakdown;
  const methodLabel =
    pb.method === 'udhaar'
      ? L.udhaar
      : pb.method === 'split'
        ? L.split
        : L.cash;

  const linesHtml = payload.lines
    .map((line) => {
      return `<div class="line">
  <div class="line-top">
    <span class="name">${escapeHtml(line.name)}</span>
    <span class="amt">${escapeHtml(formatRs(line.line_total_paisa))}</span>
  </div>
  <div class="meta">${escapeHtml(line.qty_unit_label)} × ${escapeHtml(formatRs(line.unit_price_paisa))}</div>
</div>`;
    })
    .join('\n');

  const rows: string[] = [];
  const ex = payload.extras;
  if (ex?.subtotal_paisa != null) {
    rows.push(`<div class="row"><span>Subtotal</span><span dir="ltr">${escapeHtml(formatRs(ex.subtotal_paisa))}</span></div>`);
  }
  if (ex && ex.discount_paisa > 0) {
    rows.push(`<div class="row"><span>Discount${ex.discount_label ? ` ${escapeHtml(ex.discount_label)}` : ''}</span><span dir="ltr">-${escapeHtml(formatRs(ex.discount_paisa))}</span></div>`);
  }
  if (ex && ex.rounding_paisa !== 0) {
    rows.push(`<div class="row"><span>Rounding</span><span dir="ltr">${escapeHtml(formatRs(ex.rounding_paisa))}</span></div>`);
  }
  if (ex && ex.digital_paisa > 0) {
    rows.push(`<div class="row"><span>${escapeHtml(ex.digital_label ?? 'Digital')}${ex.digital_ref ? ` ${escapeHtml(ex.digital_ref)}` : ''}</span><span dir="ltr">${escapeHtml(formatRs(ex.digital_paisa))}</span></div>`);
  }
  if (ex?.points_balance != null) {
    rows.push(`<div class="row"><span>Points +${escapeHtml(String(ex.points_earned ?? 0))}</span><span dir="ltr">${escapeHtml(String(ex.points_balance))}</span></div>`);
  }
  rows.push(
    `<div class="row total"><span>${escapeHtml(L.total)}</span><span>${escapeHtml(formatRs(payload.total_paisa))}</span></div>`,
  );
  // Tax V1 — one line under Total only when the sale had Sales Tax ON (R3).
  if (payload.sales_tax) {
    rows.push(
      `<div class="row tax"><span>${escapeHtml(L.salesTaxIncl ?? 'Incl. Sales Tax')} <bdi dir="ltr">${escapeHtml(payload.sales_tax.rate_text)}%</bdi></span><span dir="ltr">${escapeHtml(formatRs(payload.sales_tax.tax_paisa))}</span></div>`,
    );
  }
  rows.push(
    `<div class="row"><span>${escapeHtml(L.payment)}</span><span>${escapeHtml(methodLabel)}</span></div>`,
  );
  if (pb.method === 'cash' || pb.method === 'split') {
    rows.push(
      `<div class="row"><span>${escapeHtml(L.cash)}</span><span>${escapeHtml(formatRs(pb.cash_paisa ?? 0))}</span></div>`,
    );
  }
  if (pb.method === 'udhaar' || pb.method === 'split') {
    rows.push(
      `<div class="row"><span>${escapeHtml(L.udhaar)}</span><span>${escapeHtml(formatRs(pb.udhaar_paisa ?? 0))}</span></div>`,
    );
  }
  if (pb.method !== 'udhaar' && pb.tendered_paisa != null) {
    rows.push(
      `<div class="row"><span>${escapeHtml(L.paid)}</span><span>${escapeHtml(formatRs(pb.tendered_paisa))}</span></div>`,
    );
  }
  if (pb.method !== 'udhaar' && pb.change_paisa != null) {
    rows.push(
      `<div class="row"><span>${escapeHtml(L.change)}</span><span>${escapeHtml(formatRs(pb.change_paisa))}</span></div>`,
    );
  }
  if (pb.party_name) {
    rows.push(
      `<div class="row"><span>${escapeHtml(L.party)}</span><span>${escapeHtml(pb.party_name)}</span></div>`,
    );
  }

  const copyMark = (opts.copyMark ?? '').trim()
    ? `<p class="copy-mark">${escapeHtml(String(opts.copyMark).trim())}</p>`
    : '';

  const noteLine = (opts.noteLine ?? '').trim()
    ? `<p class="meta-top">${escapeHtml(String(opts.noteLine).trim())}</p>`
    : '';

  const footer = payload.receipt_footer
    ? `<p class="footer">${escapeHtml(payload.receipt_footer)}</p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt</title>
<style>
  @page { size: ${widthMm}mm auto; margin: ${widthMm === 58 ? 3 : 4}mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.35;
  }
  .ticket {
    width: ${printableMm}mm;
    max-width: ${widthMm}mm;
    margin: 0;
    padding: 0;
  }
  .store {
    margin: 0 0 4px;
    text-align: center;
    font-size: 14px;
    font-weight: 700;
  }
  .meta-top {
    margin: 0 0 8px;
    text-align: center;
    font-size: 11px;
  }
  .copy-mark {
    margin: -4px 0 8px;
    text-align: center;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 2px;
  }
  .lines {
    border-top: 1px dashed #000;
    border-bottom: 1px dashed #000;
    padding: 6px 0;
    margin-bottom: 6px;
  }
  .line { margin-bottom: 4px; }
  .line-top { display: flex; justify-content: space-between; gap: 8px; font-weight: 600; }
  .meta { font-size: 11px; }
  .row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
  .row.total { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
  .row.tax { font-size: 11px; margin-top: -2px; margin-bottom: 4px; }
  .times { margin-top: 6px; border-top: 1px dashed #000; padding-top: 4px; font-size: 10px; }
  .footer {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px dashed #000;
    text-align: center;
    white-space: pre-wrap;
    font-size: 11px;
  }
</style>
</head>
<body>
  <article class="ticket" data-receipt="true" data-width="${widthMm}">
    <h1 class="store">${escapeHtml(payload.store_name)}</h1>
    <p class="meta-top">${escapeHtml(L.sale)}: ${escapeHtml(payload.sale_id_short)}</p>
    ${noteLine}
    ${copyMark}
    <div class="lines">${linesHtml}</div>
    <div class="totals">${rows.join('\n')}</div>
    <div class="times">
      <div>${escapeHtml(L.clientTime)}: ${escapeHtml(formatTime(payload.client_device_at))}</div>
      ${
        payload.recorded_at
          ? `<div>${escapeHtml(L.recordedTime)}: ${escapeHtml(formatTime(payload.recorded_at))}</div>`
          : ''
      }
    </div>
    ${footer}
  </article>
</body>
</html>`;
}

function printHtmlViaIframe(html: string): Promise<PrintReceiptResult> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve('failed');
      return;
    }
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';

    let settled = false;
    const finish = (result: PrintReceiptResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      try {
        iframe.remove();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const timeout = window.setTimeout(() => finish('failed'), 20_000);

    iframe.onload = () => {
      try {
        const win = iframe.contentWindow;
        if (!win) {
          finish('failed');
          return;
        }
        const onAfter = () => {
          win.removeEventListener('afterprint', onAfter);
          finish('ok');
        };
        win.addEventListener('afterprint', onAfter);
        // Some engines never fire afterprint; resolve shortly after print()
        window.setTimeout(() => finish('ok'), 1500);
        win.focus();
        win.print();
      } catch {
        finish('failed');
      }
    };

    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (!doc) {
      finish('failed');
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
  });
}

/**
 * Print a thermal receipt. Never throws — returns ok/failed.
 * Electron: silent to saved printer name when provided.
 * Browser: OS print dialog via hidden iframe.
 */
export async function printThermalReceipt(
  opts: PrintOpts,
): Promise<PrintReceiptResult> {
  try {
    return await printHtml(buildReceiptPrintHtml(opts), opts.printerName);
  } catch {
    return 'failed';
  }
}

/** Print a ready HTML ticket (receipt, return slip). Never throws. */
export async function printHtml(
  html: string,
  printerName?: string | null,
): Promise<PrintReceiptResult> {
  try {
    const deviceName = (printerName ?? '').trim();
    const bridge = getBridge();
    if (bridge?.printReceipt) {
      const result = await bridge.printReceipt({
        html,
        deviceName: deviceName || undefined,
        silent: Boolean(deviceName),
      });
      return result?.ok ? 'ok' : 'failed';
    }
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      return await printHtmlViaIframe(html);
    }
    return 'failed';
  } catch {
    return 'failed';
  }
}

/** True when Settings has a receipt printer name and print-after-sale is on. */
export function shouldAutoPrintReceipt(opts: {
  printerName?: string | null;
  printEnabled?: boolean | null;
}): boolean {
  const named = Boolean((opts.printerName ?? '').trim());
  // Default on when flag omitted (older payloads); off only when explicitly false.
  const enabled = opts.printEnabled !== false;
  return named && enabled;
}
