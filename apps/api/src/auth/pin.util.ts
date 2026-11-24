import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

/** Hash a 4–6 digit PIN with scrypt. Format: scrypt$<saltHex>$<hashHex> */
export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(pin, salt, KEYLEN);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

/** Verify PIN against stored hash. Returns false for null/empty/malformed hashes. */
export function verifyPinHash(
  pin: string,
  stored: string | null | undefined,
): boolean {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  try {
    const derived = scryptSync(pin, salt, KEYLEN);
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length !== derived.length) return false;
    return timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

/** PIN must be 4–6 digits. */
export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === 'string' && /^[0-9]{4,6}$/.test(pin);
}
