/** Firestore document shape for the `vendors` collection. */
export interface VendorDoc {
  vendor_id: string;
  legal_name: string | null;
  display_name: string | null;
  gstin: string | null;
  pan: string | null;
  invoice_count: number;
  first_seen: string;
  last_seen: string;
  /** Future: e.g. 'bosch_v1', 'toyota_v1' — not implemented yet. */
  parser_name: string | null;
  created_at: string;
  updated_at: string;
}
