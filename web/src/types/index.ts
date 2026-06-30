export type InvoiceStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export interface SummaryColumn { label?: string | null; subtotal?: number | null; discount?: number | null; cgst?: number | null; sgst?: number | null; igst?: number | null; total?: number | null; }
export interface PartsLineItem {
  rate?: number | null; quantity?: number | null; hsn_sac_code?: string | null; tax_percentage?: number | null;
  taxable_amount?: number | null; item_name_description?: string | null; part_number_item_code?: string | null;
}
export interface LabourServiceLineItem {
  labour_code?: string | null; hsn_sac_code?: string | null; labour_charges?: number | null;
  tax_percentage?: number | null; labour_description?: string | null;
}
export interface GstBreakdownLine {
  kind: 'CGST' | 'SGST' | 'IGST';
  rate?: number | null;
  parts?: number | null;
  labour?: number | null;
}

export interface TotalsAndTaxSummary {
  parts_total?: number | null; labour_total?: number | null;
  parts_discount?: number | null; labour_discount?: number | null;
  parts_cgst_rate?: number | null; parts_sgst_rate?: number | null; parts_igst_rate?: number | null;
  labour_cgst_rate?: number | null; labour_sgst_rate?: number | null; labour_igst_rate?: number | null;
  parts_cgst_amount?: number | null; parts_sgst_amount?: number | null; parts_igst_amount?: number | null;
  labour_cgst_amount?: number | null; labour_sgst_amount?: number | null; labour_igst_amount?: number | null;
  sub_total_calculated?: number | null; grand_total_invoice?: number | null;
  parts_special_discount?: number | null; labour_special_discount?: number | null;
  gst_breakdown?: GstBreakdownLine[];
  deductibles?: number | null; salvage?: number | null;
}
export interface ParsedInvoiceData {
  irn?: string | null; pan?: string | null; gstin?: string | null; company_name?: string | null;
  invoice_date?: string | null; invoice_time?: string | null; invoice_number?: string | null;
  service_details?: { last_service?: string | null; service_type?: string | null; next_service_due?: string | null } | null;
  vehicle_details?: { chassis_number?: string | null; registration_number?: string | null; mileage_odometer_reading?: number | null } | null;
  parts_line_items?: PartsLineItem[]; labour_service_line_items?: LabourServiceLineItem[];
  totals_and_tax_summary?: TotalsAndTaxSummary | null; confidence?: number | null;
}
export interface LineItem { id?: string; lineNumber: number; description?: string | null; sku?: string | null; hsnSac?: string | null; quantity?: number | null; unitPrice?: number | null; amount?: number | null; labourAmount?: number | null; taxRate?: number | null; }
export interface ExtractionRun { id: string; provider: string; structuringModel?: string | null; status: string; confidence?: number | null; costEstimate?: number | null; latencyMs?: number | null; pageCount?: number | null; itemsSnapshot?: LineItem[] | null; fieldsSnapshot?: Record<string, unknown> | null; error?: string | null; createdAt: string; }
export interface Invoice {
  id: string; fileName: string; status: InvoiceStatus; provider?: string | null; confidence?: number | null; error?: string | null;
  vendorName?: string | null; vendorAddress?: string | null; vendorTaxId?: string | null;
  invoiceNumber?: string | null; poNumber?: string | null; invoiceDate?: string | null; dueDate?: string | null;
  currency?: string | null; subtotal?: number | null; taxAmount?: number | null; totalAmount?: number | null; paymentTerms?: string | null;
  discountAmount?: number | null; cgstAmount?: number | null; sgstAmount?: number | null; igstAmount?: number | null; netAmount?: number | null;
  summaryColumns?: SummaryColumn[] | null;
  parsedData?: ParsedInvoiceData | null;
  rawText?: string | null; verified: boolean; editedAt?: string | null; activeRunId?: string | null;
  batchId?: string | null; batch?: { id: string; name: string } | null;
  itemCount?: number; costEstimate?: number | null;
  extractionCost?: number | null; structuringCost?: number | null;
  lineItems?: LineItem[]; runs?: ExtractionRun[];
}
export interface Batch { id: string; name: string; createdAt: string; total: number; completed: number; failed: number; processing: number; }
export interface ProviderInfo { name: string; displayName: string; kind: string; configured: boolean; requiredCredentials?: string[]; masked?: Record<string, string>; }
export interface AppConfig { providers: ProviderInfo[]; activeProvider: string; structuringProvider: string; structuringModel: string; }
export interface SettingsData { extractionProvider: string; structuringProvider: string; structuringModel: string; extractionModel?: string; providers: ProviderInfo[]; }
export interface Analytics { totalSpend: number; completedCount: number; avgConfidence: number; needsReview: number; byVendor: { name: string; amount: number }[]; byMonth: { label: string; amount: number }[]; }
