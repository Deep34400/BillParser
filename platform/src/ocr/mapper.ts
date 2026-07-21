/**
 * OCR Data Mapper — all data transformations in one place:
 *
 *   mapParsedToBill()  — ParsedInvoiceData → BillDoc (Firestore storage)
 *   billToInvoice()    — BillDoc → FrontendInvoice (API response for UI)
 *   toApiParsed()      — ParsedInvoiceData → stable OCR response shape (IMMUTABLE)
 */
import type {
  BillDoc, BillPartDoc, ParsedInvoiceData, BillType,
  TotalsAndTaxSummary, PartsLineItem, LabourServiceLineItem,
  ServiceDetails, VehicleDetails,
} from '../shared/types.js';
import type { OcrCostInfo } from './types/provider.js';
import { computeReviewReasons } from './transformer/review.js';

// ── mapParsedToBill ─────────────────────────────────────────────

const SCHEMA_VERSION = 1;

function hasParsedContent(parsed: ParsedInvoiceData): boolean {
  return !!(
    parsed.company_name || parsed.gstin || parsed.invoice_number ||
    (parsed.parts_line_items?.length ?? 0) > 0 ||
    (parsed.labour_service_line_items?.length ?? 0) > 0 ||
    parsed.totals_and_tax_summary?.grand_total_invoice != null
  );
}

export function mapParsedToBill(
  billId: string,
  parsed: ParsedInvoiceData,
  opts: {
    fileUrl?: string;
    storagePath?: string;
    rawOcrReference?: string;
    billType?: BillType;
    fleetId?: string;
    vehicleId?: string;
    costInfo?: OcrCostInfo;
    pipelineMode?: 'split' | 'single';
  } = {},
): BillDoc {
  const t = parsed.totals_and_tax_summary;
  const vd = parsed.vehicle_details;
  const now = new Date().toISOString();

  const totalTax = sumNullable(
    t?.parts_cgst_amount, t?.parts_sgst_amount, t?.parts_igst_amount,
    t?.labour_cgst_amount, t?.labour_sgst_amount, t?.labour_igst_amount,
  );

  return {
    bill_id: billId,
    fleet_id: opts.fleetId ?? null,
    vehicle_id: opts.vehicleId ?? null,

    bill_type: opts.billType ?? 'MAINTENANCE',
    bill_category: null,

    vendor_name: parsed.company_name ?? null,
    vendor_gstin: parsed.gstin ?? null,

    company_name: parsed.company_name ?? null,
    gstin: parsed.gstin ?? null,
    pan: parsed.pan ?? null,
    irn: parsed.irn ?? null,

    invoice_number: parsed.invoice_number ?? null,
    invoice_date: parsed.invoice_date ?? null,
    invoice_time: parsed.invoice_time ?? null,

    subtotal_amount: t?.sub_total_calculated ?? null,
    parts_amount: t?.parts_total ?? null,
    labour_amount: t?.labour_total ?? null,

    parts_cgst_amount: t?.parts_cgst_amount ?? null,
    parts_sgst_amount: t?.parts_sgst_amount ?? null,
    parts_igst_amount: t?.parts_igst_amount ?? null,
    parts_cgst_rate: t?.parts_cgst_rate ?? null,
    parts_sgst_rate: t?.parts_sgst_rate ?? null,
    parts_igst_rate: t?.parts_igst_rate ?? null,

    labour_cgst_amount: t?.labour_cgst_amount ?? null,
    labour_sgst_amount: t?.labour_sgst_amount ?? null,
    labour_igst_amount: t?.labour_igst_amount ?? null,
    labour_cgst_rate: t?.labour_cgst_rate ?? null,
    labour_sgst_rate: t?.labour_sgst_rate ?? null,
    labour_igst_rate: t?.labour_igst_rate ?? null,

    total_tax_amount: totalTax,
    grand_total_amount: t?.grand_total_invoice ?? null,

    deductibles: t?.deductibles ?? null,
    salvage: t?.salvage ?? null,

    odometer_reading: vd?.mileage_odometer_reading ?? null,
    registration_number: vd?.registration_number ?? null,
    chassis_number: vd?.chassis_number ?? null,

    ocr_status: 'OCR_COMPLETED',
    processing_status: null,
    confidence_score: parsed.confidence ?? null,

    review_reasons: hasParsedContent(parsed) ? computeReviewReasons(parsed) : null,

    file_url: opts.fileUrl ?? null,
    storage_path: opts.storagePath ?? null,

    raw_ocr_reference: opts.rawOcrReference ?? null,
    parsed_data: parsed,

    pipeline_mode: opts.pipelineMode ?? (opts.costInfo?.structuring == null && opts.costInfo?.extraction != null ? 'single' : 'split'),
    extraction_cost_usd: opts.costInfo?.extraction?.cost_usd ?? null,
    structuring_cost_usd: opts.costInfo?.structuring?.cost_usd ?? null,
    total_cost_usd: opts.costInfo?.total_cost_usd ?? null,
    extraction_tokens: opts.costInfo?.extraction?.usage.total_tokens ?? null,
    structuring_tokens: opts.costInfo?.structuring?.usage.total_tokens ?? null,
    total_tokens: opts.costInfo?.total_tokens ?? null,
    extraction_provider: opts.costInfo?.extraction?.provider ?? null,
    structuring_provider: opts.costInfo?.structuring?.provider ?? null,
    extraction_model: opts.costInfo?.extraction?.model ?? null,
    structuring_model: opts.costInfo?.structuring?.model ?? null,
    extraction_latency_ms: opts.costInfo?.extraction?.latency_ms ?? null,
    structuring_latency_ms: opts.costInfo?.structuring?.latency_ms ?? null,
    total_latency_ms: opts.costInfo
      ? (opts.costInfo.extraction?.latency_ms ?? 0) + (opts.costInfo.structuring?.latency_ms ?? 0) || null
      : null,

    schema_version: SCHEMA_VERSION,

    created_at: now,
    updated_at: now,
  };
}

function sumNullable(...vals: (number | null | undefined)[]): number | null {
  const nums = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

// ── billToInvoice ───────────────────────────────────────────────

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
  gstin?: string | null;
  pan?: string | null;
  registrationNumber?: string | null;
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
  pipelineMode?: 'split' | 'single' | null;
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
  fallbackReason?: string | null;
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
    provider: bill.structuring_provider ?? bill.extraction_provider ?? null,
    confidence: bill.confidence_score,
    error: bill.ocr_status === 'FAILED' ? (bill.processing_status ?? 'Processing failed') : null,
    vendorName: bill.vendor_name ?? bill.company_name,
    vendorAddress: null,
    vendorTaxId: bill.vendor_gstin ?? bill.gstin,
    gstin: bill.vendor_gstin ?? bill.gstin ?? null,
    pan: bill.pan ?? bill.parsed_data?.pan ?? null,
    registrationNumber: bill.registration_number
      ?? bill.parsed_data?.vehicle_details?.registration_number
      ?? null,
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
    pipelineMode: bill.pipeline_mode ?? null,
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
    fallbackReason: bill.processing_status?.startsWith('FALLBACK:')
      ? bill.processing_status.slice('FALLBACK:'.length).trim()
      : null,
  };
}

// ── toApiParsed (IMMUTABLE OCR response contract) ───────────────

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function resolveSideRates(
  cgstRate: number | null, sgstRate: number | null, igstRate: number | null,
  cgstAmt: number | null, sgstAmt: number | null, igstAmt: number | null,
): { cgst: number | null; sgst: number | null; igst: number | null } {
  const hasIgst = (igstAmt ?? 0) > 0;
  const hasCgstSgst = (cgstAmt ?? 0) > 0 || (sgstAmt ?? 0) > 0;
  if (hasIgst && !hasCgstSgst) return { cgst: null, sgst: null, igst: igstRate };
  if (hasCgstSgst && !hasIgst) return { cgst: cgstRate, sgst: sgstRate, igst: null };
  if (!hasIgst && !hasCgstSgst) return { cgst: null, sgst: null, igst: null };
  return { cgst: cgstRate, sgst: sgstRate, igst: igstRate };
}

function shapeTotals(t: TotalsAndTaxSummary | null | undefined) {
  t = t ?? {};
  const pr = resolveSideRates(
    num(t.parts_cgst_rate), num(t.parts_sgst_rate), num(t.parts_igst_rate),
    num(t.parts_cgst_amount), num(t.parts_sgst_amount), num(t.parts_igst_amount),
  );
  const lr = resolveSideRates(
    num(t.labour_cgst_rate), num(t.labour_sgst_rate), num(t.labour_igst_rate),
    num(t.labour_cgst_amount), num(t.labour_sgst_amount), num(t.labour_igst_amount),
  );
  return {
    parts_total: num(t.parts_total),
    labour_total: num(t.labour_total),
    parts_discount: num(t.parts_discount),
    labour_discount: num(t.labour_discount),
    parts_cgst_rate: pr.cgst,
    parts_igst_rate: pr.igst,
    parts_sgst_rate: pr.sgst,
    labour_cgst_rate: lr.cgst,
    labour_igst_rate: lr.igst,
    labour_sgst_rate: lr.sgst,
    parts_cgst_amount: num(t.parts_cgst_amount),
    parts_igst_amount: num(t.parts_igst_amount),
    parts_sgst_amount: num(t.parts_sgst_amount),
    labour_cgst_amount: num(t.labour_cgst_amount),
    labour_igst_amount: num(t.labour_igst_amount),
    labour_sgst_amount: num(t.labour_sgst_amount),
    sub_total_calculated: num(t.sub_total_calculated),
    grand_total_invoice: num(t.grand_total_invoice),
    parts_special_discount: num(t.parts_special_discount),
    labour_special_discount: num(t.labour_special_discount),
    deductibles: num(t.deductibles),
    salvage: num(t.salvage),
  };
}

function shapeParts(p: PartsLineItem) {
  return {
    rate: num(p.rate),
    quantity: num(p.quantity),
    hsn_sac_code: str(p.hsn_sac_code),
    tax_percentage: num(p.tax_percentage),
    taxable_amount: num(p.taxable_amount),
    item_name_description: str(p.item_name_description),
    part_number_item_code: str(p.part_number_item_code),
  };
}

function shapeLabour(l: LabourServiceLineItem) {
  return {
    labour_code: str(l.labour_code),
    hsn_sac_code: str(l.hsn_sac_code),
    labour_charges: num(l.labour_charges),
    tax_percentage: num(l.tax_percentage),
    labour_description: str(l.labour_description),
  };
}

export function toApiParsed(d: ParsedInvoiceData | null | undefined) {
  d = d ?? {};
  const sd = (d.service_details ?? {}) as ServiceDetails;
  const vd = (d.vehicle_details ?? {}) as VehicleDetails;
  return {
    irn: str(d.irn),
    pan: str(d.pan),
    gstin: str(d.gstin),
    company_name: str(d.company_name),
    invoice_date: str(d.invoice_date),
    invoice_time: str(d.invoice_time),
    invoice_number: str(d.invoice_number),
    service_details: {
      last_service: str(sd.last_service),
      service_type: str(sd.service_type),
      next_service_due: str(sd.next_service_due),
    },
    vehicle_details: {
      chassis_number: str(vd.chassis_number),
      registration_number: str(vd.registration_number),
      mileage_odometer_reading: num(vd.mileage_odometer_reading),
    },
    parts_line_items: (d.parts_line_items ?? []).map(shapeParts),
    labour_service_line_items: (d.labour_service_line_items ?? []).map(shapeLabour),
    totals_and_tax_summary: shapeTotals(d.totals_and_tax_summary),
  };
}
