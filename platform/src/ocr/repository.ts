/**
 * OCR Repository — data access layer for bills and bill parts.
 * Contains the actual Postgres CRUD. No re-exports — all DB code lives here.
 */
import { v4 as uuid } from 'uuid';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../config/db.js';
import { bills, billParts } from '../db/schema.js';
import { getSettings } from '../shared/settings.js';
import type { BillDoc, BillPartDoc, BillType, BillStatus, ParsedInvoiceData, LineType } from '../shared/types.js';
import type { AppSettings } from '../shared/settings.js';

export type { BillDoc, BillPartDoc, BillType, BillStatus, ParsedInvoiceData, AppSettings };
export { getSettings };

// ─── Row <-> Doc mapping ─────────────────────────────────────────────────────

function billRowToDoc(row: typeof bills.$inferSelect): BillDoc {
  return {
    bill_id: row.billId,
    fleet_id: row.fleetId,
    vehicle_id: row.vehicleId,
    bill_type: row.billType as BillType,
    bill_category: row.billCategory,
    vendor_name: row.vendorName,
    vendor_gstin: row.vendorGstin,
    company_name: row.companyName,
    gstin: row.gstin,
    pan: row.pan,
    irn: row.irn,
    invoice_number: row.invoiceNumber,
    invoice_date: row.invoiceDate,
    invoice_time: row.invoiceTime,
    subtotal_amount: row.subtotalAmount,
    parts_amount: row.partsAmount,
    labour_amount: row.labourAmount,
    parts_cgst_amount: row.partsCgstAmount,
    parts_sgst_amount: row.partsSgstAmount,
    parts_igst_amount: row.partsIgstAmount,
    parts_cgst_rate: row.partsCgstRate,
    parts_sgst_rate: row.partsSgstRate,
    parts_igst_rate: row.partsIgstRate,
    labour_cgst_amount: row.labourCgstAmount,
    labour_sgst_amount: row.labourSgstAmount,
    labour_igst_amount: row.labourIgstAmount,
    labour_cgst_rate: row.labourCgstRate,
    labour_sgst_rate: row.labourSgstRate,
    labour_igst_rate: row.labourIgstRate,
    total_tax_amount: row.totalTaxAmount,
    grand_total_amount: row.grandTotalAmount,
    deductibles: row.deductibles,
    salvage: row.salvage,
    odometer_reading: row.odometerReading,
    registration_number: row.registrationNumber,
    chassis_number: row.chassisNumber,
    ocr_status: row.ocrStatus as BillStatus,
    processing_status: row.processingStatus,
    confidence_score: row.confidenceScore,
    review_reasons: row.reviewReasons,
    file_url: row.fileUrl,
    storage_path: row.storagePath,
    raw_ocr_reference: row.rawOcrReference,
    parsed_data: row.parsedData as ParsedInvoiceData | null,
    pipeline_mode: row.pipelineMode as 'split' | 'single' | null,
    extraction_cost_usd: row.extractionCostUsd,
    structuring_cost_usd: row.structuringCostUsd,
    total_cost_usd: row.totalCostUsd,
    extraction_tokens: row.extractionTokens,
    extraction_input_tokens: row.extractionInputTokens,
    extraction_output_tokens: row.extractionOutputTokens,
    structuring_tokens: row.structuringTokens,
    structuring_input_tokens: row.structuringInputTokens,
    structuring_output_tokens: row.structuringOutputTokens,
    total_tokens: row.totalTokens,
    total_input_tokens: row.totalInputTokens,
    total_output_tokens: row.totalOutputTokens,
    total_thinking_tokens: row.totalThinkingTokens,
    total_input_cost_usd: row.totalInputCostUsd,
    total_output_cost_usd: row.totalOutputCostUsd,
    extraction_provider: row.extractionProvider,
    structuring_provider: row.structuringProvider,
    extraction_model: row.extractionModel,
    structuring_model: row.structuringModel,
    extraction_latency_ms: row.extractionLatencyMs,
    structuring_latency_ms: row.structuringLatencyMs,
    total_latency_ms: row.totalLatencyMs,
    vendor_id: row.vendorId,
    input_rate_per_1m: row.inputRatePer1m,
    output_rate_per_1m: row.outputRatePer1m,
    fx_rate_usd_inr: row.fxRateUsdInr,
    schema_version: row.schemaVersion,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function billDocToRow(b: BillDoc) {
  return {
    billId: b.bill_id,
    fleetId: b.fleet_id ?? null,
    vehicleId: b.vehicle_id ?? null,
    billType: b.bill_type,
    billCategory: b.bill_category ?? null,
    vendorName: b.vendor_name ?? null,
    vendorGstin: b.vendor_gstin ?? null,
    companyName: b.company_name ?? null,
    gstin: b.gstin ?? null,
    pan: b.pan ?? null,
    irn: b.irn ?? null,
    invoiceNumber: b.invoice_number ?? null,
    invoiceDate: b.invoice_date ?? null,
    invoiceTime: b.invoice_time ?? null,
    subtotalAmount: b.subtotal_amount ?? null,
    partsAmount: b.parts_amount ?? null,
    labourAmount: b.labour_amount ?? null,
    partsCgstAmount: b.parts_cgst_amount ?? null,
    partsSgstAmount: b.parts_sgst_amount ?? null,
    partsIgstAmount: b.parts_igst_amount ?? null,
    partsCgstRate: b.parts_cgst_rate ?? null,
    partsSgstRate: b.parts_sgst_rate ?? null,
    partsIgstRate: b.parts_igst_rate ?? null,
    labourCgstAmount: b.labour_cgst_amount ?? null,
    labourSgstAmount: b.labour_sgst_amount ?? null,
    labourIgstAmount: b.labour_igst_amount ?? null,
    labourCgstRate: b.labour_cgst_rate ?? null,
    labourSgstRate: b.labour_sgst_rate ?? null,
    labourIgstRate: b.labour_igst_rate ?? null,
    totalTaxAmount: b.total_tax_amount ?? null,
    grandTotalAmount: b.grand_total_amount ?? null,
    deductibles: b.deductibles ?? null,
    salvage: b.salvage ?? null,
    odometerReading: b.odometer_reading ?? null,
    registrationNumber: b.registration_number ?? null,
    chassisNumber: b.chassis_number ?? null,
    ocrStatus: b.ocr_status,
    processingStatus: b.processing_status ?? null,
    confidenceScore: b.confidence_score ?? null,
    reviewReasons: b.review_reasons ?? null,
    fileUrl: b.file_url ?? null,
    storagePath: b.storage_path ?? null,
    rawOcrReference: b.raw_ocr_reference ?? null,
    parsedData: b.parsed_data ?? null,
    pipelineMode: b.pipeline_mode ?? null,
    extractionCostUsd: b.extraction_cost_usd ?? null,
    structuringCostUsd: b.structuring_cost_usd ?? null,
    totalCostUsd: b.total_cost_usd ?? null,
    extractionTokens: b.extraction_tokens ?? null,
    extractionInputTokens: b.extraction_input_tokens ?? null,
    extractionOutputTokens: b.extraction_output_tokens ?? null,
    structuringTokens: b.structuring_tokens ?? null,
    structuringInputTokens: b.structuring_input_tokens ?? null,
    structuringOutputTokens: b.structuring_output_tokens ?? null,
    totalTokens: b.total_tokens ?? null,
    totalInputTokens: b.total_input_tokens ?? null,
    totalOutputTokens: b.total_output_tokens ?? null,
    totalThinkingTokens: b.total_thinking_tokens ?? null,
    totalInputCostUsd: b.total_input_cost_usd ?? null,
    totalOutputCostUsd: b.total_output_cost_usd ?? null,
    extractionProvider: b.extraction_provider ?? null,
    structuringProvider: b.structuring_provider ?? null,
    extractionModel: b.extraction_model ?? null,
    structuringModel: b.structuring_model ?? null,
    extractionLatencyMs: b.extraction_latency_ms ?? null,
    structuringLatencyMs: b.structuring_latency_ms ?? null,
    totalLatencyMs: b.total_latency_ms ?? null,
    vendorId: b.vendor_id ?? null,
    inputRatePer1m: b.input_rate_per_1m ?? null,
    outputRatePer1m: b.output_rate_per_1m ?? null,
    fxRateUsdInr: b.fx_rate_usd_inr ?? null,
    schemaVersion: b.schema_version,
    createdAt: new Date(b.created_at),
    updatedAt: new Date(b.updated_at),
  };
}

function partRowToDoc(row: typeof billParts.$inferSelect): BillPartDoc {
  return {
    part_id: row.partId,
    bill_id: row.billId,
    line_type: row.lineType as LineType,
    name: row.name,
    description: row.description,
    quantity: row.quantity,
    rate: row.rate,
    amount: row.amount,
    tax_percentage: row.taxPercentage,
    tax_amount: row.taxAmount,
    part_number: row.partNumber,
    hsn_sac_code: row.hsnSacCode,
    manufacturer: row.manufacturer,
    normalized_name: row.normalizedName,
    confidence_score: row.confidenceScore,
    created_at: row.createdAt.toISOString(),
  };
}

function partDocToRow(p: BillPartDoc) {
  return {
    partId: p.part_id,
    billId: p.bill_id,
    lineType: p.line_type,
    name: p.name ?? null,
    description: p.description ?? null,
    quantity: p.quantity ?? null,
    rate: p.rate ?? null,
    amount: p.amount ?? null,
    taxPercentage: p.tax_percentage ?? null,
    taxAmount: p.tax_amount ?? null,
    partNumber: p.part_number ?? null,
    hsnSacCode: p.hsn_sac_code ?? null,
    manufacturer: p.manufacturer ?? null,
    normalizedName: p.normalized_name ?? null,
    confidenceScore: p.confidence_score ?? null,
    createdAt: new Date(p.created_at),
  };
}

// ─── Bill CRUD ──────────────────────────────────────────────────────────────

export async function createBill(bill: BillDoc): Promise<BillDoc> {
  await db().insert(bills).values(billDocToRow(bill));
  return bill;
}

export async function getBill(billId: string): Promise<BillDoc | null> {
  const [row] = await db().select().from(bills).where(eq(bills.billId, billId)).limit(1);
  return row ? billRowToDoc(row) : null;
}

/** BillDoc (snake_case) key -> bills table (camelCase) column key. Excludes bill_id/created_at/updated_at. */
const BILL_FIELD_MAP: Partial<Record<keyof BillDoc, keyof typeof bills.$inferInsert>> = {
  fleet_id: 'fleetId', vehicle_id: 'vehicleId', bill_type: 'billType', bill_category: 'billCategory',
  vendor_name: 'vendorName', vendor_gstin: 'vendorGstin', company_name: 'companyName', gstin: 'gstin',
  pan: 'pan', irn: 'irn', invoice_number: 'invoiceNumber', invoice_date: 'invoiceDate',
  invoice_time: 'invoiceTime', subtotal_amount: 'subtotalAmount', parts_amount: 'partsAmount',
  labour_amount: 'labourAmount', parts_cgst_amount: 'partsCgstAmount', parts_sgst_amount: 'partsSgstAmount',
  parts_igst_amount: 'partsIgstAmount', parts_cgst_rate: 'partsCgstRate', parts_sgst_rate: 'partsSgstRate',
  parts_igst_rate: 'partsIgstRate', labour_cgst_amount: 'labourCgstAmount', labour_sgst_amount: 'labourSgstAmount',
  labour_igst_amount: 'labourIgstAmount', labour_cgst_rate: 'labourCgstRate', labour_sgst_rate: 'labourSgstRate',
  labour_igst_rate: 'labourIgstRate', total_tax_amount: 'totalTaxAmount', grand_total_amount: 'grandTotalAmount',
  deductibles: 'deductibles', salvage: 'salvage', odometer_reading: 'odometerReading',
  registration_number: 'registrationNumber', chassis_number: 'chassisNumber', ocr_status: 'ocrStatus',
  processing_status: 'processingStatus', confidence_score: 'confidenceScore', review_reasons: 'reviewReasons',
  file_url: 'fileUrl', storage_path: 'storagePath', raw_ocr_reference: 'rawOcrReference',
  parsed_data: 'parsedData', pipeline_mode: 'pipelineMode', extraction_cost_usd: 'extractionCostUsd',
  structuring_cost_usd: 'structuringCostUsd', total_cost_usd: 'totalCostUsd', extraction_tokens: 'extractionTokens',
  extraction_input_tokens: 'extractionInputTokens', extraction_output_tokens: 'extractionOutputTokens',
  structuring_tokens: 'structuringTokens', structuring_input_tokens: 'structuringInputTokens',
  structuring_output_tokens: 'structuringOutputTokens', total_tokens: 'totalTokens',
  total_input_tokens: 'totalInputTokens', total_output_tokens: 'totalOutputTokens',
  total_thinking_tokens: 'totalThinkingTokens', total_input_cost_usd: 'totalInputCostUsd',
  total_output_cost_usd: 'totalOutputCostUsd', extraction_provider: 'extractionProvider',
  structuring_provider: 'structuringProvider', extraction_model: 'extractionModel',
  structuring_model: 'structuringModel', extraction_latency_ms: 'extractionLatencyMs',
  structuring_latency_ms: 'structuringLatencyMs', total_latency_ms: 'totalLatencyMs',
  vendor_id: 'vendorId', input_rate_per_1m: 'inputRatePer1m', output_rate_per_1m: 'outputRatePer1m', fx_rate_usd_inr: 'fxRateUsdInr', schema_version: 'schemaVersion',
};

export async function updateBill(billId: string, updates: Partial<BillDoc>): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of Object.keys(updates) as (keyof BillDoc)[]) {
    const column = BILL_FIELD_MAP[key];
    if (!column) continue;
    patch[column] = (updates as Record<string, unknown>)[key];
  }
  await db().update(bills).set(patch).where(eq(bills.billId, billId));
}

export async function updateBillStatus(billId: string, status: BillStatus, extra?: Partial<BillDoc>): Promise<void> {
  await updateBill(billId, { ocr_status: status, ...extra });
}

export async function listBills(opts: {
  status?: BillStatus;
  vehicleId?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<BillDoc[]> {
  const conditions = [];
  if (opts.status) conditions.push(eq(bills.ocrStatus, opts.status));
  if (opts.vehicleId) conditions.push(eq(bills.vehicleId, opts.vehicleId));

  const rows = await db().select().from(bills)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(bills.createdAt))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
  return rows.map(billRowToDoc);
}

/**
 * Fetch every bill (optionally filtered by status) for aggregation — analytics, fraud.
 * No document cap: the Firestore-era 25k-doc scan limit doesn't apply to a real query engine.
 */
export async function fetchAllBills(opts: { status?: BillStatus } = {}): Promise<BillDoc[]> {
  const rows = await db().select().from(bills)
    .where(opts.status ? eq(bills.ocrStatus, opts.status) : undefined)
    .orderBy(desc(bills.createdAt));
  return rows.map(billRowToDoc);
}

export function billNeedsReview(b: BillDoc): boolean {
  if (b.ocr_status === 'VERIFIED') return false;
  if (b.ocr_status !== 'OCR_COMPLETED') return false;
  if ((b.confidence_score ?? 1) < 0.75) return true;
  return (b.review_reasons?.length ?? 0) > 0;
}

export interface PaginatedBills {
  bills: BillDoc[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const ALL_STATUSES: BillStatus[] = ['DRAFT', 'UPLOADED', 'PROCESSING', 'OCR_COMPLETED', 'VERIFIED', 'FAILED'];

/** Count bills matching an optional status filter — real COUNT(*), no document reads. */
export async function countBills(status?: BillStatus): Promise<number> {
  const [row] = await db().select({ n: count() }).from(bills)
    .where(status ? eq(bills.ocrStatus, status) : undefined);
  return row?.n ?? 0;
}

/** Count bills per status, plus needs-review / completed-clean, in a single GROUP BY. */
export async function countAllStatuses(): Promise<Record<string, number>> {
  const rows = await db().select({ status: bills.ocrStatus, n: count() }).from(bills).groupBy(bills.ocrStatus);
  const counts: Record<string, number> = { all: 0 };
  for (const s of ALL_STATUSES) counts[s] = 0;
  for (const row of rows) {
    counts[row.status] = row.n;
    counts.all += row.n;
  }

  // needs_review requires the confidence/review_reasons predicate — cheap in Postgres, no cap needed.
  const reviewCandidates = await db().select().from(bills).where(eq(bills.ocrStatus, 'OCR_COMPLETED'));
  const needsReview = reviewCandidates.map(billRowToDoc).filter(billNeedsReview).length;
  counts.needs_review = needsReview;
  const completedRaw = (counts['OCR_COMPLETED'] ?? 0) + (counts['VERIFIED'] ?? 0);
  counts.completed_clean = Math.max(0, completedRaw - needsReview);
  return counts;
}

/**
 * Page-based pagination ordered by updated_at DESC.
 * Supports status, multi-status (statuses), needsReview, and text search (q).
 */
export async function listBillsPaginated(opts: {
  page?: number;
  pageSize?: number;
  status?: BillStatus;
  /** When set, match any of these statuses (e.g. OCR_COMPLETED + VERIFIED). */
  statuses?: BillStatus[];
  /** Only bills that need human review (low confidence / review_reasons). */
  needsReview?: boolean;
  /** When true with statuses=completed, exclude needs-review bills. */
  excludeNeedsReview?: boolean;
  q?: string;
} = {}): Promise<PaginatedBills> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 10, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);
  const skip = (page - 1) * pageSize;
  const searchTerm = opts.q?.trim();

  const conditions = [];
  if (opts.statuses?.length) {
    conditions.push(inArray(bills.ocrStatus, opts.statuses));
  } else if (opts.status) {
    conditions.push(eq(bills.ocrStatus, opts.status));
  }
  if (searchTerm) {
    const pattern = `%${searchTerm}%`;
    conditions.push(or(
      ilike(bills.vendorName, pattern),
      ilike(bills.companyName, pattern),
      ilike(bills.invoiceNumber, pattern),
      ilike(bills.registrationNumber, pattern),
    )!);
  }

  // needsReview / excludeNeedsReview depend on billNeedsReview(), which isn't a simple
  // column predicate (it combines status + confidence + review_reasons length) — evaluate
  // it in JS against the already status/search-filtered rows rather than trying to express
  // it as SQL. Cheap: this only runs when a review filter is actually requested.
  if (opts.needsReview || opts.excludeNeedsReview) {
    const candidateConditions = [...conditions];
    if (!opts.statuses?.length && !opts.status) candidateConditions.push(eq(bills.ocrStatus, 'OCR_COMPLETED'));
    const rows = await db().select().from(bills)
      .where(candidateConditions.length ? and(...candidateConditions) : undefined)
      .orderBy(desc(bills.updatedAt));
    let docs = rows.map(billRowToDoc);
    if (opts.needsReview) docs = docs.filter(billNeedsReview);
    else if (opts.excludeNeedsReview) docs = docs.filter((b) => !billNeedsReview(b));
    const total = docs.length;
    return {
      bills: docs.slice(skip, skip + pageSize), total, page, pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const [rows, [{ n: total }]] = await Promise.all([
    db().select().from(bills).where(where).orderBy(desc(bills.updatedAt)).limit(pageSize).offset(skip),
    db().select({ n: count() }).from(bills).where(where),
  ]);

  return { bills: rows.map(billRowToDoc), total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 };
}

/**
 * Find existing bills with the same invoice_number (and optionally vendor_gstin).
 * Excludes the bill with excludeId so a bill doesn't match itself.
 * Returns [] if invoice_number is null/empty.
 */
export async function findDuplicateBills(
  invoiceNumber: string | null | undefined,
  vendorGstin: string | null | undefined,
  excludeId: string,
): Promise<BillDoc[]> {
  if (!invoiceNumber) return [];

  const conditions = [eq(bills.invoiceNumber, invoiceNumber)];
  if (vendorGstin) conditions.push(eq(bills.vendorGstin, vendorGstin));

  const rows = await db().select().from(bills).where(and(...conditions)).limit(5);
  return rows.map(billRowToDoc).filter((b) => b.bill_id !== excludeId);
}

/** Cascade FK on bill_parts.bill_id removes parts automatically — no separate cleanup needed. */
export async function deleteBill(billId: string): Promise<void> {
  await db().delete(bills).where(eq(bills.billId, billId));
}

// ─── Bill Parts CRUD ────────────────────────────────────────────────────────

export async function getPartsForBill(billId: string): Promise<BillPartDoc[]> {
  const rows = await db().select().from(billParts).where(eq(billParts.billId, billId));
  return rows.map(partRowToDoc);
}

export async function deletePartsForBill(billId: string): Promise<number> {
  const deleted = await db().delete(billParts).where(eq(billParts.billId, billId)).returning({ id: billParts.partId });
  return deleted.length;
}

export function extractPartsFromParsed(billId: string, parsed: ParsedInvoiceData): BillPartDoc[] {
  const now = new Date().toISOString();
  const parts: BillPartDoc[] = [];

  for (const p of parsed.parts_line_items ?? []) {
    parts.push({
      part_id: uuid(), bill_id: billId, line_type: 'PART' as LineType,
      name: p.item_name_description ?? null, description: p.item_name_description ?? null,
      quantity: p.quantity ?? null, rate: p.rate ?? null,
      amount: p.taxable_amount ?? null, tax_percentage: p.tax_percentage ?? null,
      tax_amount: null, part_number: p.part_number_item_code ?? null,
      hsn_sac_code: p.hsn_sac_code ?? null, manufacturer: null,
      normalized_name: null, confidence_score: null, created_at: now,
    });
  }

  for (const l of parsed.labour_service_line_items ?? []) {
    parts.push({
      part_id: uuid(), bill_id: billId, line_type: 'LABOUR' as LineType,
      name: l.labour_description ?? null, description: l.labour_description ?? null,
      quantity: 1, rate: l.labour_charges ?? null,
      amount: l.labour_charges ?? null, tax_percentage: l.tax_percentage ?? null,
      tax_amount: null, part_number: l.labour_code ?? null,
      hsn_sac_code: l.hsn_sac_code ?? null, manufacturer: null,
      normalized_name: null, confidence_score: null, created_at: now,
    });
  }

  return parts;
}

export async function saveBillParts(parts: BillPartDoc[]): Promise<void> {
  if (!parts.length) return;
  await db().insert(billParts).values(parts.map(partDocToRow));
}
