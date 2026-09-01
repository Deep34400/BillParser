/**
 * Core domain types — single source of truth.
 *
 * The OCR contract (ParsedInvoiceData) is preserved exactly as-is from the original system.
 * Firestore document shapes (BillDoc, BillPartDoc) are designed around this contract.
 */

// ─── OCR contract (immutable — do not rename or restructure) ─────────────────

export interface PartsLineItem {
  rate?: number | null;
  quantity?: number | null;
  hsn_sac_code?: string | null;
  tax_percentage?: number | null;
  taxable_amount?: number | null;
  item_name_description?: string | null;
  part_number_item_code?: string | null;
}

export interface LabourServiceLineItem {
  labour_code?: string | null;
  hsn_sac_code?: string | null;
  labour_charges?: number | null;
  tax_percentage?: number | null;
  labour_description?: string | null;
}

export interface ServiceDetails {
  last_service?: string | null;
  service_type?: string | null;
  next_service_due?: string | null;
}

export interface VehicleDetails {
  chassis_number?: string | null;
  registration_number?: string | null;
  mileage_odometer_reading?: number | null;
}

export interface GstBreakdownLine {
  kind: 'CGST' | 'SGST' | 'IGST';
  rate?: number | null;
  parts?: number | null;
  labour?: number | null;
}

export interface TotalsAndTaxSummary {
  parts_total?: number | null;
  labour_total?: number | null;
  parts_discount?: number | null;
  labour_discount?: number | null;
  parts_cgst_rate?: number | null;
  parts_igst_rate?: number | null;
  parts_sgst_rate?: number | null;
  labour_cgst_rate?: number | null;
  labour_igst_rate?: number | null;
  labour_sgst_rate?: number | null;
  parts_cgst_amount?: number | null;
  parts_igst_amount?: number | null;
  parts_sgst_amount?: number | null;
  labour_cgst_amount?: number | null;
  labour_igst_amount?: number | null;
  labour_sgst_amount?: number | null;
  sub_total_calculated?: number | null;
  grand_total_invoice?: number | null;
  parts_special_discount?: number | null;
  labour_special_discount?: number | null;
  deductibles?: number | null;
  salvage?: number | null;
  /** Per-kind GST amounts captured from footer (authoritative when present). */
  gst_breakdown?: GstBreakdownLine[] | null;
}

export interface ParsedInvoiceData {
  irn?: string | null;
  pan?: string | null;
  gstin?: string | null;
  company_name?: string | null;
  invoice_date?: string | null;
  invoice_time?: string | null;
  invoice_number?: string | null;
  service_details?: ServiceDetails | null;
  vehicle_details?: VehicleDetails | null;
  parts_line_items?: PartsLineItem[];
  labour_service_line_items?: LabourServiceLineItem[];
  totals_and_tax_summary?: TotalsAndTaxSummary | null;
  confidence?: number | null;
}

// ─── Bill status flow ────────────────────────────────────────────────────────

export type BillStatus =
  | 'DRAFT'
  | 'UPLOADED'
  | 'PROCESSING'
  | 'OCR_COMPLETED'
  | 'NEED_REVIEW'
  | 'VERIFIED'
  | 'FAILED';

// ─── Bill types (extensible for future categories) ──────────────────────────

export type BillType =
  | 'MAINTENANCE'
  | 'FUEL'
  | 'INSURANCE'
  | 'TYRE'
  | 'TOLL'
  | 'ACCIDENT_REPAIR'
  | 'BATTERY_REPLACEMENT'
  | 'AMC_CONTRACT'
  | 'OTHER';

// ─── Line item types ────────────────────────────────────────────────────────

export type LineType = 'PART' | 'LABOUR';

// ─── Firestore document: bills collection ───────────────────────────────────

export interface BillDoc {
  bill_id: string;
  fleet_id?: string | null;
  vehicle_id?: string | null;

  bill_type: BillType;
  bill_category?: string | null;

  vendor_name?: string | null;
  vendor_gstin?: string | null;

  company_name?: string | null;
  gstin?: string | null;
  pan?: string | null;
  irn?: string | null;

  invoice_number?: string | null;
  invoice_date?: string | null;
  invoice_time?: string | null;

  subtotal_amount?: number | null;
  parts_amount?: number | null;
  labour_amount?: number | null;

  parts_cgst_amount?: number | null;
  parts_sgst_amount?: number | null;
  parts_igst_amount?: number | null;
  parts_cgst_rate?: number | null;
  parts_sgst_rate?: number | null;
  parts_igst_rate?: number | null;

  labour_cgst_amount?: number | null;
  labour_sgst_amount?: number | null;
  labour_igst_amount?: number | null;
  labour_cgst_rate?: number | null;
  labour_sgst_rate?: number | null;
  labour_igst_rate?: number | null;

  total_tax_amount?: number | null;
  grand_total_amount?: number | null;

  deductibles?: number | null;
  salvage?: number | null;

  odometer_reading?: number | null;
  registration_number?: string | null;
  chassis_number?: string | null;

  ocr_status: BillStatus;
  processing_status?: string | null;
  confidence_score?: number | null;

  /** Advisory human-review reasons (missing GSTIN/PAN, total mismatch, etc.). Not blocking. */
  review_reasons?: string[] | null;

  /**
   * Stable machine codes for filtering Needs review in UI/API.
   * e.g. MISSING_TAX_ID | TOTAL_MISMATCH | PARTS_BASE_MISMATCH | LABOUR_BASE_MISMATCH
   */
  review_codes?: string[] | null;

  /** Structured total reconciliation result from line-item recomputation. */
  total_reconciliation?: import('../ocr/transformer/reconcileTotal.js').TotalReconciliation | null;

  file_url?: string | null;
  storage_path?: string | null;

  raw_ocr_reference?: string | null;

  /** Immutable OCR response — source of truth. Never modify manually. */
  parsed_data?: ParsedInvoiceData | null;

  // ─── OCR cost tracking ──────────────────────────────────────────────────────
  /** 'split' = extract + structure; 'single' = one multimodal call */
  pipeline_mode?: 'split' | 'single' | null;
  extraction_cost_usd?: number | null;
  structuring_cost_usd?: number | null;
  total_cost_usd?: number | null;
  extraction_tokens?: number | null;
  extraction_input_tokens?: number | null;
  extraction_output_tokens?: number | null;
  structuring_tokens?: number | null;
  structuring_input_tokens?: number | null;
  structuring_output_tokens?: number | null;
  total_tokens?: number | null;
  total_input_tokens?: number | null;
  total_output_tokens?: number | null;
  total_thinking_tokens?: number | null;
  total_input_cost_usd?: number | null;
  total_output_cost_usd?: number | null;
  extraction_provider?: string | null;
  structuring_provider?: string | null;
  extraction_model?: string | null;
  structuring_model?: string | null;
  extraction_latency_ms?: number | null;
  structuring_latency_ms?: number | null;
  total_latency_ms?: number | null;

  /** How many fallback levels were attempted during OCR */
  fallback_attempts?: number | null;
  /** Audit trail of each fallback level attempted */
  fallback_history?: Array<{
    level: number;
    label: string;
    mode: 'single' | 'split';
    provider: string;
    model: string;
    reconciliation_matched: boolean;
    difference?: number | null;
    error?: string | null;
    cost_usd: number;
    latency_ms: number;
  }> | null;

  /** Linked vendor from Vendor Registry (set after OCR completion). */
  vendor_id?: string | null;

  schema_version: number;

  created_at: string;
  updated_at: string;
}

// ─── Firestore document: bill_parts collection ──────────────────────────────

export interface BillPartDoc {
  part_id: string;
  bill_id: string;

  line_type: LineType;

  name?: string | null;
  description?: string | null;

  quantity?: number | null;
  rate?: number | null;
  amount?: number | null;

  tax_percentage?: number | null;
  tax_amount?: number | null;

  part_number?: string | null;
  hsn_sac_code?: string | null;

  manufacturer?: string | null;
  normalized_name?: string | null;

  confidence_score?: number | null;

  created_at: string;
}

// ─── Standard API response envelope ─────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data: T;
  metadata: Record<string, unknown>;
  errors: ApiError[];
}

export interface ApiError {
  code: string;
  message: string;
  field?: string;
}
