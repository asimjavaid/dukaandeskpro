const BASE = '';

let sessionToken: string | null =
  typeof localStorage !== 'undefined'
    ? localStorage.getItem('dd_session_token')
    : null;

export function setSessionToken(token: string | null) {
  sessionToken = token;
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem('dd_session_token', token);
  else localStorage.removeItem('dd_session_token');
}

export function getSessionToken(): string | null {
  return sessionToken;
}

/** Lite: a paired till's device key (sent as x-dd-till). None = this PC's own till. */
let tillKey: string | null =
  typeof localStorage !== 'undefined' ? localStorage.getItem('dd_till_key') : null;

export function setTillKey(key: string | null) {
  tillKey = key;
  if (typeof localStorage === 'undefined') return;
  if (key) localStorage.setItem('dd_till_key', key);
  else localStorage.removeItem('dd_till_key');
}

export function getTillKey(): string | null {
  return tillKey;
}

function authHeaders(): HeadersInit {
  const h: Record<string, string> = {};
  if (tillKey) h['x-dd-till'] = tillKey;
  if (sessionToken) {
    h['Authorization'] = `Bearer ${sessionToken}`;
    h['x-dd-session'] = sessionToken;
  }
  return h;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** GET that returns status + parsed body instead of throwing. */
export async function apiGetRaw<T>(path: string): Promise<{ status: number; json: T | null }> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include', headers: authHeaders() });
  let json: T | null = null;
  try {
    json = (await res.json()) as T;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** POST that returns status + JSON even on 4xx (e.g. 409 oversell). */
export async function apiPostRaw<T>(
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T | null; ok: boolean }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: T | null = null;
  try {
    json = (await res.json()) as T;
  } catch {
    json = null;
  }
  return { status: res.status, json, ok: res.ok };
}

/** PUT that returns status + JSON even on 4xx. */
export async function apiPutRaw<T>(
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T | null; ok: boolean }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: T | null = null;
  try {
    json = (await res.json()) as T;
  } catch {
    json = null;
  }
  return { status: res.status, json, ok: res.ok };
}

/** PATCH that returns status + JSON even on 4xx (e.g. 409 duplicate barcode). */
export async function apiPatchRaw<T>(
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T | null; ok: boolean }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: T | null = null;
  try {
    json = (await res.json()) as T;
  } catch {
    json = null;
  }
  return { status: res.status, json, ok: res.ok };
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** GET a file (Excel export etc.). Returns the blob and the server's file name. */
export async function apiGetBlob(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include', headers: authHeaders() });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  return { blob: await res.blob(), filename: m ? decodeURIComponent(m[1]) : null };
}

/** Save a blob as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type XlsxCell = string | number | null;
export type XlsxSheet = { name: string; rows: XlsxCell[][]; widths?: number[]; textCols?: number[] };

/** Build a real .xlsx on the local API (POST /export/xlsx) and save it. Returns the file name. */
export async function downloadXlsx(fileName: string, sheets: XlsxSheet[]): Promise<string> {
  const res = await fetch(`${BASE}/export/xlsx`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ fileName, sheets }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : fileName.replace(/(\.xlsx)?$/i, '.xlsx');
  saveBlob(await res.blob(), name);
  return name;
}
