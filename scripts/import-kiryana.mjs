#!/usr/bin/env node
/**
 * Import the kiryana starter catalog (priced rows only) into a DukaanDesk DB.
 *
 *   node scripts/import-kiryana.mjs --db <sqlite path> [--images <dir>] [--csv <file>] [--dry-run]
 *
 * Defaults: --db apps/api/data/dukaandesk.sqlite
 *           --csv data/seed/kiryana/kiryana-catalog.csv
 *           --images data/seed/kiryana/images
 * - Runs pending migrations first (needs 030 products.image_file).
 * - One transaction. Skips rows with no price, and rows whose name
 *   (case-insensitive) or barcode already exists. Rerunning adds 0.
 * - Stock 0, cost not set. Sourced barcode if a valid EAN-8/13 and unused,
 *   otherwise an in-store EAN-13 (prefix 20, same counter as the app).
 * - Pictures are copied to <db dir>/product-images/.
 * Stop the API (or close the app) while importing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dbRequire = createRequire(path.join(root, 'packages/db/package.json'));
const Database = dbRequire('better-sqlite3');
const { migrate } = dbRequire('./src/migrate.js');

const UNITS = new Set(['piece', 'packet', 'kg', 'gram', 'litre', 'ml']);

function args() {
  const out = {
    db: path.join(root, 'apps/api/data/dukaandesk.sqlite'),
    csv: path.join(root, 'data/seed/kiryana/kiryana-catalog.csv'),
    images: path.join(root, 'data/seed/kiryana/images'),
    dryRun: false,
  };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--dry-run') out.dryRun = true;
    else if (k === '--db') out.db = path.resolve(a[++i]);
    else if (k === '--csv') out.csv = path.resolve(a[++i]);
    else if (k === '--images') out.images = path.resolve(a[++i]);
    else {
      console.error(`Unknown option ${k}`);
      process.exit(2);
    }
  }
  return out;
}

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((v) => v !== '')) rows.push(row);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function checkDigit(body) {
  const w = body.length === 12 ? [1, 3] : [3, 1];
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[i]) * w[i % 2];
  return (10 - (sum % 10)) % 10;
}
function validEan(code) {
  if (!/^(\d{8}|\d{13})$/.test(code)) return false;
  return checkDigit(code.slice(0, -1)) === Number(code.at(-1));
}
function inStoreEan13(n) {
  const body = `20${String(n).padStart(10, '0')}`;
  return `${body}${checkDigit(body)}`;
}

const opt = args();
if (!fs.existsSync(opt.csv)) {
  console.error(`CSV not found: ${opt.csv}`);
  process.exit(1);
}
if (!fs.existsSync(opt.db)) {
  console.error(`Database not found: ${opt.db}`);
  process.exit(1);
}

if (!opt.dryRun) migrate(opt.db);
const db = new Database(opt.db, { fileMustExist: true });
db.pragma('busy_timeout = 5000');
const hasImageCol = db
  .prepare(`PRAGMA table_info(products)`)
  .all()
  .some((c) => c.name === 'image_file');
if (!hasImageCol && !opt.dryRun) {
  console.error('products.image_file missing after migrate; aborting.');
  process.exit(1);
}

const csvRows = parseCsv(fs.readFileSync(opt.csv, 'utf8'));
const imagesOut = path.join(path.dirname(opt.db), 'product-images');

const counts = {
  csv_rows: csvRows.length,
  no_price: 0,
  bad_row: 0,
  exists_by_name: 0,
  exists_by_barcode: 0,
  dup_in_csv: 0,
  to_add: 0,
  sourced_barcode: 0,
  in_store_barcode: 0,
  sourced_barcode_taken: 0,
  with_image: 0,
  image_missing: 0,
};

const names = new Set(
  db.prepare(`SELECT name FROM products`).all().map((r) => r.name.trim().toLowerCase()),
);
const barcodes = new Set(
  db
    .prepare(`SELECT barcode FROM products WHERE barcode IS NOT NULL AND TRIM(barcode) != ''`)
    .all()
    .map((r) => r.barcode.trim()),
);

// Same rule as CatalogService.bumpSeqFromExisting / allocateBarcode.
let maxSeq = 0;
for (const code of barcodes) {
  const m = /^20(\d{10})\d$/.exec(code);
  if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
}
const seqRow = db.prepare(`SELECT next_n AS n FROM barcode_seq WHERE id = 1`).get();
let nextN = Math.max(seqRow?.n ?? 1, maxSeq + 1);
function allocate() {
  for (;;) {
    const code = inStoreEan13(nextN++);
    if (!barcodes.has(code)) return code;
  }
}

const plan = [];
const seenNames = new Set();
for (const r of csvRows) {
  const name = (r.name ?? '').trim();
  const price = Number(r.price_rs);
  if (!r.price_rs || !Number.isFinite(price) || price <= 0) {
    counts.no_price++;
    continue;
  }
  const unit = (r.unit ?? '').trim().toLowerCase();
  if (!name || name.length > 160 || !UNITS.has(unit)) {
    counts.bad_row++;
    continue;
  }
  const key = name.toLowerCase();
  if (seenNames.has(key)) {
    counts.dup_in_csv++;
    continue;
  }
  seenNames.add(key);
  if (names.has(key)) {
    counts.exists_by_name++;
    continue;
  }
  const sourced = (r.barcode ?? '').trim();
  if (sourced && validEan(sourced) && barcodes.has(sourced)) {
    // Same manufacturer code already on a shop product: treat as existing.
    counts.exists_by_barcode++;
    continue;
  }
  let barcode;
  if (sourced && validEan(sourced)) {
    barcode = sourced;
    counts.sourced_barcode++;
  } else {
    barcode = allocate();
    counts.in_store_barcode++;
  }
  barcodes.add(barcode);
  names.add(key);
  const slug = path.basename(r.image_file || '', '.jpg');
  const imgSrc = slug ? path.join(opt.images, `${slug}.jpg`) : '';
  const hasImg = Boolean(imgSrc && fs.existsSync(imgSrc));
  if (hasImg) counts.with_image++;
  else counts.image_missing++;
  plan.push({
    id: randomUUID(),
    name,
    name_ur: (r.name_ur ?? '').trim() || null,
    unit,
    price_paisa: Math.round(price * 100),
    barcode,
    imgSrc: hasImg ? imgSrc : null,
  });
}
counts.to_add = plan.length;

if (opt.dryRun) {
  console.log(JSON.stringify({ mode: 'dry-run', db: opt.db, ...counts }, null, 2));
  db.close();
  process.exit(0);
}

const insert = db.prepare(
  `INSERT INTO products
     (id, sku, name, name_ur, unit_label, price_paisa, pieces_per_carton,
      last_unit_cost_paisa, barcode, active, image_file)
   VALUES (?, NULL, ?, ?, ?, ?, 1, NULL, ?, 1, ?)`,
);
const written = [];
const run = db.transaction(() => {
  if (plan.length) fs.mkdirSync(imagesOut, { recursive: true });
  for (const p of plan) {
    let file = null;
    if (p.imgSrc) {
      file = `${p.id}-${randomBytes(4).toString('hex')}.jpg`;
      fs.copyFileSync(p.imgSrc, path.join(imagesOut, file));
      written.push(file);
    }
    insert.run(p.id, p.name, p.name_ur, p.unit, p.price_paisa, p.barcode, file);
  }
  db.prepare(`UPDATE barcode_seq SET next_n = ? WHERE id = 1 AND next_n < ?`).run(nextN, nextN);
});
try {
  run();
} catch (err) {
  for (const f of written) {
    try {
      fs.unlinkSync(path.join(imagesOut, f));
    } catch {
      /* ignore */
    }
  }
  console.error(`Import failed, nothing was added: ${err?.message ?? err}`);
  db.close();
  process.exit(1);
}
const total = db.prepare(`SELECT COUNT(*) AS c FROM products`).get().c;
db.close();
console.log(
  JSON.stringify({ mode: 'import', db: opt.db, images_dir: imagesOut, ...counts, added: plan.length, products_now: total }, null, 2),
);
