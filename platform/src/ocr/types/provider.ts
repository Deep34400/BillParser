/** OCR provider types — token usage, costs, and pipeline info. */

/** Legacy canonical shape used only by parser/parser.ts fallback path. */
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
  summaryColumns?: { label?: string; subtotal?: number; discount?: number; cgst?: number; sgst?: number; igst?: number; total?: number }[];
  confidence?: number;
  lineItems: CanonicalLineItem[];
  rawText?: string;
  rawJson?: Record<string, unknown>;
}

/** Token usage from LLM API responses. */
export interface LlmUsage {
  prompt_tokens: number;
  /** Answer / candidate tokens (not including thinking). */
  completion_tokens: number;
  /**
   * Gemini "thinking" / reasoning tokens (usageMetadata.thoughtsTokenCount).
   * Billed at the model's output price (Google: output includes thinking).
   */
  thinking_tokens?: number;
  /** API totalTokenCount (input + output + thinking when present). */
  total_tokens: number;
}

/** OCR cost information for a single API call. */
export interface OcrStepCost {
  provider: string;
  model: string;
  usage: LlmUsage;
  /** Estimated cost in USD */
  cost_usd: number;
  input_cost_usd: number;
  /** Output + thinking tokens × output $/1M */
  output_cost_usd: number;
  /** $/1M rates applied to this call, so the cost can be re-derived later. */
  input_rate_per_1m?: number;
  output_rate_per_1m?: number;
  /** Pages billed, for steps priced per page rather than per token (Mistral OCR). */
  pages?: number;
  latency_ms: number;
}

/** Combined cost info for a full OCR pipeline run. */
export interface OcrCostInfo {
  extraction?: OcrStepCost | null;
  structuring?: OcrStepCost | null;
  total_cost_usd: number;
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_thinking_tokens: number;
  /** $/1M rates applied — persisted so the cost stays auditable. */
  input_rate_per_1m?: number;
  output_rate_per_1m?: number;
  /** Pages billed by a per-page step, if any. */
  extraction_pages?: number;
  total_input_cost_usd: number;
  total_output_cost_usd: number;
}
