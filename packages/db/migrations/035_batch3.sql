-- DukaanDesk Batch 3: loyalty points (earn per Rs, redeem at checkout).

ALTER TABLE store ADD COLUMN loyalty_enabled INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_enabled IN (0, 1));
-- Rs spent for one point (e.g. 100 = 1 point per Rs 100).
ALTER TABLE store ADD COLUMN loyalty_rs_per_point INTEGER NOT NULL DEFAULT 100 CHECK (loyalty_rs_per_point BETWEEN 1 AND 100000);
-- Worth of one point when redeemed (paisa; 100 = Rs 1).
ALTER TABLE store ADD COLUMN loyalty_point_value_paisa INTEGER NOT NULL DEFAULT 100 CHECK (loyalty_point_value_paisa BETWEEN 1 AND 100000);

-- discount_paisa on a sale includes loyalty_redeem_paisa (so returns / profit share it).
ALTER TABLE sales ADD COLUMN loyalty_redeem_points INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_redeem_points >= 0);
ALTER TABLE sales ADD COLUMN loyalty_redeem_paisa INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_redeem_paisa >= 0);
ALTER TABLE sales ADD COLUMN loyalty_earned_points INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_earned_points >= 0);

CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id),
  sale_id TEXT REFERENCES sales(id),
  points INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('earn', 'redeem', 'reverse', 'return')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_loyalty_party ON loyalty_ledger(party_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_sale ON loyalty_ledger(sale_id);
