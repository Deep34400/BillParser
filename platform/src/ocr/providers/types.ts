/** Provider-layer types for OCR and normalization results. */

export interface CanonicalLineItem {
  lineNumber: number;
  description?: string;
  sku?: string;
  hsnSac?: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  labourAmount?: number;
  taxRate?: number;
}

export interface SummaryColumn {
  label?: string;
  subtotal?: number;
  discount?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  total?: number;
}

export interface CanonicalResult {
  vendorName?: string;
  vendorAddress?: string;
  vendorTaxId?: string;
  invoiceNumber?: string;
  poNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  currency?: string;
  subtotal?: number;
  taxAmount?: number;
  totalAmount?: number;
  paymentTerms?: string;
  discountAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  netAmount?: number;
  summaryColumns?: SummaryColumn[];
  confidence?: number;
  lineItems: CanonicalLineItem[];
  rawText?: string;
  rawJson?: Record<string, unknown>;
}

/** Token usage from LLM API responses. */
export interface LlmUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** OCR cost information for a single API call. */
export interface OcrStepCost {
  provider: string;
  model: string;
  usage: LlmUsage;
  /** Estimated cost in USD */
  cost_usd: number;
  latency_ms: number;
}

/** Combined cost info for a full OCR pipeline run. */
export interface OcrCostInfo {
  extraction?: OcrStepCost | null;
  structuring?: OcrStepCost | null;
  total_cost_usd: number;
  total_tokens: number;
}
