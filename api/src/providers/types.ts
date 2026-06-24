export interface CanonicalLineItem {
  lineNumber: number; description?: string; sku?: string; hsnSac?: string;
  quantity?: number; unitPrice?: number; amount?: number; labourAmount?: number; taxRate?: number;
}
export interface CanonicalResult {
  vendorName?: string; vendorAddress?: string; vendorTaxId?: string;
  invoiceNumber?: string; poNumber?: string;
  invoiceDate?: string; dueDate?: string;            // ISO yyyy-mm-dd
  currency?: string; subtotal?: number; taxAmount?: number; totalAmount?: number; paymentTerms?: string;
  // GST breakdown (Indian invoices). SGST and IGST are mutually exclusive.
  discountAmount?: number; cgstAmount?: number; sgstAmount?: number; igstAmount?: number; netAmount?: number;
  lineItems: CanonicalLineItem[];
  confidence?: number; rawText: string; rawJson: unknown;
  costEstimate?: number; latencyMs?: number; pageCount?: number;
  // USD cost of the structuring (LLM) step, from its token usage. 0 for local/un-priced.
  structuringCost?: number;
}
export interface ExtractCtx {
  fileName: string;
  structuring: { provider: string; model: string } | null;
  // Aborted when the user cancels the extraction; providers should pass it to their
  // long-running network calls so a cancel takes effect promptly.
  signal?: AbortSignal;
}
export type ProviderKind = 'markdown' | 'structured';
export interface ExtractionProvider {
  name: string; displayName: string; kind: ProviderKind;
  requiredCredentials: string[];
  isConfigured(creds: Record<string, string> | null): boolean;
  extract(file: Buffer, creds: Record<string, string>, ctx: ExtractCtx): Promise<CanonicalResult>;
}
