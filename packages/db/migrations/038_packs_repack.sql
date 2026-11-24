-- Buying packs (carton/box/bag/bori) per product, remembered per supplier; bulk → packet repacking.
CREATE TABLE IF NOT EXISTS product_packs (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id),
  name        TEXT NOT NULL,
  units       REAL NOT NULL CHECK (units > 0),
  barcode     TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS product_packs_product_idx ON product_packs (product_id, active, sort);
CREATE INDEX IF NOT EXISTS product_packs_barcode_idx ON product_packs (barcode) WHERE barcode IS NOT NULL;

CREATE TABLE IF NOT EXISTS supplier_product_pack (
  supplier_id     TEXT NOT NULL REFERENCES suppliers(id),
  product_id      TEXT NOT NULL REFERENCES products(id),
  pack_id         TEXT REFERENCES product_packs(id),
  pack_units      REAL,
  last_cost_paisa INTEGER,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (supplier_id, product_id)
);

ALTER TABLE purchase_lines ADD COLUMN pack_id TEXT;
ALTER TABLE purchase_lines ADD COLUMN pack_name TEXT;
ALTER TABLE purchase_lines ADD COLUMN pack_units REAL;
ALTER TABLE purchase_lines ADD COLUMN pack_qty REAL;
ALTER TABLE purchase_order_lines ADD COLUMN pack_id TEXT;
ALTER TABLE purchase_order_lines ADD COLUMN pack_name TEXT;
ALTER TABLE purchase_order_lines ADD COLUMN pack_units REAL;
ALTER TABLE purchase_order_lines ADD COLUMN pack_qty REAL;

-- Packet products made from a bulk item; size_qty = bulk qty in one packet.
ALTER TABLE products ADD COLUMN repack_from_id TEXT REFERENCES products(id);
CREATE INDEX IF NOT EXISTS products_repack_from_idx ON products (repack_from_id);

CREATE TABLE IF NOT EXISTS repacks (
  id                   TEXT PRIMARY KEY,
  short_id             TEXT NOT NULL,
  bulk_product_id      TEXT NOT NULL REFERENCES products(id),
  bulk_qty_used        REAL NOT NULL CHECK (bulk_qty_used > 0),
  wastage_qty          REAL NOT NULL DEFAULT 0 CHECK (wastage_qty >= 0),
  bulk_unit_cost_paisa INTEGER NOT NULL DEFAULT 0,
  packing_cost_paisa   INTEGER NOT NULL DEFAULT 0 CHECK (packing_cost_paisa >= 0),
  note                 TEXT,
  created_by           TEXT REFERENCES users(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  voided_at            TEXT,
  voided_by            TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS repacks_created_idx ON repacks (created_at);
CREATE TABLE IF NOT EXISTS repack_lines (
  id              TEXT PRIMARY KEY,
  repack_id       TEXT NOT NULL REFERENCES repacks(id) ON DELETE CASCADE,
  product_id      TEXT NOT NULL REFERENCES products(id),
  packets         REAL NOT NULL CHECK (packets > 0),
  qty_each        REAL NOT NULL CHECK (qty_each > 0),
  unit_cost_paisa INTEGER NOT NULL DEFAULT 0,
  prev_cost_paisa INTEGER
);
CREATE INDEX IF NOT EXISTS repack_lines_repack_idx ON repack_lines (repack_id);

-- Old carton size becomes a Carton pack.
INSERT INTO product_packs (id, product_id, name, units, sort)
SELECT lower(hex(randomblob(16))), id, 'Carton', pieces_per_carton, 0
FROM products WHERE pieces_per_carton > 1;
