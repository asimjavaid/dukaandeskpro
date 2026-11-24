/**
 * Read the first sheet of an .xlsx or a .csv file into rows of strings.
 * No library: .xlsx is a zip of XML (DecompressionStream inflates it).
 */

export async function readSheetFile(file: File): Promise<string[][]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) return readXlsx(buf);
  return parseCsv(new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, ''));
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const delim = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

type ZipEntry = { name: string; method: number; offset: number; csize: number };

function zipEntries(b: Uint8Array): ZipEntry[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('bad_file');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true);
    const el = dv.getUint16(p + 30, true);
    const cl = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    out.push({ name: dec.decode(b.subarray(p + 46, p + 46 + nl)), method, offset, csize });
    p += 46 + nl + el + cl;
  }
  return out;
}

async function entryText(b: Uint8Array, e: ZipEntry): Promise<string> {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const nl = dv.getUint16(e.offset + 26, true);
  const el = dv.getUint16(e.offset + 28, true);
  const start = e.offset + 30 + nl + el;
  const data = b.slice(start, start + e.csize);
  if (e.method === 0) return new TextDecoder().decode(data);
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Response(stream).text();
}

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readXlsx(b: Uint8Array): Promise<string[][]> {
  const entries = zipEntries(b);
  const find = (name: string) => entries.find((e) => e.name === name);
  const parser = new DOMParser();
  const shared: string[] = [];
  const ss = find('xl/sharedStrings.xml');
  if (ss) {
    const doc = parser.parseFromString(await entryText(b, ss), 'application/xml');
    for (const si of Array.from(doc.getElementsByTagName('si'))) {
      shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''));
    }
  }
  const sheet =
    find('xl/worksheets/sheet1.xml') ??
    entries.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).sort((a, b2) => a.name.localeCompare(b2.name))[0];
  if (!sheet) throw new Error('bad_file');
  const doc = parser.parseFromString(await entryText(b, sheet), 'application/xml');
  const rows: string[][] = [];
  for (const r of Array.from(doc.getElementsByTagName('row'))) {
    const row: string[] = [];
    for (const c of Array.from(r.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r') ?? '';
      const idx = ref ? colIndex(ref) : row.length;
      const type = c.getAttribute('t');
      let v = '';
      if (type === 'inlineStr') v = Array.from(c.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('');
      else {
        const raw = c.getElementsByTagName('v')[0]?.textContent ?? '';
        v = type === 's' ? (shared[Number(raw)] ?? '') : raw;
      }
      while (row.length < idx) row.push('');
      row[idx] = v;
    }
    if (row.some((x) => x.trim() !== '')) rows.push(row);
  }
  return rows;
}

const HEADERS: Record<string, string> = {
  name: 'name', item: 'name', product: 'name', productname: 'name', itemname: 'name', nameen: 'name',
  nameur: 'name_ur', urdu: 'name_ur', urduname: 'name_ur',
  price: 'price', saleprice: 'price', rate: 'price', mrp: 'price', sellingprice: 'price', pricers: 'price',
  barcode: 'barcode', code: 'barcode', ean: 'barcode',
  unit: 'unit', uom: 'unit',
  cost: 'cost', costprice: 'cost', purchaseprice: 'cost', buyprice: 'cost',
  stock: 'stock', qty: 'stock', quantity: 'stock', openingstock: 'stock', onhand: 'stock',
  reorder: 'reorder', reorderlevel: 'reorder', minstock: 'reorder', min: 'reorder',
  piecespercarton: 'pieces_per_carton', carton: 'pieces_per_carton', ctn: 'pieces_per_carton',
};

/** First row = headers; returns objects keyed by our import field names. */
export function rowsToImport(rows: string[][]): { rows: Record<string, string>[]; columns: string[] } {
  if (rows.length < 2) return { rows: [], columns: [] };
  const map = rows[0].map((h) => HEADERS[h.toLowerCase().replace(/[^a-z]/g, '')] ?? '');
  const out = rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    map.forEach((k, i) => {
      if (k && o[k] == null) o[k] = String(r[i] ?? '').trim();
    });
    return o;
  });
  return { rows: out, columns: map.filter(Boolean) };
}
