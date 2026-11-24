import { currentTillId } from '../tills/till-context';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { karachiYmd } from '../suppliers/suppliers.service';

function isYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, day] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === day
  );
}

export type PartyRow = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  store_id: string | null;
  created_at: string;
  balance_paisa: number;
  credit_limit_paisa: number | null;
  loyalty_points: number;
};

export type LedgerEntry = {
  id: string;
  party_id: string;
  entry_type: 'debit' | 'credit';
  amount_paisa: number;
  sale_id: string | null;
  note: string | null;
  collected_on: string | null;
  created_at: string;
};

@Injectable()
export class PartiesService {
  constructor(private readonly db: DbService) {}

  list(): PartyRow[] {
    return this.db.raw
      .prepare(
        `SELECT
           p.id,
           p.name,
           p.phone,
           p.address,
           p.store_id,
           p.created_at,
           p.credit_limit_paisa,
           COALESCE((SELECT SUM(points) FROM loyalty_ledger y WHERE y.party_id = p.id), 0) AS loyalty_points,
           COALESCE((
             SELECT
               SUM(CASE WHEN l.entry_type = 'debit' THEN l.amount_paisa ELSE 0 END)
               - SUM(CASE WHEN l.entry_type = 'credit' THEN l.amount_paisa ELSE 0 END)
             FROM party_ledger l
             WHERE l.party_id = p.id
           ), 0) AS balance_paisa
         FROM parties p
         ORDER BY p.name COLLATE NOCASE ASC`,
      )
      .all() as PartyRow[];
  }

  get(id: string): PartyRow | undefined {
    return this.db.raw
      .prepare(
        `SELECT
           p.id,
           p.name,
           p.phone,
           p.address,
           p.store_id,
           p.created_at,
           p.credit_limit_paisa,
           COALESCE((SELECT SUM(points) FROM loyalty_ledger y WHERE y.party_id = p.id), 0) AS loyalty_points,
           COALESCE((
             SELECT
               SUM(CASE WHEN l.entry_type = 'debit' THEN l.amount_paisa ELSE 0 END)
               - SUM(CASE WHEN l.entry_type = 'credit' THEN l.amount_paisa ELSE 0 END)
             FROM party_ledger l
             WHERE l.party_id = p.id
           ), 0) AS balance_paisa
         FROM parties p
         WHERE p.id = ?`,
      )
      .get(id) as PartyRow | undefined;
  }

  /** Owner: udhaar limit for a customer (null = no limit). */
  setCreditLimit(id: string, raw: unknown): { ok: true; party: PartyRow } | { ok: false; error: string } {
    let lim: number | null = null;
    if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
      const rs = Number(raw);
      if (!Number.isFinite(rs) || rs < 0 || rs > 100_000_000) return { ok: false, error: 'invalid_credit_limit' };
      lim = Math.round(rs * 100);
    }
    const r = this.db.raw
      .prepare(`UPDATE parties SET credit_limit_paisa = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(lim, id);
    if (r.changes !== 1) return { ok: false, error: 'party_not_found' };
    return { ok: true, party: this.get(id)! };
  }

  /** Ledger history for a party, newest first (business date then insert time). */
  ledger(partyId: string): LedgerEntry[] {
    return this.db.raw
      .prepare(
        `SELECT id, party_id, entry_type, amount_paisa, sale_id, note,
                collected_on, created_at
         FROM party_ledger
         WHERE party_id = ?
         ORDER BY COALESCE(collected_on, substr(created_at, 1, 10)) DESC,
                  created_at DESC, rowid DESC`,
      )
      .all(partyId) as LedgerEntry[];
  }

  create(input: {
    name: string;
    phone?: string | null;
    address?: string | null;
    storeId?: string | null;
  }): { ok: true; party: PartyRow } | { ok: false; error: string } {
    const name = (input.name ?? '').trim();
    if (!name) {
      return { ok: false, error: 'name_required' };
    }
    if (name.length > 120) {
      return { ok: false, error: 'name_too_long' };
    }
    const phoneRaw = input.phone != null ? String(input.phone).trim() : '';
    const phone = phoneRaw.length > 0 ? phoneRaw.slice(0, 32) : null;
    const addressRaw =
      input.address != null ? String(input.address).trim() : '';
    const address = addressRaw.length > 0 ? addressRaw.slice(0, 240) : null;

    const id = randomUUID();
    this.db.raw
      .prepare(
        `INSERT INTO parties (id, store_id, name, phone, address)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.storeId ?? null, name, phone, address);

    const party = this.get(id);
    if (!party) {
      return { ok: false, error: 'create_failed' };
    }
    return { ok: true, party };
  }

  update(input: {
    id: string;
    name: string;
    phone?: string | null;
    address?: string | null;
  }): { ok: true; party: PartyRow } | { ok: false; error: string } {
    const existing = this.get(input.id);
    if (!existing) {
      return { ok: false, error: 'party_not_found' };
    }
    const name = (input.name ?? '').trim();
    if (!name) {
      return { ok: false, error: 'name_required' };
    }
    if (name.length > 120) {
      return { ok: false, error: 'name_too_long' };
    }
    const phoneRaw = input.phone != null ? String(input.phone).trim() : '';
    const phone = phoneRaw.length > 0 ? phoneRaw.slice(0, 32) : null;
    const addressRaw =
      input.address != null ? String(input.address).trim() : '';
    const address = addressRaw.length > 0 ? addressRaw.slice(0, 240) : null;

    this.db.raw
      .prepare(
        `UPDATE parties
         SET name = ?, phone = ?, address = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(name, phone, address, input.id);

    const party = this.get(input.id);
    if (!party) {
      return { ok: false, error: 'create_failed' };
    }
    return { ok: true, party };
  }

  /** Balance in paisa: debits − credits. */
  balancePaisa(partyId: string): number {
    const row = this.db.raw
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN amount_paisa ELSE 0 END), 0)
           - COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount_paisa ELSE 0 END), 0)
           AS balance_paisa
         FROM party_ledger
         WHERE party_id = ?`,
      )
      .get(partyId) as { balance_paisa: number };
    return row?.balance_paisa ?? 0;
  }

  /**
   * Record a cash collection (udhaar pay-in): append-only ledger credit
   * with sale_id null. Refuses amount ≤ 0 and amount > current balance.
   * collectedOn is the shop-day date (Asia/Karachi YYYY-MM-DD); defaults to today.
   */
  recordCollection(input: {
    partyId: string;
    amountPaisa: number;
    note?: string | null;
    collectedOn?: string | null;
  }):
    | { ok: true; entry: LedgerEntry; party: PartyRow }
    | {
        ok: false;
        error:
          | 'party_not_found'
          | 'amount_invalid'
          | 'amount_exceeds_balance'
          | 'invalid_date'
          | 'create_failed';
        balance_paisa?: number;
      } {
    const party = this.get(input.partyId);
    if (!party) {
      return { ok: false, error: 'party_not_found' };
    }

    const amount = Number(input.amountPaisa);
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
      return { ok: false, error: 'amount_invalid' };
    }

    const balance = party.balance_paisa;
    if (amount > balance) {
      return {
        ok: false,
        error: 'amount_exceeds_balance',
        balance_paisa: balance,
      };
    }

    const rawDate =
      input.collectedOn != null ? String(input.collectedOn).trim() : '';
    const collectedOn = rawDate || karachiYmd();
    if (!isYmd(collectedOn)) {
      return { ok: false, error: 'invalid_date' };
    }

    const noteRaw =
      input.note != null ? String(input.note).trim().slice(0, 240) : '';
    const note = noteRaw.length > 0 ? noteRaw : null;
    const id = randomUUID();

    const run = this.db.raw.transaction(() => {
      this.db.raw
        .prepare(
          `INSERT INTO party_ledger
             (till_id, id, party_id, entry_type, amount_paisa, sale_id, note, collected_on)
           VALUES (?, ?, ?, 'credit', ?, NULL, ?, ?)`,
        )
        .run(currentTillId() ?? 'till-1', id, input.partyId, amount, note, collectedOn);
    });
    run();

    const entry = this.db.raw
      .prepare(
        `SELECT id, party_id, entry_type, amount_paisa, sale_id, note,
                collected_on, created_at
         FROM party_ledger WHERE id = ?`,
      )
      .get(id) as LedgerEntry | undefined;
    const updated = this.get(input.partyId);
    if (!entry || !updated) {
      return { ok: false, error: 'create_failed' };
    }
    return { ok: true, entry, party: updated };
  }
}
