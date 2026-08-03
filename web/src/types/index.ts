export type InvoiceStatus = 'DRAFT' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
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
  gstin?: string | null; pan?: string | null; registrationNumber?: string | null;
  invoiceNumber?: string | null; poNumber?: string | null; invoiceDate?: string | null; dueDate?: string | null;
  currency?: string | null; subtotal?: number | null; taxAmount?: number | null; totalAmount?: number | null; paymentTerms?: string | null;
  discountAmount?: number | null; cgstAmount?: number | null; sgstAmount?: number | null; igstAmount?: number | null; netAmount?: number | null;
  summaryColumns?: SummaryColumn[] | null;
  parsedData?: ParsedInvoiceData | null;
  rawText?: string | null; verified: boolean; editedAt?: string | null; activeRunId?: string | null;
  batchId?: string | null; batch?: { id: string; name: string } | null;
  itemCount?: number; costEstimate?: number | null;
  /** 'split' | 'single' — how OCR was run */
  pipelineMode?: 'split' | 'single' | null;
  extractionCost?: number | null; structuringCost?: number | null;
  extractionTokens?: number | null; structuringTokens?: number | null; totalTokens?: number | null;
  extractionProvider?: string | null; structuringProvider?: string | null;
  extractionModel?: string | null; structuringModel?: string | null;
  extractionLatencyMs?: number | null; structuringLatencyMs?: number | null; totalLatencyMs?: number | null;
  lineItems?: LineItem[]; runs?: ExtractionRun[];
  reviewReasons?: string[] | null;
  /** Set when single/Gemini failed and pipeline fell back to Mistral split */
  fallbackReason?: string | null;
}
export interface Batch { id: string; name: string; createdAt: string; total: number; completed: number; failed: number; processing: number; }
export interface ProviderInfo { name: string; displayName: string; kind: string; configured: boolean; requiredCredentials?: string[]; masked?: Record<string, string>; }
export interface AppConfig {
  providers: ProviderInfo[];
  activeProvider: string;
  structuringProvider: string;
  structuringModel: string;
  pipelineMode?: 'split' | 'single';
  singleProvider?: string;
  singleModel?: string;
  emailIntake?: {
    enabled: boolean;
    address: string | null;
    pollIntervalSec: number;
    host?: string;
    port?: number;
    allowedSenders?: string[];
    running?: boolean;
    hasPassword?: boolean;
    passwordHint?: string | null;
  };
}
export interface SettingsData {
  pipelineMode: 'split' | 'single';
  extractionProvider: string;
  structuringProvider: string;
  structuringModel: string;
  extractionModel?: string;
  singleProvider?: string;
  singleModel?: string;
  providers: ProviderInfo[];
}
export interface VehicleSpend { vehicle_id: string; registration_number: string | null; total_bills: number; total_amount: number; parts_amount: number; labour_amount: number; total_tax: number; }
export interface CostPerKm { vehicle_id: string; registration_number: string | null; total_spend: number; km_range: number | null; cost_per_km: number | null; }
export interface OcrCostSummary {
  total_ocr_count: number;
  total_extraction_cost_usd: number;
  total_structuring_cost_usd: number;
  total_cost_usd: number;
  total_extraction_tokens: number;
  total_structuring_tokens: number;
  total_tokens: number;
  avg_cost_per_ocr_usd: number;
  avg_tokens_per_ocr: number;
  by_provider: { provider: string; cost_usd: number; tokens: number; count: number }[];
}
export interface AnalyticsKpis { totalSpend: number; completedCount: number; avgConfidence: number; needsReview: number; totalParts: number; totalLabour: number; totalTax: number; vendorCount: number; vehicleCount: number; }
export interface Analytics { totalSpend: number; completedCount: number; avgConfidence: number; needsReview: number; totalParts: number; totalLabour: number; totalTax: number; vendorCount: number; vehicleCount: number; byVendor: { name: string; amount: number }[]; byMonth: { label: string; amount: number }[]; vehicleSpend: VehicleSpend[]; costPerKm: CostPerKm[]; ocrCosts?: OcrCostSummary; }
export interface FraudAlert { type: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; message: string; bill_ids: string[]; details: Record<string, unknown>; }
export interface FraudScanResult { success: boolean; message: string; data: FraudAlert[]; metadata?: { total: number; by_type?: Record<string, number>; by_severity?: Record<string, number> }; }
