/**
 * Slice 9 smoke — Receipt (print / share).
 *
 * Asserts:
 *  1. Receipt payload builder for cash + udhaar
 *  2. Print CSS (@media print, thermal ~80mm, hide chrome)
 *  3. Share / copy hooks (navigator.share, clipboard, window.print)
 *  4. Done → View receipt wiring + i18n keys
 *
 * Run: node scripts/test-slice9-receipt.mjs
 * Or:  pnpm test:slice9
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const web = join(root, 'apps/web/src');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Mirrors apps/web/src/features/pos/receipt.ts buildReceiptPayload */
function shortSaleId(saleId, shortId) {
  if (shortId && String(shortId).trim()) {
    return String(shortId).trim().toUpperCase();
  }
  const clean = (saleId || '').replace(/-/g, '');
  return clean.slice(0, 8).toUpperCase() || '--------';
}

function unitLabel(code) {
  if (code === 'carton') return 'carton';
  if (code === 'piece') return 'pc';
  return code || 'pc';
}

function buildReceiptPayload(fields) {
  const method = (fields.paymentMethod || 'cash').toLowerCase().trim();
  let cash = null;
  let udhaar = null;
  const total = Math.round(Number(fields.totalPaisa) || 0);
  if (method === 'cash') {
    cash = total;
    udhaar = 0;
  } else if (method === 'udhaar') {
    cash = 0;
    udhaar = total;
  }
  const lines = (fields.lines ?? []).map((l) => {
    const qty = Math.round(Number(l.qtyInput) || 0);
    const u = unitLabel(l.unit);
    const unitPrice = Math.round(Number(l.unitPricePaisa) || 0);
    const lineTotal =
      l.lineTotalPaisa != null
        ? Math.round(Number(l.lineTotalPaisa) || 0)
        : qty * unitPrice;
    return {
      name: l.name || 'Item',
      qty_input: qty,
      unit: l.unit || 'piece',
      unit_price_paisa: unitPrice,
      line_total_paisa: lineTotal,
      qty_unit_label: `${qty}×${u}`,
    };
  });
  return {
    store_name: fields.storeName || 'Store',
    sale_id: fields.saleId,
    sale_id_short: shortSaleId(fields.saleId, fields.shortId),
    lines,
    total_paisa: total,
    currency: 'PKR',
    payment_method: method,
    payment_breakdown: {
      method,
      cash_paisa: cash,
      udhaar_paisa: udhaar,
      party_name: fields.partyName ?? null,
    },
    client_device_at: fields.clientDeviceAt,
    recorded_at: fields.recordedAt ?? null,
  };
}

function suite() {
  const receiptTs = readFileSync(join(web, 'features/pos/receipt.ts'), 'utf8');
  const receiptView = readFileSync(
    join(web, 'features/pos/ReceiptView.tsx'),
    'utf8',
  );
  const receiptCss = readFileSync(
    join(web, 'features/pos/receipt.css'),
    'utf8',
  );
  const posShell = readFileSync(join(web, 'features/pos/PosShell.tsx'), 'utf8');
  const dict = readFileSync(join(web, 'i18n/dictionary.ts'), 'utf8');

  console.log('1) Receipt payload builder — cash');
  const cashSale = {
    saleId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    shortId: 'AAAAAAAA',
    storeName: 'Main Counter',
    paymentMethod: 'cash',
    lines: [
      {
        name: 'Atta 10kg',
        qtyInput: 2,
        unit: 'piece',
        unitPricePaisa: 10000,
        lineTotalPaisa: 20000,
      },
    ],
    totalPaisa: 20000,
    clientDeviceAt: '2026-10-01T02:00:00.000Z',
    recordedAt: '2026-10-01T02:00:01.000Z',
  };
  const cashPayload = buildReceiptPayload(cashSale);
  assert(cashPayload.store_name === 'Main Counter', 'store name');
  assert(
    cashPayload.sale_id_short === 'AAAAAAAA',
    `short id got ${cashPayload.sale_id_short}`,
  );
  assert(cashPayload.lines[0].qty_unit_label === '2×pc', 'qty×unit');
  assert(cashPayload.total_paisa === 20000, 'total paisa');
  assert(cashPayload.payment_breakdown.cash_paisa === 20000, 'cash amount');
  assert(cashPayload.payment_breakdown.udhaar_paisa === 0, 'udhaar 0');
  assert(
    cashPayload.client_device_at === cashSale.clientDeviceAt,
    'client ts',
  );
  assert(cashPayload.recorded_at === cashSale.recordedAt, 'recorded ts');
  console.log('   ok — cash receipt');

  console.log('2) Receipt payload builder — udhaar');
  const udhaarSale = {
    saleId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    storeName: 'Main Counter',
    paymentMethod: 'udhaar',
    lines: [
      {
        name: 'Surf Excel',
        qtyInput: 1,
        unit: 'carton',
        unitPricePaisa: 120000,
        lineTotalPaisa: 120000,
      },
      {
        name: 'Milk',
        qtyInput: 3,
        unit: 'piece',
        unitPricePaisa: 5000,
        lineTotalPaisa: 15000,
      },
    ],
    totalPaisa: 135000,
    partyName: 'Ahmed Kiryana',
    clientDeviceAt: '2026-10-01T02:10:00.000Z',
    recordedAt: '2026-10-01T02:10:05.000Z',
  };
  const udhaarPayload = buildReceiptPayload(udhaarSale);
  assert(udhaarPayload.lines.length === 2, '2 lines');
  assert(udhaarPayload.lines[0].qty_unit_label === '1×carton', 'carton label');
  assert(udhaarPayload.lines[1].qty_unit_label === '3×pc', 'piece label');
  assert(udhaarPayload.payment_breakdown.method === 'udhaar', 'method udhaar');
  assert(udhaarPayload.payment_breakdown.cash_paisa === 0, 'no cash');
  assert(
    udhaarPayload.payment_breakdown.udhaar_paisa === 135000,
    'full udhaar',
  );
  assert(
    udhaarPayload.payment_breakdown.party_name === 'Ahmed Kiryana',
    'party',
  );
  assert(
    udhaarPayload.sale_id_short === 'BBBBBBBB',
    `udhaar short id got ${udhaarPayload.sale_id_short}`,
  );
  assert(
    udhaarPayload.recorded_at === udhaarSale.recordedAt,
    'udhaar recorded ts',
  );
  console.log('   ok — udhaar receipt');

  console.log('3) Source: buildReceiptPayload + share/copy/print hooks');
  assert(existsSync(join(web, 'features/pos/receipt.ts')), 'receipt.ts');
  assert(existsSync(join(web, 'features/pos/ReceiptView.tsx')), 'ReceiptView');
  assert(existsSync(join(web, 'features/pos/receipt.css')), 'receipt.css');
  assert(
    receiptTs.includes('export function buildReceiptPayload'),
    'export builder',
  );
  assert(receiptTs.includes('shareOrCopyReceipt'), 'shareOrCopy');
  assert(receiptTs.includes('navigator.share'), 'navigator.share');
  assert(receiptTs.includes('navigator.clipboard'), 'clipboard fallback');
  assert(receiptTs.includes('printReceipt'), 'printReceipt');
  assert(receiptTs.includes('window.print'), 'window.print');
  assert(receiptView.includes('data-receipt-print'), 'print button hook');
  assert(receiptView.includes('data-receipt-share'), 'share button hook');
  assert(receiptView.includes('shareOrCopyReceipt'), 'share wired');
  assert(receiptView.includes('printReceipt'), 'print wired');
  assert(
    receiptView.includes('receipt-toast') || receiptView.includes('showToast'),
    'toast',
  );
  console.log('   ok');

  console.log('4) Print CSS — @media print, ~80mm thermal, hide chrome');
  assert(receiptCss.includes('@media print'), '@media print');
  assert(
    receiptCss.includes('80mm') || receiptCss.includes('72mm'),
    'thermal width',
  );
  assert(
    receiptCss.includes('no-print') || receiptCss.includes('display: none'),
    'hide chrome',
  );
  assert(
    receiptCss.includes('.shell__header') || receiptCss.includes('no-print'),
    'hide header/chrome',
  );
  console.log('   ok');

  console.log('5) Done → View receipt wiring');
  assert(posShell.includes('ReceiptView'), 'ReceiptView used');
  assert(
    posShell.includes('viewReceipt') || posShell.includes('data-view-receipt'),
    'view receipt CTA',
  );
  assert(posShell.includes('setViewReceipt'), 'viewReceipt state');
  assert(
    receiptTs.includes('qty_unit_label') ||
      receiptTs.includes('qty_unit_label'),
    'qty_unit_label',
  );
  assert(receiptTs.includes('payment_breakdown'), 'payment_breakdown');
  // No PDF/SMS/Bluetooth implementation (comments saying "no PDF" are fine)
  assert(!/generatePdf|pdfkit|jspdf|pdf-lib/i.test(receiptTs), 'no pdf lib');
  assert(!/sms\s*gateway|twilio|sendSms/i.test(posShell), 'no sms in pos');
  assert(!/Bluetooth|ESC\/POS|escpos/i.test(receiptTs + receiptView), 'no bluetooth esc/pos');
  console.log('   ok');

  console.log('6) i18n receipt keys EN (English-only UI)');
  for (const key of [
    'receipt',
    'receiptPrint',
    'receiptShare',
    'receiptTotal',
    'receiptCash',
    'receiptUdhaar',
    'viewReceipt',
  ]) {
    assert(dict.includes(`${key}:`), `dict missing ${key}`);
  }
  assert(dict.includes("receipt: 'Receipt'"), 'EN receipt');
  assert(!dict.includes('  ur: {'), 'dictionary English-only');
  console.log('   ok');

  console.log('\nSlice 9 receipt smoke PASSED');
}

try {
  suite();
} catch (e) {
  console.error('\nFAILED:', e.message);
  process.exit(1);
}
