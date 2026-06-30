/** Central invoice schema — single source of truth for structure, prompt, and validation. */

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
  /** Per-rate GST lines when footer prints IGST/CGST @ 28% and @ 18% separately. */
  gst_breakdown?: GstBreakdownLine[];
  deductibles?: number | null;
  salvage?: number | null;
}

/** Parsed invoice fields — automotive / service-invoice shape. */
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

export interface InvoiceSchemaEntry {
  id?: string | null;
  parsed_data: ParsedInvoiceData;
}

/** LLM output wrapper — preferred structured response shape. */
export interface InvoiceSchemaOutput {
  output: {
    entries: InvoiceSchemaEntry[];
  };
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ParseResult {
  parsed: ParsedInvoiceData;
  raw: unknown;
  format: 'schema' | 'legacy';
  validation: ValidationIssue[];
}
