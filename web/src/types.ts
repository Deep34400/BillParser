export type InvoiceStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export interface LineItem { id?: string; lineNumber: number; description?: string | null; sku?: string | null; quantity?: number | null; unitPrice?: number | null; amount?: number | null; taxRate?: number | null; }
export interface ExtractionRun { id: string; provider: string; structuringModel?: string | null; status: string; confidence?: number | null; costEstimate?: number | null; latencyMs?: number | null; pageCount?: number | null; itemsSnapshot?: LineItem[] | null; fieldsSnapshot?: Record<string, unknown> | null; error?: string | null; createdAt: string; }
export interface Invoice {
  id: string; fileName: string; status: InvoiceStatus; provider?: string | null; confidence?: number | null; error?: string | null;
  vendorName?: string | null; vendorAddress?: string | null; vendorTaxId?: string | null;
  invoiceNumber?: string | null; poNumber?: string | null; invoiceDate?: string | null; dueDate?: string | null;
  currency?: string | null; subtotal?: number | null; taxAmount?: number | null; totalAmount?: number | null; paymentTerms?: string | null;
  rawText?: string | null; verified: boolean; editedAt?: string | null; activeRunId?: string | null;
  itemCount?: number; costEstimate?: number | null;
  extractionCost?: number | null; structuringCost?: number | null;
  lineItems?: LineItem[]; runs?: ExtractionRun[];
}
export interface ProviderInfo { name: string; displayName: string; kind: string; configured: boolean; requiredCredentials?: string[]; masked?: Record<string, string>; }
export interface AppConfig { providers: ProviderInfo[]; activeProvider: string; structuringProvider: string; structuringModel: string; }
export interface SettingsData { extractionProvider: string; structuringProvider: string; structuringModel: string; providers: ProviderInfo[]; }
export interface Analytics { totalSpend: number; completedCount: number; avgConfidence: number; needsReview: number; byVendor: { name: string; amount: number }[]; byMonth: { label: string; amount: number }[]; }
