import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { parseMoneyPair } from '../common/amount';
import { ListPage } from '../common/list-page';
import {
  ensureNoSupplier as insertNoSupplier,
  NO_SUPPLIER_ID,
} from './system-supplier';
import { DbService } from '../db/db.service';

const TIMEZONE = 'Asia/Karachi';

export function karachiYmd(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

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

export type SupplierRow = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  address: string | null;
  due_paisa: number;
  given_paisa: number;
  balance_paisa: number;
};

export type SupplierPayment = {
  id: string;
  amount_paisa: number;
  paid_on: string;
  note: string | null;
  created_at: string;
};

export type SupplierInvoice = {
  id: string;
  purchased_on: string;
  total_paisa: number;
  paid_paisa: number;
  due_paisa: number;
};

const LIST_SQL = `
  SELECT
    s.id,
    s.name,
    s.contact_name,
    s.phone,
    s.address,
    COALESCE(d.due, 0) AS due_paisa,
    COALESCE(g.given, 0) AS given_paisa
  FROM suppliers s
  LEFT JOIN (
    SELECT supplier_id, SUM(due) AS due FROM (
      SELECT supplier_id, SUM(amount_paisa) AS due
      FROM stock_receives
      WHERE supplier_id IS NOT NULL
        AND paid_now = 0
        AND amount_paisa IS NOT NULL
        AND purchase_invoice_id IS NULL
      GROUP BY supplier_id
      UNION ALL
      SELECT supplier_id, SUM(due_paisa) AS due
      FROM purchase_invoices
      GROUP BY supplier_id
    )
    GROUP BY supplier_id
  ) d ON d.supplier_id = s.id
  LEFT JOIN (
    -- Payments and goods sent back both reduce what we owe.
    SELECT supplier_id, SUM(given) AS given FROM (
      SELECT supplier_id, SUM(amount_paisa) AS given FROM supplier_payments GROUP BY supplier_id
      UNION ALL
      SELECT supplier_id, SUM(total_paisa) AS given FROM supplier_returns GROUP BY supplier_id
    ) GROUP BY supplier_id
  ) g ON g.supplier_id = s.id
  WHERE s.active = 1
`;

type RawRow = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  address: string | null;
  due_paisa: number;
  given_paisa: number;
};

function withBalance(row: RawRow): SupplierRow {
  const due = Number(row.due_paisa) || 0;
  const given = Number(row.given_paisa) || 0;
  return {
    id: row.id,
    name: row.name,
    contact_name: row.contact_name ?? null,
    phone: row.phone ?? null,
    address: row.address ?? null,
    due_paisa: due,
    given_paisa: given,
    balance_paisa: due - given,
  };
}

@Injectable()
export class SuppliersService {
  constructor(private readonly db: DbService) {}

  ensureNoSupplier(): void {
    insertNoSupplier(this.db.raw);
  }

  list(paging?: ListPage | null): {
    items: SupplierRow[];
    total: number;
    page?: number;
    pageSize?: number;
    today: string;
  } {
    this.ensureNoSupplier();
    const totalRow = this.db.raw
      .prepare(`SELECT COUNT(*) AS c FROM suppliers WHERE active = 1`)
      .get() as { c: number };
    let sql = `${LIST_SQL} ORDER BY s.name COLLATE NOCASE ASC`;
    const args: number[] = [];
    if (paging) {
      sql += ' LIMIT ? OFFSET ?';
      args.push(paging.pageSize, (paging.page - 1) * paging.pageSize);
    }
    const rows = this.db.raw.prepare(sql).all(...args) as RawRow[];
    return {
      items: rows.map(withBalance),
      total: Number(totalRow?.c ?? 0),
      page: paging?.page,
      pageSize: paging?.pageSize,
      today: karachiYmd(),
    };
  }

  get(id: string):
    | {
        ok: true;
        supplier: SupplierRow;
        payments: SupplierPayment[];
        invoices: SupplierInvoice[];
        returns: unknown[];
        today: string;
      }
    | { ok: false; error: 'supplier_not_found' } {
    const row = this.db.raw
      .prepare(`${LIST_SQL} AND s.id = ?`)
      .get(id) as RawRow | undefined;
    if (!row) return { ok: false, error: 'supplier_not_found' };
    const payments = this.db.raw
      .prepare(
        `SELECT id, amount_paisa, paid_on, note, created_at
         FROM supplier_payments
         WHERE supplier_id = ?
         ORDER BY paid_on DESC, created_at DESC
         LIMIT 200`,
      )
      .all(id) as SupplierPayment[];
    const invoices = this.db.raw
      .prepare(
        `SELECT id, purchased_on, total_paisa, paid_paisa, due_paisa
         FROM purchase_invoices
         WHERE supplier_id = ?
         ORDER BY purchased_on DESC, created_at DESC
         LIMIT 200`,
      )
      .all(id) as SupplierInvoice[];
    const returns = this.db.raw
      .prepare(
        `SELECT id, short_id, total_paisa, note, returned_on, created_at
         FROM supplier_returns WHERE supplier_id = ? ORDER BY created_at DESC LIMIT 200`,
      )
      .all(id);
    return {
      ok: true,
      supplier: withBalance(row),
      payments,
      invoices,
      returns,
      today: karachiYmd(),
    };
  }

  create(input: {
    name?: string;
    contact_name?: string | null;
    phone?: string | null;
    address?: string | null;
  }):
    | { ok: true; supplier: SupplierRow }
    | { ok: false; error: 'invalid_name' } {
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 120) return { ok: false, error: 'invalid_name' };
    const contactRaw = String(input.contact_name ?? '').trim();
    const contact_name = contactRaw ? contactRaw.slice(0, 120) : null;
    const phoneRaw = String(input.phone ?? '').trim();
    const phone = phoneRaw ? phoneRaw.slice(0, 32) : null;
    const addressRaw = String(input.address ?? '').trim();
    const address = addressRaw ? addressRaw.slice(0, 240) : null;
    const id = randomUUID();
    this.db.raw
      .prepare(
        `INSERT INTO suppliers (id, name, contact_name, phone, address, active)
         VALUES (?, ?, ?, ?, ?, 1)`,
      )
      .run(id, name, contact_name, phone, address);
    const got = this.get(id);
    if (!got.ok) return { ok: false, error: 'invalid_name' };
    return { ok: true, supplier: got.supplier };
  }


  update(
    id: string,
    input: {
      name?: string;
      contact_name?: string | null;
      phone?: string | null;
      address?: string | null;
    },
  ):
    | { ok: true; supplier: SupplierRow }
    | {
        ok: false;
        error:
          | 'supplier_not_found'
          | 'invalid_name'
          | 'supplier_reserved'
          | 'supplier_system_locked';
      } {
    if (id === NO_SUPPLIER_ID) {
      return { ok: false, error: 'supplier_system_locked' };
    }
    const existing = this.db.raw
      .prepare(`SELECT id, name FROM suppliers WHERE id = ? AND active = 1`)
      .get(id) as { id: string; name: string } | undefined;
    if (!existing) return { ok: false, error: 'supplier_not_found' };

    const name = String(input.name ?? '').trim();
    if (!name || name.length > 120) return { ok: false, error: 'invalid_name' };
    const lower = name.toLowerCase();
    if (lower === 'no supplier' || lower === 'کوئی سپلائر نہیں') {
      return { ok: false, error: 'supplier_reserved' };
    }
    const contactRaw = String(input.contact_name ?? '').trim();
    const contact_name = contactRaw ? contactRaw.slice(0, 120) : null;
    const phoneRaw = String(input.phone ?? '').trim();
    const phone = phoneRaw ? phoneRaw.slice(0, 32) : null;
    const addressRaw = String(input.address ?? '').trim();
    const address = addressRaw ? addressRaw.slice(0, 240) : null;

    this.db.raw
      .prepare(
        `UPDATE suppliers
         SET name = ?, contact_name = ?, phone = ?, address = ?,
             updated_at = datetime('now')
         WHERE id = ? AND active = 1`,
      )
      .run(name, contact_name, phone, address, id);

    const got = this.get(id);
    if (!got.ok) return { ok: false, error: 'supplier_not_found' };
    return { ok: true, supplier: got.supplier };
  }

  pay(
    id: string,
    input: { amountRs?: unknown; amountPaisa?: unknown; paidOn?: string; note?: string | null },
  ):
    | { ok: true; supplier: SupplierRow; payment: SupplierPayment }
    | { ok: false; error: string } {
    const existing = this.db.raw
      .prepare(`SELECT id FROM suppliers WHERE id = ? AND active = 1`)
      .get(id) as { id: string } | undefined;
    if (!existing) return { ok: false, error: 'supplier_not_found' };

    const parsed = parseMoneyPair(input.amountPaisa, input.amountRs, 'missing');
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const amountPaisa = parsed.paisa;
    if (amountPaisa <= 0) return { ok: false, error: 'invalid_amount' };

    const rawDate = String(input.paidOn ?? '').trim();
    const paidOn = rawDate || karachiYmd();
    if (!isYmd(paidOn)) return { ok: false, error: 'invalid_date' };

    const noteRaw = String(input.note ?? '').trim();
    const note = noteRaw ? noteRaw.slice(0, 240) : null;
    const paymentId = randomUUID();

    const outcome = this.db.raw.transaction(() => {
      const due = this.db.raw
        .prepare(
          `SELECT
             COALESCE((
               SELECT SUM(amount_paisa) FROM stock_receives
               WHERE supplier_id = ?
                 AND paid_now = 0
                 AND amount_paisa IS NOT NULL
                 AND purchase_invoice_id IS NULL
             ), 0)
             + COALESCE((
               SELECT SUM(due_paisa) FROM purchase_invoices WHERE supplier_id = ?
             ), 0) AS n`,
        )
        .get(id, id) as { n: number };
      const given = this.db.raw
        .prepare(
          `SELECT COALESCE((SELECT SUM(amount_paisa) FROM supplier_payments WHERE supplier_id = ?), 0)
                + COALESCE((SELECT SUM(total_paisa) FROM supplier_returns WHERE supplier_id = ?), 0) AS n`,
        )
        .get(id, id) as { n: number };
      const balance = Number(due.n) - Number(given.n);
      if (amountPaisa > balance) return 'too_large' as const;
      this.db.raw
        .prepare(
          `INSERT INTO supplier_payments
             (id, supplier_id, amount_paisa, paid_on, note)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(paymentId, id, amountPaisa, paidOn, note);
      return 'ok' as const;
    })();

    if (outcome === 'too_large') {
      return { ok: false, error: 'payment_too_large' };
    }
    const got = this.get(id);
    if (!got.ok) return got;
    const payment = got.payments.find((p) => p.id === paymentId);
    if (!payment) return { ok: false, error: 'supplier_not_found' };
    return { ok: true, supplier: got.supplier, payment };
  }
}
