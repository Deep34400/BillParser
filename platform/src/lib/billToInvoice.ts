/**
 * Map BillDoc (Firestore) → Invoice (frontend-compatible shape).
 * The frontend expects the old PostgreSQL-era Invoice interface. This bridge
 * lets the new Firestore backend serve the exact same JSON without touching the UI.
 */
import type { BillDoc, BillPartDoc } from '../models/types.js';

export interface FrontendLineItem {
  id?: string;
  lineNumber: number;
  description?: string | null;
  sku?: string | null;
  hsnSac?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
  labourAmount?: number | null;
  taxRate?: number | null;
}

export interface FrontendInvoice {
  id: string;
  fileName: string;
  status: string;
  provider?: string | null;
  confidence?: number | null;
  error?: string | null;
  vendorName?: string | null;
  vendorAddress?: string | null;
  vendorTaxId?: string | null;
  invoiceNumber?: string | null;
  poNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  currency?: string | null;
  subtotal?: number | null;
  taxAmount?: number | null;
  totalAmount?: number | null;
  paymentTerms?: string | null;
  discountAmount?: number | null;
  cgstAmount?: number | null;
  sgstAmount?: number | null;
  igstAmount?: number | null;
  netAmount?: number | null;
  summaryColumns?: unknown[] | null;
  parsedData?: unknown | null;
  rawText?: string | null;
  verified: boolean;
  editedAt?: string | null;
  activeRunId?: string | null;
  batchId?: string | null;
  batch?: { id: string; name: string } | null;
  itemCount?: number;
  costEstimate?: number | null;
  extractionCost?: number | null;
  structuringCost?: number | null;
  extractionTokens?: number | null;
  structuringTokens?: number | null;
  totalTokens?: number | null;
  extractionProvider?: string | null;
  structuringProvider?: string | null;
  extractionModel?: string | null;
  structuringModel?: string | null;
  extractionLatencyMs?: number | null;
  structuringLatencyMs?: number | null;
  totalLatencyMs?: number | null;
  lineItems?: FrontendLineItem[];
  runs?: unknown[];
  reviewReasons?: string[] | null;
}

const STATUS_MAP: Record<string, string> = {
  UPLOADED: 'PENDING',
  PROCESSING: 'PROCESSING',
  OCR_COMPLETED: 'COMPLETED',
  VERIFIED: 'COMPLETED',
  FAILED: 'FAILED',
};

export function billToInvoice(bill: BillDoc, parts?: BillPartDoc[]): FrontendInvoice {
  const t = bill.parsed_data?.totals_and_tax_summary;

  const cgst = (t?.parts_cgst_amount ?? 0) + (t?.labour_cgst_amount ?? 0) || null;
  const sgst = (t?.parts_sgst_amount ?? 0) + (t?.labour_sgst_amount ?? 0) || null;
  const igst = (t?.parts_igst_amount ?? 0) + (t?.labour_igst_amount ?? 0) || null;

  const lineItems: FrontendLineItem[] = [];
  if (parts) {
    parts.forEach((p, i) => {
      lineItems.push({
        id: p.part_id,
        lineNumber: i + 1,
        description: p.name,
        sku: p.part_number,
        hsnSac: p.hsn_sac_code,
        quantity: p.quantity,
        unitPrice: p.rate,
        amount: p.line_type === 'PART' ? p.amount : null,
        labourAmount: p.line_type === 'LABOUR' ? p.amount : null,
        taxRate: p.tax_percentage,
      });
    });
  }

  return {
    id: bill.bill_id,
    fileName: bill.storage_path?.split('/').pop() ?? 'invoice.pdf',
    status: STATUS_MAP[bill.ocr_status] ?? 'PENDING',
    provider: 'mistral',
    confidence: bill.confidence_score,
    error: bill.ocr_status === 'FAILED' ? (bill.processing_status ?? 'Processing failed') : null,
    vendorName: bill.vendor_name ?? bill.company_name,
    vendorAddress: null,
    vendorTaxId: bill.vendor_gstin ?? bill.gstin,
    invoiceNumber: bill.invoice_number,
    poNumber: null,
    invoiceDate: bill.invoice_date,
    dueDate: null,
    currency: 'INR',
    subtotal: bill.subtotal_amount,
    taxAmount: bill.total_tax_amount,
    totalAmount: bill.grand_total_amount,
    paymentTerms: null,
    discountAmount: null,
    cgstAmount: cgst,
    sgstAmount: sgst,
    igstAmount: igst,
    netAmount: bill.grand_total_amount,
    summaryColumns: null,
    parsedData: bill.parsed_data,
    rawText: bill.raw_ocr_reference,
    verified: bill.ocr_status === 'VERIFIED',
    editedAt: null,
    activeRunId: null,
    batchId: null,
    batch: null,
    itemCount: lineItems.length || undefined,
    costEstimate: bill.total_cost_usd ?? null,
    extractionCost: bill.extraction_cost_usd ?? null,
    structuringCost: bill.structuring_cost_usd ?? null,
    extractionTokens: bill.extraction_tokens ?? null,
    structuringTokens: bill.structuring_tokens ?? null,
    totalTokens: bill.total_tokens ?? null,
    extractionProvider: bill.extraction_provider ?? null,
    structuringProvider: bill.structuring_provider ?? null,
    extractionModel: bill.extraction_model ?? null,
    structuringModel: bill.structuring_model ?? null,
    extractionLatencyMs: bill.extraction_latency_ms ?? null,
    structuringLatencyMs: bill.structuring_latency_ms ?? null,
    totalLatencyMs: bill.total_latency_ms ?? null,
    lineItems: lineItems.length ? lineItems : undefined,
    runs: [],
    reviewReasons: bill.review_reasons ?? null,
  };
}
