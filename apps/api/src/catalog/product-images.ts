import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

/** Pictures live next to the SQLite file: <db dir>/product-images/. */
export function productImagesDir(dbPath: string): string {
  return path.join(path.dirname(dbPath), 'product-images');
}

/** Only names we generate: letters, digits, dash, underscore, .jpg */
export const IMAGE_FILE_RE = /^[A-Za-z0-9_-]{1,120}\.jpg$/;

export const MAX_IMAGE_BYTES = 512 * 1024;

export function isJpeg(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

export function newImageFileName(productId: string): string {
  const safe = productId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'p';
  return `${safe}-${randomBytes(4).toString('hex')}.jpg`;
}

/** Decode "data:image/jpeg;base64,..." or bare base64. */
export function decodeImagePayload(raw: unknown): Buffer | null {
  if (typeof raw !== 'string' || !raw) return null;
  const b64 = raw.replace(/^data:image\/jpeg;base64,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return null;
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length || buf.length > MAX_IMAGE_BYTES || !isJpeg(buf)) return null;
  return buf;
}

export function writeImageFile(dir: string, file: string, data: Buffer) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${file}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, path.join(dir, file));
}

export function removeImageFile(dir: string, file: string | null | undefined) {
  if (!file || !IMAGE_FILE_RE.test(file)) return;
  try {
    fs.unlinkSync(path.join(dir, file));
  } catch {
    /* already gone */
  }
}
