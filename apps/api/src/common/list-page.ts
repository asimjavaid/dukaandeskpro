export type ListPage = { page: number; pageSize: number };

/**
 * Absent page/pageSize/limit/offset means "return the existing full list".
 * Present means a 1-based page. pageSize defaults to 20, capped at 100.
 */
export function parseListPage(query: {
  page?: string;
  pageSize?: string;
  limit?: string;
  offset?: string;
}): ListPage | null {
  const has =
    (query.page != null && query.page !== '') ||
    (query.pageSize != null && query.pageSize !== '') ||
    (query.limit != null && query.limit !== '') ||
    (query.offset != null && query.offset !== '');
  if (!has) return null;
  const sizeRaw = Number(query.pageSize ?? query.limit ?? 20);
  const pageSize = Number.isFinite(sizeRaw)
    ? Math.min(100, Math.max(1, Math.round(sizeRaw)))
    : 20;
  let page = 1;
  if (query.page != null && query.page !== '') {
    const n = Number(query.page);
    page = Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1;
  } else if (query.offset != null && query.offset !== '') {
    const off = Number(query.offset);
    const o = Number.isFinite(off) ? Math.max(0, Math.round(off)) : 0;
    page = Math.floor(o / pageSize) + 1;
  }
  return { page, pageSize };
}
