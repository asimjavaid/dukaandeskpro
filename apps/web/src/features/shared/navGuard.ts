/**
 * Optional in-app nav guard (e.g. dirty Stock count).
 * App.setView asks canNavigate(); shells register a confirm callback while mounted.
 */
let guard: (() => boolean) | null = null;

export function setNavGuard(fn: (() => boolean) | null): void {
  guard = fn;
}

/** Returns false when the active shell blocks leaving. */
export function canNavigate(): boolean {
  if (!guard) return true;
  try {
    return guard();
  } catch {
    return true;
  }
}
