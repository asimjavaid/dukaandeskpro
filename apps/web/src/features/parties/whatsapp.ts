import { formatRsShort } from '../../lib/money';

/** Pakistani mobile → 92XXXXXXXXXX (03xx-xxxxxxx, 3xx…, +92…, 0092…, Urdu digits). null if not a PK mobile. */
export function waPhone(raw: string | null | undefined): string | null {
  let d = String(raw ?? '')
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('920')) d = `92${d.slice(3)}`;
  if (d.startsWith('0')) d = d.slice(1);
  if (!d.startsWith('92') || d.length !== 12) d = `92${d}`;
  return /^923\d{9}$/.test(d) ? d : null;
}

/** English + Urdu khata reminder with the balance. */
export function khataReminderText(name: string, store: string, balancePaisa: number): string {
  const rs = formatRsShort(balancePaisa);
  const shop = store.trim() || 'our shop';
  return [
    `Assalam o Alaikum ${name}, your khata balance at ${shop} is ${rs}. Kindly clear it at your convenience. Thank you.`,
    '',
    `السلام علیکم ${name}، ${shop} پر آپ کے کھاتے کا بقایا ${rs} ہے۔ مہربانی فرما کر جلد ادا کر دیں۔ شکریہ۔`,
  ].join('\n');
}

/** Opens WhatsApp Desktop (Electron) or the wa.me page with the message filled in. */
export async function openWhatsApp(phone: string, text: string): Promise<void> {
  const b = (window as unknown as { dukaandesk?: { openWhatsApp?: (p: string, t: string) => Promise<unknown> } }).dukaandesk;
  if (b?.openWhatsApp) {
    await b.openWhatsApp(phone, text);
    return;
  }
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}
