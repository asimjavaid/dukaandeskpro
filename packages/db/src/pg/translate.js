'use strict';
/**
 * SQLite-dialect SQL (as written for P1 / better-sqlite3) -> PostgreSQL SQL.
 * Parameters are bound client-side as escaped literals (keeps SQLite's loose typing working:
 * quoted strings are 'unknown' typed in PG and adopt the column's type).
 */

const WORD = /[A-Za-z_][A-Za-z0-9_$]*/y;

function tokenize(sql) {
  const out = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const start = i;
    if (/\s/.test(c)) {
      while (i < n && /\s/.test(sql[i])) i++;
      out.push({ t: 'ws', v: sql.slice(start, i) });
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      out.push({ t: 'ws', v: ' ' });
    } else if (c === '/' && sql[i + 1] === '*') {
      const e = sql.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      out.push({ t: 'ws', v: ' ' });
    } else if (c === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      out.push({ t: 'str', v: sql.slice(start, i) });
    } else if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      i++;
      while (i < n && sql[i] !== close) i++;
      i++;
      out.push({ t: 'qid', v: '"' + sql.slice(start + 1, i - 1).replace(/"/g, '""') + '"' });
    } else if (c === '?') {
      i++;
      while (i < n && /[0-9]/.test(sql[i])) i++;
      out.push({ t: 'param', v: sql.slice(start, i) });
    } else if ((c === '@' || c === ':' || c === '$') && /[A-Za-z_]/.test(sql[i + 1] || '')) {
      i++;
      WORD.lastIndex = i;
      const m = WORD.exec(sql);
      i += m[0].length;
      out.push({ t: 'param', v: sql.slice(start, i) });
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] || ''))) {
      while (i < n && /[0-9.eE]/.test(sql[i])) {
        if ((sql[i] === 'e' || sql[i] === 'E') && /[+-]/.test(sql[i + 1] || '')) i++;
        i++;
      }
      out.push({ t: 'num', v: sql.slice(start, i) });
    } else if (/[A-Za-z_]/.test(c)) {
      WORD.lastIndex = i;
      const m = WORD.exec(sql);
      i += m[0].length;
      out.push({ t: 'word', v: m[0] });
    } else {
      // multi-char operators we care about
      const two = sql.slice(i, i + 2);
      if (['||', '<=', '>=', '<>', '!=', '=='].includes(two)) { i += 2; out.push({ t: 'op', v: two === '==' ? '=' : two }); }
      else { i++; out.push({ t: 'op', v: c }); }
    }
  }
  return out;
}

function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? (Object.is(v, -0) ? '0' : String(v)) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return `'\\x${Buffer.from(v).toString('hex')}'::bytea`;
  if (v instanceof Date) v = v.toISOString();
  else if (typeof v === 'object') v = JSON.stringify(v);
  return "'" + String(v).replace(/\u0000/g, '').replace(/'/g, "''") + "'";
}

/** better-sqlite3 binding rules: positional args (spread or array) + at most one plain object for named params. */
function normalizeParams(args) {
  const pos = [];
  let named = null;
  for (const a of args) {
    if (Array.isArray(a)) pos.push(...a);
    else if (a && typeof a === 'object' && !Buffer.isBuffer(a) && !(a instanceof Date) && !(a instanceof Uint8Array)) named = { ...(named || {}), ...a };
    else pos.push(a);
  }
  return { pos, named };
}

const NO_IS_REWRITE = new Set(['NULL', 'NOT', 'TRUE', 'FALSE', 'DISTINCT', 'UNKNOWN']);
const DATE_FNS = new Set(['date', 'datetime', 'time', 'strftime', 'julianday']);

function upper(tok) { return tok && tok.t === 'word' ? tok.v.toUpperCase() : null; }

function nextSig(toks, i) { let j = i + 1; while (j < toks.length && toks[j].t === 'ws') j++; return j; }
function prevSig(toks, i) { let j = i - 1; while (j >= 0 && toks[j].t === 'ws') j--; return j; }
function matchParen(toks, open) {
  let d = 0;
  for (let j = open; j < toks.length; j++) {
    if (toks[j].t === 'op' && toks[j].v === '(') d++;
    else if (toks[j].t === 'op' && toks[j].v === ')') { d--; if (d === 0) return j; }
  }
  return -1;
}
function topLevelIndex(toks, open, close, pred) {
  let d = 0;
  for (let j = open + 1; j < close; j++) {
    const t = toks[j];
    if (t.t === 'op' && t.v === '(') d++;
    else if (t.t === 'op' && t.v === ')') d--;
    else if (d === 0 && pred(t)) return j;
  }
  return -1;
}


/** SQLite resolves bare columns in ON CONFLICT ... DO UPDATE SET to the target table; PostgreSQL calls them ambiguous. */
function qualifyUpsert(ts) {
  let ins = -1;
  for (let i = 0; i < ts.length; i++) if (upper(ts[i]) === 'INSERT') { ins = i; break; }
  if (ins < 0) return;
  let j = nextSig(ts, ins);
  if (upper(ts[j]) !== 'INTO') return;
  j = nextSig(ts, j);
  const table = ts[j] && (ts[j].t === 'word' || ts[j].t === 'qid') ? ts[j].v : null;
  if (!table) return;
  for (let i = j; i < ts.length; i++) {
    if (upper(ts[i]) !== 'DO') continue;
    const u = nextSig(ts, i);
    if (upper(ts[u]) !== 'UPDATE') continue;
    const set = nextSig(ts, u);
    if (upper(ts[set]) !== 'SET') continue;
    let depth = 0;
    let lhs = true;
    let inWhere = false;
    for (let k = set + 1; k < ts.length; k++) {
      const t = ts[k];
      if (t.t === 'op' && t.v === '(') depth++;
      else if (t.t === 'op' && t.v === ')') depth--;
      else if (depth === 0 && t.t === 'op' && t.v === ',' && !inWhere) { lhs = true; continue; }
      else if (depth === 0 && upper(t) === 'RETURNING') break;
      else if (depth === 0 && upper(t) === 'WHERE') { inWhere = true; lhs = false; continue; }
      if (t.t === 'op' && t.v === '=' && depth === 0 && !inWhere) { lhs = false; continue; }
      if (t.t !== 'word' || lhs) continue;
      if (!/^[a-z_][a-z0-9_]*$/.test(t.v) || t.v === 'excluded') continue;
      if (ts[prevSig(ts, k)]?.v === '.' || ts[nextSig(ts, k)]?.v === '.' || ts[nextSig(ts, k)]?.v === '(') continue;
      t.v = `${table}.${t.v}`;
    }
    return;
  }
}

const CLAUSE_END = new Set(['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'EXCEPT', 'INTERSECT', 'WINDOW', 'OFFSET', 'RETURNING']);

/** Depth of each token (parens). */
function depths(ts) {
  const d = new Array(ts.length);
  let x = 0;
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].t === 'op' && ts[i].v === '(') { d[i] = x; x++; }
    else if (ts[i].t === 'op' && ts[i].v === ')') { x--; d[i] = x; }
    else d[i] = x;
  }
  return d;
}

/**
 * SQLite lets result-column aliases be used inside HAVING / WHERE / ORDER BY expressions (and ignores COLLATE when
 * matching an ORDER BY alias). PostgreSQL does not. Inline the aliased expression where SQLite would use the alias.
 * `names` = aliases to inline everywhere in WHERE/HAVING/ORDER BY expressions (from an "undefined column" retry);
 * ORDER BY `alias COLLATE x` is always inlined.
 */
function inlineAliases(ts, names) {
  const d = depths(ts);
  for (let i = 0; i < ts.length; i++) {
    if (upper(ts[i]) !== 'SELECT') continue;
    const lvl = d[i];
    // select list
    let j = i + 1;
    const items = [];
    let cur = [];
    for (; j < ts.length; j++) {
      if (d[j] < lvl) break;
      if (d[j] === lvl && CLAUSE_END.has(upper(ts[j]) || '')) break;
      if (d[j] === lvl && ts[j].t === 'op' && ts[j].v === ',') { items.push(cur); cur = []; continue; }
      cur.push(j);
    }
    items.push(cur);
    const alias = new Map();
    for (const it of items) {
      const sig = it.filter((k) => ts[k].t !== 'ws');
      if (sig.length >= 3 && upper(ts[sig[sig.length - 2]]) === 'AS') {
        const nm = ts[sig[sig.length - 1]].v.replace(/^"|"$/g, '').toLowerCase();
        const exprIdx = it.slice(0, it.indexOf(sig[sig.length - 2]));
        alias.set(nm, exprIdx.map((k) => ts[k].v).join('').trim());
      }
    }
    if (!alias.size) continue;
    // clauses of this SELECT
    let clause = null;
    let orderItem = [];
    const flushOrder = () => {
      const sig = orderItem.filter((k) => ts[k].t !== 'ws');
      if (sig.length >= 3 && ts[sig[0]].t !== 'op' && upper(ts[sig[1]]) === 'COLLATE') {
        const nm = ts[sig[0]].v.replace(/^"|"$/g, '').toLowerCase();
        if (alias.has(nm) && ts[nextSig(ts, sig[0])]?.v !== '.') ts[sig[0]].v = '(' + alias.get(nm) + ')';
      } else if (names && sig.length > 1) {
        for (const k of sig) sub(k);
      }
      orderItem = [];
    };
    const sub = (k) => {
      const t = ts[k];
      if (!names || (t.t !== 'word' && t.t !== 'qid')) return;
      const nm = t.v.replace(/^"|"$/g, '').toLowerCase();
      if (!names.has(nm) || !alias.has(nm)) return;
      if (ts[prevSig(ts, k)]?.v === '.' || ts[nextSig(ts, k)]?.v === '.' || ts[nextSig(ts, k)]?.v === '(') return;
      t.v = '(' + alias.get(nm) + ')';
    };
    for (; j < ts.length; j++) {
      if (d[j] < lvl) break;
      const U = upper(ts[j]);
      if (d[j] === lvl && (U === 'UNION' || U === 'EXCEPT' || U === 'INTERSECT')) break;
      if (d[j] === lvl && U && ['WHERE', 'HAVING', 'ORDER', 'GROUP', 'LIMIT', 'OFFSET', 'FROM', 'RETURNING'].includes(U)) {
        if (clause === 'ORDER') flushOrder();
        clause = U;
        if (U === 'ORDER') j = nextSig(ts, j); // skip BY
        continue;
      }
      if (clause === 'ORDER' && d[j] === lvl && ts[j].t === 'op' && ts[j].v === ',') { flushOrder(); continue; }
      if (clause === 'ORDER') orderItem.push(j);
      else if (clause === 'WHERE' || clause === 'HAVING') sub(j);
    }
    if (clause === 'ORDER') flushOrder();
  }
}

/** Integers used as booleans (SQLite): CASE WHEN <x> THEN, WHERE/AND/OR/NOT <x> where <x> is a lone literal or column. */
function intBooleans(ts) {
  const BOOL_START = new Set(['WHEN', 'WHERE', 'AND', 'OR', 'NOT', 'HAVING']);
  const BOOL_END = new Set(['THEN', 'AND', 'OR', 'ORDER', 'GROUP', 'LIMIT', 'HAVING', 'UNION', 'RETURNING', 'ELSE', 'END']);
  const caseStack = [];
  let betweenPending = 0;
  for (let i = 0; i < ts.length; i++) {
    const U = upper(ts[i]);
    if (U === 'BETWEEN') { betweenPending++; continue; }
    if (U === 'AND' && betweenPending) { betweenPending--; continue; }
    if (U === 'CASE') { caseStack.push(upper(ts[nextSig(ts, i)]) === 'WHEN' ? 'searched' : 'simple'); continue; }
    if (U === 'END' && caseStack.length) { caseStack.pop(); continue; }
    if (!U || !BOOL_START.has(U)) continue;
    if (U === 'WHEN' && caseStack[caseStack.length - 1] !== 'searched') continue;
    // operand: [word(.word)] | literal | number
    let a = nextSig(ts, i);
    let b = a;
    if (!ts[a]) continue;
    if (ts[a].t === 'word' && ts[nextSig(ts, a)]?.v === '.') { b = nextSig(ts, nextSig(ts, a)); }
    const tk = ts[b];
    if (!tk) continue;
    const isOperand = tk.t === 'lit' || tk.t === 'num' || ((tk.t === 'word' || tk.t === 'qid') && /^"?[a-z_][a-z0-9_]*"?$/.test(tk.v));
    if (!isOperand) continue;
    if (ts[a].t === 'word' && /^[A-Z]+$/.test(ts[a].v)) continue; // keyword (NULL, EXISTS, NOT ...)
    const after = nextSig(ts, b);
    const nx = ts[after];
    const endOk = !nx || (nx.t === 'op' && nx.v === ')') || BOOL_END.has(upper(nx) || '');
    if (!endOk) continue;
    if (tk.t === 'lit' && /^'/.test(tk.v)) continue; // string literal as condition: leave
    ts[a].v = '(' + ts[a].v;
    tk.v = tk.v + ' <> 0)';
    if (a !== b) { /* qualified a.b: a already opened */ }
  }
}

function translate(sql, args = [], opts = {}) {
  const { pos, named } = normalizeParams(args);
  let pi = 0;
  const toks = tokenize(sql);
  // 1. bind parameters
  for (const t of toks) {
    if (t.t !== 'param') continue;
    let v;
    if (t.v === '?') v = pos[pi++];
    else if (t.v[0] === '?') v = pos[Number(t.v.slice(1)) - 1];
    else {
      const k = t.v.slice(1);
      if (!named || !(k in named)) throw Object.assign(new Error(`Missing named parameter "${k}"`), { code: 'SQLITE_RANGE' });
      v = named[k];
    }
    t.t = 'lit';
    t.v = lit(v);
  }
  // 2. token rewrites
  let conflict = null; // per statement: 'ignore'
  const stmts = [];
  let cur = [];
  const flush = () => { stmts.push({ toks: cur, conflict }); cur = []; conflict = null; };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'op' && t.v === ';') { flush(); continue; }
    cur.push(t);
  }
  flush();

  const outStmts = [];
  for (const st of stmts) {
    const ts = st.toks;
    let conflictMode = null;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      const U = upper(t);
      if (U === 'INSERT') {
        const j = nextSig(ts, i);
        if (upper(ts[j]) === 'OR') {
          const k = nextSig(ts, j);
          const mode = upper(ts[k]);
          if (mode === 'IGNORE' || mode === 'REPLACE') {
            if (mode === 'REPLACE') throw new Error('INSERT OR REPLACE is not supported on PostgreSQL; use ON CONFLICT (...) DO UPDATE');
            conflictMode = 'ignore';
            for (let x = i + 1; x <= k; x++) ts[x] = { t: 'ws', v: x === k ? ' ' : '' };
          }
        }
      } else if (U === 'LIKE') {
        t.v = 'ILIKE';
      } else if (U === 'GLOB') {
        t.v = 'SIMILAR TO';
      } else if ((U === 'MAX' || U === 'MIN') && ts[nextSig(ts, i)]?.v === '(') {
        const o = nextSig(ts, i);
        const c = matchParen(ts, o);
        if (c > 0 && topLevelIndex(ts, o, c, (x) => x.t === 'op' && x.v === ',') > 0) t.v = U === 'MAX' ? 'GREATEST' : 'LEAST';
      } else if (t.t === 'word' && DATE_FNS.has(t.v.toLowerCase()) && ts[nextSig(ts, i)]?.v === '(' && ts[prevSig(ts, i)]?.v !== '.') {
        t.v = 'sqlite_' + t.v.toLowerCase();
      } else if (U === 'COLLATE' && upper(ts[nextSig(ts, i)]) === 'NOCASE') {
        ts[nextSig(ts, i)] = { t: 'qid', v: '"und-x-icu"' };
      } else if (U === 'IS') {
        const j = nextSig(ts, i);
        const N = upper(ts[j]);
        if (N === 'NOT') {
          const k = nextSig(ts, j);
          if (!NO_IS_REWRITE.has(upper(ts[k]) || '') || ts[k].t !== 'word') { t.v = 'IS'; ts[j] = { t: 'word', v: 'DISTINCT FROM' }; }
        } else if (!(ts[j].t === 'word' && NO_IS_REWRITE.has(N))) {
          t.v = 'IS NOT DISTINCT FROM';
        }
      } else if (U === 'CAST' && ts[nextSig(ts, i)]?.v === '(') {
        const o = nextSig(ts, i);
        const c = matchParen(ts, o);
        if (c > 0) {
          const asI = topLevelIndex(ts, o, c, (x) => upper(x) === 'AS');
          if (asI > 0) {
            const ty = upper(ts[nextSig(ts, asI)]);
            if (ty === 'REAL') ts[nextSig(ts, asI)].v = 'DOUBLE PRECISION';
            else if (ty === 'INTEGER' || ty === 'INT') {
              // SQLite truncates toward zero; PG rounds. CAST(x AS INTEGER) -> CAST(TRUNC(CAST(x AS NUMERIC)) AS BIGINT)
              ts[o] = { t: 'op', v: '(TRUNC(CAST(' };
              ts[asI] = { t: 'word', v: ' AS NUMERIC)) AS' };
              ts[nextSig(ts, asI)].v = 'BIGINT';
            }
          }
        }
      } else if (t.t === 'word' && t.v.toLowerCase() === 'json_each' && ts[nextSig(ts, i)]?.v === '(') {
        const o = nextSig(ts, i);
        const c = matchParen(ts, o);
        t.v = 'json_array_elements_text';
        ts[o] = { t: 'op', v: '(CAST(' };
        ts[c] = { t: 'op', v: ' AS json)) AS je(value)' };
      } else if (U === 'LIMIT') {
        const j = nextSig(ts, i);
        if (ts[j]?.v === '-' && ts[nextSig(ts, j)]?.t === 'num') { ts[j] = { t: 'ws', v: '' }; ts[nextSig(ts, j)] = { t: 'word', v: 'ALL' }; }
        else if (ts[j]?.t === 'lit' && /^-/.test(ts[j].v)) ts[j] = { t: 'word', v: 'ALL' };
      } else if (U === 'IN' && ts[nextSig(ts, i)]?.v === '(' && ts[nextSig(ts, nextSig(ts, i))]?.v === ')') {
        ts[nextSig(ts, i)] = { t: 'op', v: '(NULL' };
      } else if (t.t === 'word' && /[a-z]/.test(t.v) && /[A-Z]/.test(t.v) && !opts.keepCase) {
        // camelCase aliases: SQLite keeps case, PG folds unquoted names -> quote them
        t.v = '"' + t.v + '"';
      }
    }
    qualifyUpsert(ts);
    inlineAliases(ts, opts.aliases);
    intBooleans(ts);
    let text = ts.map((x) => x.v).join('');
    if (conflictMode === 'ignore') {
      const m = /\bRETURNING\b/i.exec(text);
      text = m ? text.slice(0, m.index) + ' ON CONFLICT DO NOTHING ' + text.slice(m.index) : text.replace(/\s*$/, '') + ' ON CONFLICT DO NOTHING';
    }
    if (text.trim()) outStmts.push(text);
  }
  return outStmts.join(';\n');
}

module.exports = { translate, tokenize, lit, normalizeParams };
