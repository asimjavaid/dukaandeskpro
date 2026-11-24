# @dukaandeskpro/db

SQLite schema + migrations for DukaanDesk local system of record.

| Migration | Purpose |
|-----------|---------|
| `001_init.sql` | store, roles (owner/cashier), users, products, tax_documents |
| `002_slice1_auth.sql` | Clear Slice 0 demo stubs; first-run creates Owner + store |
| `003_slice2_stock.sql` | `pieces_per_carton`, `stock_balances`, `stock_receives` ledger |
| `004_slice3_sales.sql` | `sales`, `sale_lines` (cash POS) |
| `005_slice4_parties.sql` | `parties`, `party_ledger`; sales allow `udhaar` + `party_id` |
| `006_slice5_tax.sql` | tax_documents accepted/rejected + disposition; sales `voided_at` / `tax_flagged` |
| `007_slice6_backup.sql` | `audit_log` for Owner backup export |
| `008_slice7_analytics.sql` | indexes for Owner analytics aggregates |
| `012_slice18_cost_expenses.sql` | last unit cost, sale-line cost snapshot, expenses |
| `013_slice19_barcodes.sql` | `products.barcode` unique index + in-store EAN-13 counter |
| `014_slice20_change.sql` | `sales.tendered_paisa` + `sales.change_paisa` |
| `020_slice26_product_discounts.sql` | optional product discount (percent / fixed) with start/end window |

```bash
# from repo root
pnpm db:migrate
# or
SQLITE_PATH=/path/to/dukaandesk.sqlite pnpm --filter @dukaandeskpro/db migrate
```

Nest sidecar runs migrations on boot via this package.
