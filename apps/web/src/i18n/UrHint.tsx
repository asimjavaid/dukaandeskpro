import type { MessageKey } from './dictionary';

const HINTS: Partial<Record<MessageKey, string>> = {
  repackTitle: 'ری پیک',
  osTitle: 'ابتدائی اسٹاک',
  offersTitle: 'پیشکش',
  loyaltyPoints: 'پوائنٹس',
  waReminder: 'یاد دہانی',
  customerDisplay: 'گاہک اسکرین',
  scaleRead: 'ترازو',
  activityTitle: 'سرگرمی',
  stockCare: 'اسٹاک',
  billDiscount: 'رعایت',
  sell: 'فروخت',
  salesTitle: 'بل',
  returnsTitle: 'واپسی',
  catalog: 'اشیاء',
  stockCountTitle: 'اسٹاک گنتی',
  purchasesTitle: 'خریداری',
  suppliersTitle: 'سپلائر',
  parties: 'گاہک',
  expensesTitle: 'خرچے',
  analytics: 'رپورٹ',
  taxTitle: 'ٹیکس',
  staff: 'عملہ',
  settings: 'سیٹنگز',
  backup: 'بیک اپ',
  cashierToday: 'آج',
  tillTitle: 'گلہ',
  tillsTitle: 'کاؤنٹر',
  linkDownTitle: 'مین کمپیوٹر سے رابطہ نہیں',
  linkConnectTitle: 'مین کمپیوٹر',
  linkPairTitle: 'کاؤنٹر جوڑیں',
  openKhata: 'کھاتہ',
  salesPaidKhata: 'کھاتہ',
  analyticsUdhaar: 'ادھار',
  cashTendered: 'نقد وصول',
  payAddToKhata: 'کھاتے میں',
  salaryKhata: 'تنخواہ',
  salaryKhataShort: 'تنخواہ',
};

/** Shorter forms where the side menu has little room. */
const SHORT: Partial<Record<MessageKey, string>> = {
  stockCountTitle: 'گنتی',
  osTitle: 'ابتدائی',
};

/** Small secondary Urdu word next to a key shop term. */
export function UrHint({ k, short = false }: { k: MessageKey; short?: boolean }) {
  const ur = (short ? SHORT[k] : undefined) ?? HINTS[k];
  if (!ur) return null;
  return (
    <span className="ur-hint" lang="ur" dir="rtl" aria-hidden="true">
      {ur}
    </span>
  );
}
