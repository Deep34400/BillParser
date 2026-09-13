/**
 * OCR Repository — data access layer for bills and bill parts.
 * Sequelize-backed Postgres CRUD.
 */
import { v4 as uuid } from 'uuid';
import { Op, fn, col, literal } from 'sequelize';
import { Bill, BillPart } from './models/index.js';
import { toNum } from '../shared/numbers.js';
import { getSettings } from '../shared/settings.js';
import type { BillDoc, BillPartDoc, BillType, BillStatus, ParsedInvoiceData, LineType } from '../shared/types.js';
import type { AppSettings } from '../shared/settings.js';

export type { BillDoc, BillPartDoc, BillType, BillStatus, ParsedInvoiceData, AppSettings };
export { getSettings };

// ─── Row <-> Doc mapping ─────────────────────────────────────────────────────

function billRowToDoc(row: Bill): BillDoc {
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
    subtotal_amount: toNum(row.subtotalAmount),
    parts_amount: toNum(row.partsAmount),
    labour_amount: toNum(row.labourAmount),
    parts_cgst_amount: toNum(row.partsCgstAmount),
    parts_sgst_amount: toNum(row.partsSgstAmount),
    parts_igst_amount: toNum(row.partsIgstAmount),
    parts_cgst_rate: toNum(row.partsCgstRate),
    parts_sgst_rate: toNum(row.partsSgstRate),
    parts_igst_rate: toNum(row.partsIgstRate),
    labour_cgst_amount: toNum(row.labourCgstAmount),
    labour_sgst_amount: toNum(row.labourSgstAmount),
    labour_igst_amount: toNum(row.labourIgstAmount),
    labour_cgst_rate: toNum(row.labourCgstRate),
    labour_sgst_rate: toNum(row.labourSgstRate),
    labour_igst_rate: toNum(row.labourIgstRate),
    total_tax_amount: toNum(row.totalTaxAmount),
    grand_total_amount: toNum(row.grandTotalAmount),
    deductibles: toNum(row.deductibles),
    salvage: toNum(row.salvage),
    odometer_reading: toNum(row.odometerReading),
    registration_number: row.registrationNumber,
    chassis_number: row.chassisNumber,
    ocr_status: row.ocrStatus as BillStatus,
    processing_status: row.processingStatus,
    confidence_score: toNum(row.confidenceScore),
    review_reasons: row.reviewReasons,
    file_url: row.fileUrl,
    storage_path: row.storagePath,
    raw_ocr_reference: row.rawOcrReference,
    parsed_data: row.parsedData as ParsedInvoiceData | null,
    pipeline_mode: row.pipelineMode as 'split' | 'single' | null,
    extraction_cost_usd: toNum(row.extractionCostUsd),
    structuring_cost_usd: toNum(row.structuringCostUsd),
    total_cost_usd: toNum(row.totalCostUsd),
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
    total_input_cost_usd: toNum(row.totalInputCostUsd),
    total_output_cost_usd: toNum(row.totalOutputCostUsd),
    extraction_provider: row.extractionProvider,
    structuring_provider: row.structuringProvider,
    extraction_model: row.extractionModel,
    structuring_model: row.structuringModel,
    extraction_latency_ms: row.extractionLatencyMs,
    structuring_latency_ms: row.structuringLatencyMs,
    total_latency_ms: row.totalLatencyMs,
    vendor_id: row.vendorId,
    review_codes: row.reviewCodes,
    total_reconciliation: row.totalReconciliation as BillDoc['total_reconciliation'],
    fallback_attempts: row.fallbackAttempts,
    fallback_history: row.fallbackHistory as BillDoc['fallback_history'],
    extraction_pages: row.extractionPages,
    input_rate_per_1m: toNum(row.inputRatePer1m),
    output_rate_per_1m: toNum(row.outputRatePer1m),
    fx_rate_usd_inr: toNum(row.fxRateUsdInr),
    approval_status: row.approvalStatus ?? 'not_required',
    approved_by: row.approvedBy ?? null,
    approved_at: row.approvedAt?.toISOString() ?? null,
    rejection_reason: row.rejectionReason ?? null,
    submitted_by: row.submittedBy ?? null,
    approval_step: row.approvalStep ?? null,
    schema_version: row.schemaVersion,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function billDocToRow(b: BillDoc): Record<string, unknown> {
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
    reviewCodes: b.review_codes ?? null,
    totalReconciliation: b.total_reconciliation ?? null,
    fallbackAttempts: b.fallback_attempts ?? null,
    fallbackHistory: b.fallback_history ?? null,
    extractionPages: b.extraction_pages ?? null,
    inputRatePer1m: b.input_rate_per_1m ?? null,
    outputRatePer1m: b.output_rate_per_1m ?? null,
    fxRateUsdInr: b.fx_rate_usd_inr ?? null,
    approvalStatus: b.approval_status ?? 'not_required',
    approvedBy: b.approved_by ?? null,
    approvedAt: b.approved_at ? new Date(b.approved_at) : null,
    rejectionReason: b.rejection_reason ?? null,
    submittedBy: b.submitted_by ?? null,
    approvalStep: b.approval_step ?? null,
    schemaVersion: b.schema_version,
    createdAt: new Date(b.created_at),
    updatedAt: new Date(b.updated_at),
  };
}

function partRowToDoc(row: BillPart): BillPartDoc {
  return {
    part_id: row.partId,
    bill_id: row.billId,
    line_type: row.lineType as LineType,
    name: row.name,
    description: row.description,
    quantity: toNum(row.quantity),
    rate: toNum(row.rate),
    amount: toNum(row.amount),
    tax_percentage: toNum(row.taxPercentage),
    tax_amount: toNum(row.taxAmount),
    part_number: row.partNumber,
    hsn_sac_code: row.hsnSacCode,
    manufacturer: row.manufacturer,
    normalized_name: row.normalizedName,
    confidence_score: row.confidenceScore,
    created_at: row.createdAt.toISOString(),
  };
}

function partDocToRow(p: BillPartDoc): Record<string, unknown> {
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
  await Bill.create(billDocToRow(bill) as any);
  return bill;
}

export async function getBill(billId: string): Promise<BillDoc | null> {
  const row = await Bill.findByPk(billId);
  return row ? billRowToDoc(row) : null;
}

/** BillDoc (snake_case) key -> Bill model (camelCase) attribute key. */
const BILL_FIELD_MAP: Partial<Record<keyof BillDoc, string>> = {
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
  review_codes: 'reviewCodes', total_reconciliation: 'totalReconciliation', fallback_attempts: 'fallbackAttempts',
  fallback_history: 'fallbackHistory',
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
  vendor_id: 'vendorId', input_rate_per_1m: 'inputRatePer1m', output_rate_per_1m: 'outputRatePer1m',
  fx_rate_usd_inr: 'fxRateUsdInr', schema_version: 'schemaVersion',
  extraction_pages: 'extractionPages',
  approval_status: 'approvalStatus', approved_by: 'approvedBy', approved_at: 'approvedAt',
  rejection_reason: 'rejectionReason', submitted_by: 'submittedBy', approval_step: 'approvalStep',
};

export async function updateBill(billId: string, updates: Partial<BillDoc>): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of Object.keys(updates) as (keyof BillDoc)[]) {
    const column = BILL_FIELD_MAP[key];
    if (!column) continue;
    patch[column] = (updates as Record<string, unknown>)[key];
  }
  await Bill.update(patch, { where: { billId } });
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
  const where: Record<string, unknown> = {};
  if (opts.status) where.ocrStatus = opts.status;
  if (opts.vehicleId) where.vehicleId = opts.vehicleId;

  const rows = await Bill.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: opts.limit ?? 50,
    offset: opts.offset ?? 0,
  });
  return rows.map(billRowToDoc);
}

export async function fetchAllBills(opts: { status?: BillStatus } = {}): Promise<BillDoc[]> {
  const where: Record<string, unknown> = {};
  if (opts.status) where.ocrStatus = opts.status;

  const rows = await Bill.findAll({ where, order: [['createdAt', 'DESC']] });
  return rows.map(billRowToDoc);
}

export function billNeedsReview(b: BillDoc): boolean {
  return b.ocr_status === 'NEED_REVIEW';
}

export function billReviewCodes(b: BillDoc): string[] {
  if (b.review_codes?.length) return b.review_codes;
  const reasons = b.review_reasons ?? [];
  const codes: string[] = [];
  for (const r of reasons) {
    if (/GSTIN or PAN|handwritten/i.test(r)) codes.push('MISSING_TAX_ID');
    if (/Total mismatch|Grand total missing/i.test(r)) codes.push('TOTAL_MISMATCH');
    if (/Parts base/i.test(r)) codes.push('PARTS_BASE_MISMATCH');
    if (/Labour base/i.test(r)) codes.push('LABOUR_BASE_MISMATCH');
  }
  return [...new Set(codes)];
}

export function billHasReviewCode(b: BillDoc, code: string): boolean {
  return billReviewCodes(b).includes(code);
}

import { REVIEW_CODE_KEYS } from '../shared/constants.js';
export { REVIEW_CODE_KEYS };

export interface PaginatedBills {
  bills: BillDoc[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const ALL_STATUSES: BillStatus[] = ['DRAFT', 'UPLOADED', 'PROCESSING', 'OCR_COMPLETED', 'NEED_REVIEW', 'VERIFIED', 'FAILED'];

export async function countBills(status?: BillStatus): Promise<number> {
  const where: Record<string, unknown> = {};
  if (status) where.ocrStatus = status;
  return Bill.count({ where });
}

export async function countAllStatuses(): Promise<Record<string, number>> {
  const rows = await Bill.findAll({
    attributes: ['ocrStatus', [fn('COUNT', col('bill_id')), 'n']],
    group: ['ocrStatus'],
    raw: true,
  }) as unknown as { ocrStatus: string; n: string }[];

  const counts: Record<string, number> = { all: 0 };
  for (const s of ALL_STATUSES) counts[s] = 0;
  for (const row of rows) {
    counts[row.ocrStatus] = Number(row.n);
    counts.all += Number(row.n);
  }

  counts.needs_review = counts['NEED_REVIEW'] ?? 0;
  counts.completed_clean = (counts['OCR_COMPLETED'] ?? 0) + (counts['VERIFIED'] ?? 0);

  for (const code of REVIEW_CODE_KEYS) counts[`review_${code}`] = 0;
  if (counts.needs_review > 0) {
    const needsReviewRows = await Bill.findAll({ where: { ocrStatus: 'NEED_REVIEW' } });
    const docs = needsReviewRows.map(billRowToDoc);
    for (const code of REVIEW_CODE_KEYS) {
      counts[`review_${code}`] = docs.filter((b) => billHasReviewCode(b, code)).length;
    }
  }
  return counts;
}

export async function listBillsPaginated(opts: {
  page?: number;
  pageSize?: number;
  status?: BillStatus;
  statuses?: BillStatus[];
  needsReview?: boolean;
  reviewCode?: string;
  excludeNeedsReview?: boolean;
  q?: string;
} = {}): Promise<PaginatedBills> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 10, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);
  const skip = (page - 1) * pageSize;
  const searchTerm = opts.q?.trim();

  const where: any = {};

  if (opts.statuses?.length) {
    where.ocrStatus = { [Op.in]: opts.statuses };
  } else if (opts.status) {
    where.ocrStatus = opts.status;
  }

  if (searchTerm) {
    const pattern = `%${searchTerm}%`;
    where[Op.or] = [
      { vendorName: { [Op.iLike]: pattern } },
      { companyName: { [Op.iLike]: pattern } },
      { invoiceNumber: { [Op.iLike]: pattern } },
      { registrationNumber: { [Op.iLike]: pattern } },
    ];
  }

  if (opts.needsReview) where.ocrStatus = 'NEED_REVIEW';
  else if (opts.excludeNeedsReview) where.ocrStatus = { [Op.ne]: 'NEED_REVIEW' };

  if (opts.reviewCode) {
    const allRows = await Bill.findAll({ where, order: [['updatedAt', 'DESC']] });
    const docs = allRows.map(billRowToDoc).filter((b) => billHasReviewCode(b, opts.reviewCode!));
    const total = docs.length;
    return {
      bills: docs.slice(skip, skip + pageSize), total, page, pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  const { count: total, rows } = await Bill.findAndCountAll({
    where,
    order: [['updatedAt', 'DESC']],
    limit: pageSize,
    offset: skip,
  });

  return { bills: rows.map(billRowToDoc), total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 };
}

export async function findDuplicateBills(
  invoiceNumber: string | null | undefined,
  vendorGstin: string | null | undefined,
  excludeId: string,
): Promise<BillDoc[]> {
  if (!invoiceNumber) return [];

  const where: any = { invoiceNumber };
  if (vendorGstin) where.vendorGstin = vendorGstin;

  const rows = await Bill.findAll({ where, limit: 5 });
  return rows.map(billRowToDoc).filter((b) => b.bill_id !== excludeId);
}

export async function deleteBill(billId: string): Promise<void> {
  await Bill.destroy({ where: { billId } });
}

// ─── Bill Parts CRUD ────────────────────────────────────────────────────────

export async function getPartsForBill(billId: string): Promise<BillPartDoc[]> {
  const rows = await BillPart.findAll({ where: { billId } });
  return rows.map(partRowToDoc);
}

export async function deletePartsForBill(billId: string): Promise<number> {
  return BillPart.destroy({ where: { billId } });
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

export async function listBillsByCreatedAtRange(
  startIso: string,
  endIso: string,
  maxDocs = 5_000,
): Promise<BillDoc[]> {
  const limit = Math.min(Math.max(maxDocs, 1), 5_000);
  const rows = await Bill.findAll({
    where: {
      createdAt: { [Op.between]: [new Date(startIso), new Date(endIso)] },
    },
    order: [['createdAt', 'ASC']],
    limit,
  });
  return rows.map(billRowToDoc);
}

export async function saveBillParts(parts: BillPartDoc[]): Promise<void> {
  if (!parts.length) return;
  await BillPart.bulkCreate(parts.map(partDocToRow) as any[]);
}
