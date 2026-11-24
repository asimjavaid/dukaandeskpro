import { useEffect, useMemo, useRef, useState } from 'react';
import { UrHint, translateError, useI18n, type MessageKey } from '../../i18n';
import { apiGet, apiPostRaw } from '../../lib/api';
import { formatRsShort as formatRs } from '../../lib/money';
import { PageHeader } from '../shared/PageHeader';
import { openWhatsApp, waPhone } from './whatsapp';

type Row = {
  id: string;
  name: string;
  phone: string | null;
  balance_paisa: number;
  last_sale_at: string | null;
  spent_30d_paisa: number;
  spent_90d_paisa: number;
};
type Filter = 'all' | 'khata' | 'recent' | 'top';
type Template = { name: string; body: string };
type Mark = 'opened' | 'skipped';

const FILTERS: Array<[Filter, MessageKey]> = [
  ['all', 'offersFilterAll'],
  ['khata', 'offersFilterKhata'],
  ['recent', 'offersFilterRecent'],
  ['top', 'offersFilterTop'],
];
const TPL_KEY = 'dd-offer-templates';

function loadTemplates(): Template[] {
  try {
    const v = JSON.parse(localStorage.getItem(TPL_KEY) ?? '[]') as Template[];
    return Array.isArray(v) ? v.filter((x) => x && x.name && x.body) : [];
  } catch {
    return [];
  }
}

export function fillMessage(body: string, name: string, shop: string): string {
  return body.replace(/\{name\}/gi, name).replace(/\{shop\}/gi, shop || 'our shop');
}

/** Owner: pick customers, write one message, then open WhatsApp for each in turn. Nothing is auto-sent. */
export function OffersPanel({ onClose, storeName }: { onClose: () => void; storeName: string }) {
  const { t } = useI18n();
  const [step, setStep] = useState<'pick' | 'compose' | 'queue' | 'done'>('pick');
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [templates, setTemplates] = useState<Template[]>(loadTemplates);
  const [tplName, setTplName] = useState('');
  const [queue, setQueue] = useState<Row[]>([]);
  const [invalid, setInvalid] = useState(0);
  const [pos, setPos] = useState(0);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [err, setErr] = useState<string | null>(null);
  const logged = useRef(false);
  const known = useRef(new Map<string, Row>());

  useEffect(() => {
    let live = true;
    apiGet<{ items: Row[] }>(`/parties/offers/audience?filter=${filter}`)
      .then((r) => {
        if (!live) return;
        setRows(r.items);
        for (const x of r.items) known.current.set(x.id, x);
      })
      .catch(() => setErr('error_generic'));
    return () => {
      live = false;
    };
  }, [filter]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q) || (r.phone ?? '').includes(q)) : rows;
  }, [rows, search]);
  const pickable = shown.filter((r) => waPhone(r.phone));
  const allOn = pickable.length > 0 && pickable.every((r) => picked.has(r.id));

  function toggle(id: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setPicked((p) => {
      const n = new Set(p);
      for (const r of pickable) {
        if (allOn) n.delete(r.id);
        else n.add(r.id);
      }
      return n;
    });
  }

  function saveTemplate() {
    const name = tplName.trim();
    if (!name || !msg.trim()) return;
    const next = [...templates.filter((x) => x.name !== name), { name, body: msg }];
    setTemplates(next);
    localStorage.setItem(TPL_KEY, JSON.stringify(next));
    setTplName('');
  }
  function deleteTemplate(name: string) {
    const next = templates.filter((x) => x.name !== name);
    setTemplates(next);
    localStorage.setItem(TPL_KEY, JSON.stringify(next));
  }

  function start() {
    const list = [...picked].map((id) => known.current.get(id)).filter((x): x is Row => Boolean(x));
    const ok = list.filter((r) => waPhone(r.phone));
    setQueue(ok);
    setInvalid(list.length - ok.length);
    setPos(0);
    setMarks({});
    logged.current = false;
    setStep('queue');
  }

  async function finish(finalMarks: Record<string, Mark>) {
    setStep('done');
    if (logged.current) return;
    logged.current = true;
    const vals = Object.values(finalMarks);
    const r = await apiPostRaw<{ ok: boolean; error?: string }>('/parties/offers/campaign', {
      message: msg,
      selected: queue.length + invalid,
      opened: vals.filter((v) => v === 'opened').length,
      skipped: queue.length - vals.filter((v) => v === 'opened').length,
      invalidPhones: invalid,
    });
    if (!r.json?.ok) setErr(r.json?.error ?? 'error_generic');
  }

  function advance(mark?: Mark) {
    const cur = queue[pos];
    const next = { ...marks };
    if (cur && mark) next[cur.id] = mark;
    else if (cur && !next[cur.id]) next[cur.id] = 'skipped';
    setMarks(next);
    if (pos + 1 >= queue.length) void finish(next);
    else setPos(pos + 1);
  }

  async function openCurrent() {
    const cur = queue[pos];
    if (!cur) return;
    const phone = waPhone(cur.phone);
    if (!phone) return;
    await openWhatsApp(phone, fillMessage(msg, cur.name, storeName));
    setMarks((m) => ({ ...m, [cur.id]: 'opened' }));
  }

  const back = (
    <button type="button" className="btn btn--ghost" onClick={onClose} data-offers-close>
      {t('backToParties')}
    </button>
  );
  const sample = queue[pos] ?? known.current.get([...picked][0] ?? '') ?? null;
  const openedCount = Object.values(marks).filter((v) => v === 'opened').length;

  return (
    <div className="card parties offers" data-offers>
      <PageHeader title={<>{t('offersTitle')}<UrHint k="offersTitle" /></>} actions={back} />
      {err ? <p className="parties-alert" role="alert">{translateError(t, err)}</p> : null}

      {step === 'pick' ? (
        <>
          <div className="parties__toolbar">
            <div className="catalog-search field">
              <input
                className="catalog-search__input"
                type="search"
                value={search}
                placeholder={t('searchParties')}
                onChange={(e) => setSearch(e.target.value)}
                data-offers-search
              />
            </div>
            <div className="parties__filter" role="group">
              {FILTERS.map(([f, k]) => (
                <button
                  key={f}
                  type="button"
                  className={`parties__filter-btn${filter === f ? ' is-active' : ''}`}
                  aria-pressed={filter === f}
                  data-offers-filter={f}
                  onClick={() => setFilter(f)}
                >
                  {t(k)}
                </button>
              ))}
            </div>
          </div>
          <div className="catalog-table-wrap">
            <table className="catalog-table parties-table offers-table">
              <thead>
                <tr>
                  <th scope="col" className="offers-table__check">
                    <input type="checkbox" checked={allOn} onChange={toggleAll} aria-label={t('offersSelectAll')} data-offers-all />
                  </th>
                  <th scope="col">{t('partyName')}</th>
                  <th scope="col">{t('partyPhone')}</th>
                  <th scope="col" className="num">{t('offersKhata')}</th>
                  <th scope="col" className="num">{t('offersLast30')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const okPhone = Boolean(waPhone(r.phone));
                  return (
                    <tr key={r.id} className={picked.has(r.id) ? 'is-selected' : okPhone ? '' : 'is-disabled'} onClick={() => okPhone && toggle(r.id)} data-offers-row>
                      <td className="offers-table__check">
                        <input type="checkbox" checked={picked.has(r.id)} disabled={!okPhone} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} />
                      </td>
                      <td>{r.name}</td>
                      <td className="ltr-isolate">
                        {r.phone}
                        {!okPhone ? <span className="chip chip--danger offers-badphone">{t(r.phone?.trim() ? 'offersBadPhone' : 'offersNoPhone')}</span> : null}
                      </td>
                      <td className="num ltr-isolate">{r.balance_paisa > 0 ? formatRs(r.balance_paisa) : '—'}</td>
                      <td className="num ltr-isolate">{r.spent_30d_paisa > 0 ? formatRs(r.spent_30d_paisa) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="offers-foot">
            <span className="muted" data-offers-count>
              {t('offersSelected').replace('{n}', String(picked.size))}
            </span>
            <button type="button" className="btn btn--teal" disabled={picked.size === 0} onClick={() => setStep('compose')} data-offers-next>
              {t('offersWrite')}
            </button>
          </div>
        </>
      ) : null}

      {step === 'compose' ? (
        <div className="offers-compose">
          {templates.length > 0 ? (
            <div className="offers-templates" role="group" aria-label={t('offersTemplates')}>
              {templates.map((tp) => (
                <span key={tp.name} className="offers-tpl">
                  <button type="button" className="chip" onClick={() => setMsg(tp.body)} data-offers-tpl>
                    {tp.name}
                  </button>
                  <button type="button" className="offers-tpl__x" aria-label={tp.name} onClick={() => deleteTemplate(tp.name)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="offer-msg">{t('offersMessage')}</label>
            <textarea
              id="offer-msg"
              className="input offers-msg"
              dir="auto"
              rows={6}
              value={msg}
              maxLength={1500}
              onChange={(e) => setMsg(e.target.value)}
              data-offers-msg
            />
            <span className="offers-ph">
              {['{name}', '{shop}'].map((ph) => (
                <button key={ph} type="button" className="chip ltr-isolate" onClick={() => setMsg((m) => `${m}${ph}`)}>
                  {ph}
                </button>
              ))}
            </span>
          </div>
          {msg.trim() && sample ? (
            <div className="offers-preview" dir="auto" data-offers-preview>
              {fillMessage(msg, sample.name, storeName)}
            </div>
          ) : null}
          <div className="offers-save">
            <input
              className="input"
              placeholder={t('offersTemplateName')}
              value={tplName}
              maxLength={40}
              onChange={(e) => setTplName(e.target.value)}
              data-offers-tplname
            />
            <button type="button" className="btn btn--ghost" disabled={!tplName.trim() || !msg.trim()} onClick={saveTemplate} data-offers-tplsave>
              {t('offersSaveTemplate')}
            </button>
          </div>
          <div className="offers-foot">
            <button type="button" className="btn btn--ghost" onClick={() => setStep('pick')}>
              {t('back')}
            </button>
            <button type="button" className="btn btn--teal" disabled={!msg.trim()} onClick={start} data-offers-start>
              {t('offersStart').replace('{n}', String(picked.size))}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'queue' ? (
        queue.length === 0 ? (
          <div className="offers-foot">
            <span className="muted">{t('offersInvalid').replace('{n}', String(invalid))}</span>
            <button type="button" className="btn btn--ghost" onClick={() => setStep('pick')}>
              {t('back')}
            </button>
          </div>
        ) : (
          <div className="offers-queue" data-offers-queue>
            <div className="offers-progress">
              <strong className="ltr-isolate" data-offers-progress>
                {t('offersProgress').replace('{x}', String(pos + 1)).replace('{n}', String(queue.length))}
              </strong>
              {invalid > 0 ? <span className="chip chip--danger">{t('offersInvalid').replace('{n}', String(invalid))}</span> : null}
              <span className="offers-progress__bar" aria-hidden>
                <span style={{ width: `${Math.round((pos / queue.length) * 100)}%` }} />
              </span>
            </div>
            <div className="offers-current">
              <div>
                <div className="offers-current__name">{queue[pos].name}</div>
                <div className="muted ltr-isolate">{queue[pos].phone}</div>
              </div>
              {marks[queue[pos].id] === 'opened' ? <span className="chip chip--success">{t('offersSent')}</span> : null}
            </div>
            <div className="offers-preview" dir="auto">{fillMessage(msg, queue[pos].name, storeName)}</div>
            <div className="offers-foot">
              <button type="button" className="btn btn--ghost" onClick={() => void finish(marks)} data-offers-stop>
                {t('offersStop')}
              </button>
              <span className="offers-foot__right">
                <button type="button" className="btn btn--ghost" onClick={() => advance('skipped')} data-offers-skip>
                  {t('offersSkip')}
                </button>
                <button type="button" className="btn btn--teal" onClick={() => void openCurrent()} data-offers-open>
                  {t('offersOpen')}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={!marks[queue[pos].id]}
                  onClick={() => advance()}
                  data-offers-nextone
                >
                  {t('offersNext')}
                </button>
              </span>
            </div>
            <div className="catalog-table-wrap">
              <table className="catalog-table parties-table">
                <tbody>
                  {queue.map((r, i) => (
                    <tr key={r.id} className={i === pos ? 'is-selected' : ''}>
                      <td className="ltr-isolate">{i + 1}</td>
                      <td>{r.name}</td>
                      <td className="ltr-isolate">{r.phone}</td>
                      <td>
                        {marks[r.id] === 'opened' ? (
                          <span className="chip chip--success">{t('offersSent')}</span>
                        ) : marks[r.id] === 'skipped' ? (
                          <span className="chip chip--neutral">{t('offersSkipped')}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : null}

      {step === 'done' ? (
        <div className="offers-done" data-offers-done>
          <p className="offers-done__big ltr-isolate">
            {t('offersDone').replace('{x}', String(openedCount)).replace('{n}', String(queue.length + invalid))}
          </p>
          {invalid > 0 ? <p className="muted">{t('offersInvalid').replace('{n}', String(invalid))}</p> : null}
          <button type="button" className="btn btn--teal" onClick={onClose}>
            {t('backToParties')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
