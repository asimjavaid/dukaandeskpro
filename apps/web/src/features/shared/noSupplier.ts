import type { MessageKey } from '../../i18n/dictionary';

/** Must match apps/api/src/suppliers/system-supplier.ts */
export const NO_SUPPLIER_ID = 'system-no-supplier';

export function supplierLabel(
  id: string,
  name: string,
  t: (key: MessageKey) => string,
): string {
  return id === NO_SUPPLIER_ID ? t('supplierNone') : name;
}
