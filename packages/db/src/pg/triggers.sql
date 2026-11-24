-- P1 triggers rewritten in PL/pgSQL (6).
CREATE OR REPLACE FUNCTION dd_trg_extra_barcode_not_primary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE barcode = NEW.barcode) THEN RAISE EXCEPTION 'duplicate_barcode'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_barcodes_no_primary_ins BEFORE INSERT ON product_barcodes FOR EACH ROW EXECUTE FUNCTION dd_trg_extra_barcode_not_primary();
CREATE TRIGGER product_barcodes_no_primary_upd BEFORE UPDATE OF barcode ON product_barcodes FOR EACH ROW EXECUTE FUNCTION dd_trg_extra_barcode_not_primary();

CREATE OR REPLACE FUNCTION dd_trg_primary_barcode_not_extra() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.barcode IS NOT NULL AND EXISTS (SELECT 1 FROM product_barcodes WHERE barcode = NEW.barcode) THEN RAISE EXCEPTION 'duplicate_barcode'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER products_barcode_no_extra_ins BEFORE INSERT ON products FOR EACH ROW EXECUTE FUNCTION dd_trg_primary_barcode_not_extra();
CREATE TRIGGER products_barcode_no_extra_upd BEFORE UPDATE OF barcode ON products FOR EACH ROW EXECUTE FUNCTION dd_trg_primary_barcode_not_extra();

CREATE OR REPLACE FUNCTION dd_trg_price_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.price_paisa IS DISTINCT FROM OLD.price_paisa THEN
    INSERT INTO price_history (id, product_id, old_price_paisa, new_price_paisa, changed_by, changed_at)
    VALUES (lower(hex(randomblob(16))), NEW.id, OLD.price_paisa, NEW.price_paisa, NULL, to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER products_price_history AFTER UPDATE OF price_paisa ON products FOR EACH ROW EXECUTE FUNCTION dd_trg_price_history();

CREATE OR REPLACE FUNCTION dd_trg_users_revoke_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.pin_hash IS DISTINCT FROM OLD.pin_hash OR NEW.disabled_at IS DISTINCT FROM OLD.disabled_at THEN
    NEW.sessions_valid_after := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_revoke_sessions BEFORE UPDATE OF pin_hash, disabled_at ON users FOR EACH ROW EXECUTE FUNCTION dd_trg_users_revoke_sessions();
