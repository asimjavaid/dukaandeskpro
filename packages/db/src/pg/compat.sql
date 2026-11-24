-- DukaanDesk Lite — PostgreSQL compatibility layer for SQL inherited from P1 (SQLite dialect).
-- The translator (translate.js) renames date(), datetime(), time(), strftime(), julianday() to sqlite_*.
-- Times are stored as TEXT exactly like P1 ('YYYY-MM-DD HH:MM:SS' UTC, or ISO strings with Z).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION sqlite_parse_ts(v text) RETURNS timestamp LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  IF lower(v) = 'now' THEN RETURN (clock_timestamp() AT TIME ZONE 'UTC'); END IF;
  IF v ~ '([zZ]|[+-]\d\d:?\d\d)$' AND v ~ '\d[ T]\d' THEN RETURN (v::timestamptz AT TIME ZONE 'UTC'); END IF;
  RETURN v::timestamp;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION sqlite_apply_mod(ts timestamp, m text) RETURNS timestamp LANGUAGE plpgsql STABLE AS $$
DECLARE mm text := lower(trim(m)); n numeric; u text; tz text;
BEGIN
  IF ts IS NULL OR m IS NULL THEN RETURN NULL; END IF;
  tz := coalesce(nullif(current_setting('dd.tz', true), ''), 'UTC');
  IF mm ~ '^[+-]?\d+(\.\d+)?\s+[a-z]+$' THEN
    n := substring(mm from '^([+-]?\d+(?:\.\d+)?)')::numeric;
    u := regexp_replace(substring(mm from '([a-z]+)$'), 's$', '');
    IF u IN ('day','hour','minute','second') THEN RETURN ts + (n || ' ' || u)::interval; END IF;
    IF u IN ('month','year') THEN RETURN ts + (n::int || ' ' || u)::interval; END IF;
    RETURN NULL;
  ELSIF mm = 'start of day' THEN RETURN date_trunc('day', ts);
  ELSIF mm = 'start of month' THEN RETURN date_trunc('month', ts);
  ELSIF mm = 'start of year' THEN RETURN date_trunc('year', ts);
  ELSIF mm = 'localtime' THEN RETURN (ts AT TIME ZONE 'UTC') AT TIME ZONE tz;
  ELSIF mm = 'utc' THEN RETURN (ts AT TIME ZONE tz) AT TIME ZONE 'UTC';
  ELSIF mm ~ '^weekday \d$' THEN
    RETURN ts + ((((substring(mm from '\d')::int) - extract(dow from ts)::int) + 7) % 7 || ' days')::interval;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION sqlite_ts(v text, mods text[]) RETURNS timestamp LANGUAGE plpgsql STABLE AS $$
DECLARE ts timestamp := sqlite_parse_ts(v); m text;
BEGIN
  IF mods IS NOT NULL THEN FOREACH m IN ARRAY mods LOOP ts := sqlite_apply_mod(ts, m); END LOOP; END IF;
  RETURN ts;
END $$;

CREATE OR REPLACE FUNCTION sqlite_datetime(v text, VARIADIC mods text[] DEFAULT '{}') RETURNS text LANGUAGE sql STABLE AS
$$ SELECT to_char(sqlite_ts(v, mods), 'YYYY-MM-DD HH24:MI:SS') $$;
CREATE OR REPLACE FUNCTION sqlite_date(v text, VARIADIC mods text[] DEFAULT '{}') RETURNS text LANGUAGE sql STABLE AS
$$ SELECT to_char(sqlite_ts(v, mods), 'YYYY-MM-DD') $$;
CREATE OR REPLACE FUNCTION sqlite_time(v text, VARIADIC mods text[] DEFAULT '{}') RETURNS text LANGUAGE sql STABLE AS
$$ SELECT to_char(sqlite_ts(v, mods), 'HH24:MI:SS') $$;
CREATE OR REPLACE FUNCTION sqlite_julianday(v text, VARIADIC mods text[] DEFAULT '{}') RETURNS double precision LANGUAGE sql STABLE AS
$$ SELECT extract(epoch FROM sqlite_ts(v, mods))::double precision / 86400.0 + 2440587.5 $$;

CREATE OR REPLACE FUNCTION sqlite_strftime(fmt text, v text, VARIADIC mods text[] DEFAULT '{}') RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE ts timestamp := sqlite_ts(v, mods); out text := ''; i int := 1; c text;
BEGIN
  IF ts IS NULL OR fmt IS NULL THEN RETURN NULL; END IF;
  WHILE i <= length(fmt) LOOP
    c := substr(fmt, i, 1);
    IF c = '%' AND i < length(fmt) THEN
      i := i + 1; c := substr(fmt, i, 1);
      out := out || CASE c
        WHEN 'Y' THEN to_char(ts, 'YYYY') WHEN 'm' THEN to_char(ts, 'MM') WHEN 'd' THEN to_char(ts, 'DD')
        WHEN 'H' THEN to_char(ts, 'HH24') WHEN 'M' THEN to_char(ts, 'MI') WHEN 'S' THEN to_char(ts, 'SS')
        WHEN 'f' THEN to_char(ts, 'SS.MS') WHEN 'j' THEN to_char(ts, 'DDD') WHEN 'w' THEN extract(dow FROM ts)::int::text
        WHEN 's' THEN floor(extract(epoch FROM ts))::bigint::text WHEN 'W' THEN to_char(ts, 'IW') WHEN '%' THEN '%'
        ELSE '%' || c END;
    ELSE out := out || c; END IF;
    i := i + 1;
  END LOOP;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION randomblob(n integer) RETURNS bytea LANGUAGE sql VOLATILE AS $$ SELECT gen_random_bytes(greatest(1, least(n, 1024))) $$;
CREATE OR REPLACE FUNCTION hex(b bytea) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT upper(encode(b, 'hex')) $$;
CREATE OR REPLACE FUNCTION hex(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT upper(encode(convert_to(t, 'UTF8'), 'hex')) $$;
CREATE OR REPLACE FUNCTION round(x double precision, d integer) RETURNS double precision LANGUAGE sql IMMUTABLE AS
$$ SELECT round(x::numeric, d)::double precision $$;
CREATE OR REPLACE FUNCTION ifnull(a anycompatible, b anycompatible) RETURNS anycompatible LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(a, b) $$;

-- json_group_array(x) -> JSON array text ('[]' for no rows), like SQLite.
CREATE OR REPLACE FUNCTION dd_arr_json(a anycompatiblearray) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce(array_to_json(a)::text, '[]') $$;
DROP AGGREGATE IF EXISTS json_group_array(anycompatible);
CREATE AGGREGATE json_group_array(anycompatible) (sfunc = array_append, stype = anycompatiblearray, finalfunc = dd_arr_json, initcond = '{}');

CREATE OR REPLACE FUNCTION dd_gc(s text, v text, sep text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE WHEN v IS NULL THEN s WHEN s IS NULL THEN v ELSE s || sep || v END $$;
CREATE OR REPLACE FUNCTION dd_gc1(s text, v text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT dd_gc(s, v, ',') $$;
DROP AGGREGATE IF EXISTS group_concat(text, text);
DROP AGGREGATE IF EXISTS group_concat(text);
CREATE AGGREGATE group_concat(text, text) (sfunc = dd_gc, stype = text);
CREATE AGGREGATE group_concat(text) (sfunc = dd_gc1, stype = text);
DROP AGGREGATE IF EXISTS total(double precision);
CREATE AGGREGATE total(double precision) (sfunc = float8pl, stype = double precision, initcond = '0');

-- Read-only stand-ins for SQLite catalog lookups used by P1 tools/tests.
CREATE OR REPLACE VIEW sqlite_master AS
  SELECT 'table'::text AS type, table_name::text AS name, table_name::text AS tbl_name, NULL::text AS sql
    FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
  UNION ALL
  SELECT 'index', indexname::text, tablename::text, indexdef::text FROM pg_indexes WHERE schemaname = current_schema()
  UNION ALL
  SELECT 'trigger', tgname::text, c.relname::text, NULL FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = current_schema();
CREATE OR REPLACE FUNCTION pragma_table_info(t text)
  RETURNS TABLE (cid bigint, name text, type text, "notnull" bigint, dflt_value text, pk bigint) LANGUAGE sql STABLE AS $$
  SELECT (c.ordinal_position - 1)::bigint, c.column_name::text, upper(c.data_type)::text,
         CASE WHEN c.is_nullable = 'NO' THEN 1 ELSE 0 END::bigint, c.column_default::text,
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k
                             ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
                           WHERE tc.table_schema = current_schema() AND tc.table_name = t AND tc.constraint_type = 'PRIMARY KEY'
                             AND k.column_name = c.column_name) THEN 1 ELSE 0 END::bigint
    FROM information_schema.columns c
   WHERE c.table_schema = current_schema() AND c.table_name = t AND c.column_name <> 'rowid'
   ORDER BY c.ordinal_position $$;

-- SQLite treats comparisons as 0/1 integers, so SUM(x IS NULL) / SUM(a > b) are common. Give PostgreSQL the same.
CREATE OR REPLACE FUNCTION dd_bool_sum_step(acc bigint, v boolean) RETURNS bigint LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE WHEN v IS NULL THEN acc ELSE COALESCE(acc, 0) + (CASE WHEN v THEN 1 ELSE 0 END) END $$;
CREATE OR REPLACE AGGREGATE sum(boolean) (SFUNC = dd_bool_sum_step, STYPE = bigint);
