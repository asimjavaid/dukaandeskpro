# Running DukaanDesk Pro on PostgreSQL (dev)

Box dev server: PostgreSQL 17.11 portable binaries in `/workspace/pgdev` (port 5433, 127.0.0.1, trust auth).

```bash
/workspace/pgdev/start.sh
# API on a real database
DATABASE_URL=postgres://postgres@127.0.0.1:5433/dukaandeskpro_dev pnpm dev:api
# all P1 API tests on PostgreSQL (each test gets its own throw-away database ddp_<hash>)
API_PORT=4900 DD_PG_DEBUG=1 node scripts/run-all-tests.mjs pg
# same tests on legacy SQLite for comparison
API_PORT=5200 node scripts/run-all-tests.mjs sqlite
# import a P1 shop database into an empty Lite database
DATABASE_URL=postgres://postgres@127.0.0.1:5433/<empty_db> node tools/import-p1/import-p1.cjs path/to/dukaandesk.sqlite
# regenerate the PostgreSQL baseline after touching P1-era migrations
DD_REAL_SQLITE=1 node packages/db/src/pg/build-baseline.js
```

`DD_PG_DEBUG=1` prints the translated SQL for any statement PostgreSQL rejects.
Drop leftover test databases: `SELECT 'DROP DATABASE ' || datname || ';' FROM pg_database WHERE datname LIKE 'ddp_%';`

# pg_dump / pg_restore (full copies)
The API runs pg_dump/pg_restore for `.ddpro` full copies. On the dev box they come from
`/workspace/pgclient` (postgresql-client-17 + libpq5 debs extracted; the apt mirror is broken).
- `DD_PG_BIN`  folder with pg_dump/pg_restore (default: PATH)
- `DD_PG_LIB`  extra library folder (LD_LIBRARY_PATH on Linux, PATH on Windows)
- `DD_BACKUP_DIR` default backup folder; when set, daily copies (keep 14) switch on at first boot
`scripts/run-all-tests.mjs` sets DD_PG_BIN/DD_PG_LIB automatically when /workspace/pgclient exists.
