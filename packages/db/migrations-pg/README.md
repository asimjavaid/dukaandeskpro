PostgreSQL-only migrations for DukaanDesk Pro (046 onwards). P1's 001-045 are squashed into
`src/pg/baseline.sql` (generated). Each file runs in one transaction. Plain PostgreSQL SQL.
