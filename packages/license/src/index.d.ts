export type LicenceState = 'licensed' | 'trial' | 'expired' | 'clock_rollback' | 'integrity';
export interface LicenceStatus {
  state: LicenceState;
  /** days | usage | update_not_covered | clock_back | data_newer | files_changed */
  reason?: string | null;
  locked: boolean;
  /** Same as locked: app stays usable for viewing, export, backup, restore. */
  readOnly: boolean;
  machineCode: string;
  trialDays: number;
  trialStartedAt: string;
  trialEndsAt: string;
  daysLeft: number;
  usageMinutes?: number;
  usageCapMinutes?: number;
  hoursLeft?: number;
  showHoursLeft?: boolean;
  extDays?: number;
  tampered: boolean;
  buildDate?: string | null;
  updateCovered?: boolean;
  licence: { type?: string; edition: string; features: string[]; shop: string; issuedAt: string; updatesUntil?: string } | null;
  activated?: string | null;
  activationError: string | null;
}
export function checkThisMachine(o?: {
  db?: unknown; newKey?: string; now?: number; publicKey?: string;
  addUsageMinutes?: number; dataNewest?: number | null; integrityOk?: boolean; buildDate?: string | null;
}): LicenceStatus;
export function hasFeature(status: LicenceStatus | null, feature: string): boolean;
export function getMachineCode(): string;
export function publicKeyPem(): string | null;
export function verifyManifest(baseDir: string, publicKeyPem: string, manifestPath?: string): { ok: boolean; reason?: string; bad?: string[]; buildDate?: string };
export const KEY_ID: string;
export const BUILD_DATE: string | null;
