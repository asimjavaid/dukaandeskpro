export type StaffRole = 'owner' | 'manager' | 'cashier' | 'data_entry';

/** Owner or manager: open/close any till, approve refunds and price overrides. */
export function isSupervisor(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

export const SESSION_COOKIE = 'dd_session';

export type SessionPayload = {
  userId: string;
  storeId: string;
  role: StaffRole;
  displayName: string;
  exp: number;
  /** Issued at (unix s). Older tokens without it count as issued exp − TTL. */
  /** Signed at, unix ms. */
  iat?: number;
  /** Till the session was opened on (null = back office / no till). */
  tillId?: string | null;
};
