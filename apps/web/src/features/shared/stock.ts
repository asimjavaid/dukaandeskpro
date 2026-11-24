/**
 * Same default as the API analytics low-stock list
 * (apps/api/src/analytics DEFAULT_LOW_STOCK_THRESHOLD). On-hand at or below this is "low".
 */
export const LOW_STOCK_THRESHOLD = 5;

export type StockLevel = 'out' | 'low' | 'ok';

export function stockLevel(qty: number, threshold = LOW_STOCK_THRESHOLD): StockLevel {
  if (qty <= 0) return 'out';
  if (qty <= threshold) return 'low';
  return 'ok';
}
