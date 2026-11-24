export type TillSummary = {
  opening_float_paisa: number;
  cash_sales_paisa: number;
  /** JazzCash / Easypaisa / bank (not in the drawer). */
  digital_paisa?: number;
  udhaar_received_paisa: number;
  refunds_cash_paisa: number;
  expenses_paisa: number;
  cash_in_paisa: number;
  cash_out_paisa: number;
  expected_paisa: number;
  sale_count: number;
  sales_total_paisa: number;
  udhaar_given_paisa: number;
  return_count: number;
  returns_total_paisa: number;
};

export type TillMove = {
  id: string;
  kind: 'in' | 'out';
  amount_paisa: number;
  reason: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type TillShift = {
  id: string;
  opened_at: string;
  opened_by_name: string | null;
  opening_float_paisa: number;
  closed_at: string | null;
  closed_by_name: string | null;
  expected_paisa: number | null;
  counted_paisa: number | null;
  over_short_paisa: number | null;
  note: string | null;
};

export type TillReport = { shift: TillShift; summary: TillSummary; moves: TillMove[] };
