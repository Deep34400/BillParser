export interface CanonicalLineItem {
  lineNumber: number; description?: string; sku?: string;
  quantity?: number; unitPrice?: number; amount?: number; taxRate?: number;
}
export interface CanonicalResult {
  vendorName?: string; vendorAddress?: string; vendorTaxId?: string;
  invoiceNumber?: string; poNumber?: string;
  invoiceDate?: string; dueDate?: string;            // ISO yyyy-mm-dd
  currency?: string; subtotal?: number; taxAmount?: number; totalAmount?: number; paymentTerms?: string;
  lineItems: CanonicalLineItem[];
  confidence?: number; rawText: string; rawJson: unknown;
  costEstimate?: number; latencyMs?: number; pageCount?: number;
}
export interface ExtractCtx {
  fileName: string;
  structuring: { provider: string; model: string } | null;
}
export type ProviderKind = 'markdown' | 'structured';
export interface ExtractionProvider {
  name: string; displayName: string; kind: ProviderKind;
  requiredCredentials: string[];
  isConfigured(creds: Record<string, string> | null): boolean;
  extract(file: Buffer, creds: Record<string, string>, ctx: ExtractCtx): Promise<CanonicalResult>;
}
