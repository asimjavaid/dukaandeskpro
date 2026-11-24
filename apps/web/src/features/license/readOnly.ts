import { useSyncExternalStore } from 'react';

/** App-wide read-only flag (trial over / clock set back). Set by LicenseGate. */
let readOnly = false;
const subs = new Set<() => void>();

export function setReadOnly(v: boolean) {
  if (v === readOnly) return;
  readOnly = v;
  if (typeof document !== 'undefined') {
    if (v) document.documentElement.setAttribute('data-readonly', '1');
    else document.documentElement.removeAttribute('data-readonly');
  }
  subs.forEach((f) => f());
}

export function isReadOnly() {
  return readOnly;
}

export function useReadOnly(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => readOnly,
    () => false,
  );
}

/** Open the Activation panel (handled by LicenseGate). */
export function openActivation() {
  window.dispatchEvent(new Event('dd:open-activation'));
}

/** Tell the user a change was refused (toast with Activate). */
export function notifyReadOnly() {
  window.dispatchEvent(new Event('dd:read-only'));
}

/* Latest licence status (for the Settings summary). Set by LicenseGate. */
type AnyStatus = Record<string, unknown> | null;
let licStatus: AnyStatus = null;
const statusSubs = new Set<() => void>();
export function setLicenceStatus(s: AnyStatus) {
  licStatus = s;
  statusSubs.forEach((f) => f());
}
export function useLicenceStatus<T = AnyStatus>(): T {
  return useSyncExternalStore(
    (f) => {
      statusSubs.add(f);
      return () => statusSubs.delete(f);
    },
    () => licStatus as T,
    () => null as T,
  );
}
