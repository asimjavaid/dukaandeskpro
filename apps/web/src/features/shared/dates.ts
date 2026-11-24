/**
 * One date style for screens (UI S3): "19 Oct 2026, 7:23 pm" / "19 Oct 2026", shop time (Asia/Karachi).
 * Server timestamps are UTC ("2026-10-19 14:23:00" or ISO). Plain YYYY-MM-DD strings are calendar days.
 */
const TZ = 'Asia/Karachi';
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function toDate(v: string | number | Date): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  const s = v.trim();
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(s)) return new Date(s);
  return new Date(`${s.replace(' ', 'T')}Z`);
}

const dtFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const dFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

/** "19 Oct 2026, 7:23 pm" */
export function fmtDateTime(v: string | number | Date | null | undefined): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'string' && YMD.test(v)) return fmtDate(v);
  const d = toDate(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return dtFmt.format(d).replace(/\s?(am|pm|AM|PM)$/, (m) => ` ${m.trim().toLowerCase()}`);
}

/** "19 Oct 2026" (a YYYY-MM-DD string is shown as that calendar day). */
export function fmtDate(v: string | number | Date | null | undefined): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'string' && YMD.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return dayFmt.format(new Date(Date.UTC(y, m - 1, d)));
  }
  const d = toDate(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return dFmt.format(d);
}
