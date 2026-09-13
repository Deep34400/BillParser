/**
 * Invoice Service — all business logic for invoice lifecycle.
 *
 * Extracted from route.ts so controllers stay thin (HTTP only).
 * This service knows NOTHING about HTTP (no req/reply/status codes).
 * It receives typed params and returns typed results.
 *
 * Throws AppError subclasses on failure — the global error handler
 * translates them to HTTP responses.
 */
import { v4 as uuid } from 'uuid';
import {
  getBill, listBillsPaginated, deleteBill, updateBill, createBill, updateBillStatus,
  getPartsForBill, deletePartsForBill, extractPartsFromParsed, saveBillParts,
  getSettings, findDuplicateBills, countAllStatuses,
  type ParsedInvoiceData, type BillDoc,
} from '../repository.js';
import { billToInvoice, toApiParsed, mapParsedToBill, toExternalOcrPayload } from '../mapper.js';
import type { FrontendInvoice } from '../mapper.js';
import { isPdf, isImage, uploadFile, getStoredFile, getSignedReadUrl } from '../../shared/storage.js';
import { runPipeline } from '../process.js';
import { cacheInvalidate } from '../../shared/cache.js';
import { upsertVendorFromInvoice } from '../../vendor/vendorService.js';
import { deductTokens, trackOcrCost } from '../../users/service.js';
import { reconcileBillsInCreatedAtRange } from './reconcileRange.js';
import {
  NotFoundError, ValidationError, InsufficientBalanceError, UnsupportedFileError,
} from '../../shared/errors.js';
import { audit } from '../../audit/service.js';
import type { AuditAction } from '../../audit/models/index.js';
import { dispatchWebhookEvent } from '../../webhook/service.js';
import type { WebhookEvent } from '../../webhook/models/index.js';

function recordActivity(
  userId: string | undefined,
  action: AuditAction,
  event: WebhookEvent | null,
  billId: string,
  details?: Record<string, unknown>,
): void {
  if (!userId) return;
  audit(action, { userId, resourceType: 'bill', resourceId: billId, details: details ?? null });
  if (event) dispatchWebhookEvent(userId, event, { billId, ...(details ?? {}) });
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UploadedFile {
  buf: Buffer;
  name: string;
}

export interface UploadResult {
  created: string[];
  duplicates: string[];
  rejected: { name: string; reason: string }[];
}

export interface InvoiceListFilters {
  page?: number;
  pageSize?: number;
  status?: string;
  q?: string;
  needsReview?: boolean;
  completed?: boolean;
  reviewCode?: string;
}

export interface ReconcileRangeParams {
  startDate: string;
  endDate: string;
  mode: 'check' | 'update';
  includeVerified: boolean;
  status: string | null;
}

export interface InvoiceUpdate {
  vendorName?: string;
  vendorTaxId?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  totalAmount?: number;
  subtotal?: number;
}

export interface SyncOcrResult {
  billId: string;
  status: string;
  needsReview: boolean;
  parsedData: ReturnType<typeof toApiParsed>;
  reviewReasons: string[];
  reviewCodes: string[];
  totalReconciliation: BillDoc['total_reconciliation'];
  fallbackReason: string | null;
  rawOcr: string;
  cost: {
    mode: string;
    extractionUsd: number | null;
    structuringUsd: number | null;
    singleCallUsd: number | null;
    extractionProvider: string;
    structuringProvider: string;
    fallbackReason: string | null;
    totalUsd: number;
    totalInr: number;
    inputTokens: number;
    outputTokens: number;
    inputCostUsd: number;
    outputCostUsd: number;
  };
  latencyMs: number;
}

// ─── Helpers (private) ──────────────────────────────────────────────────────

/**
 * Stamp pipeline/provider config from current Settings onto a new bill.
 * Called once when creating a PROCESSING bill, before OCR runs.
 */
async function applyPipelineSettings(bill: BillDoc): Promise<void> {
  const { buildFallbackChain } = await import('../../shared/settings.js');
  const settings = await getSettings();
  const chain = buildFallbackChain(settings);
  const primary = chain[0];
  if (!primary) return;

  bill.pipeline_mode = primary.mode;
  if (primary.mode === 'single') {
    bill.extraction_provider = primary.provider;
    bill.structuring_provider = primary.provider;
    bill.extraction_model = primary.model;
    bill.structuring_model = primary.model;
  } else {
    bill.extraction_provider = 'mistral';
    bill.structuring_provider = primary.structuringProvider ?? primary.provider;
    bill.structuring_model = primary.structuringModel ?? primary.model;
    bill.extraction_model = null;
  }
}

/**
 * Run OCR pipeline in the background (fire-and-forget).
 *
 * This function starts an async IIFE and returns immediately.
 * On success: updates the bill with parsed data, saves line items,
 *             upserts vendor, and deducts user tokens.
 * On failure: marks the bill as FAILED with an error message.
 */
function processInBackground(
  billId: string,
  buf: Buffer,
  fileName: string,
  fileUrl: string,
  storagePath: string,
  userId?: string,
): void {
  const startTime = Date.now();
  console.log(`[OCR] Starting background processing for ${billId} (${fileName})`);

  (async () => {
    try {
      const result = await runPipeline(buf, billId);
      const { costInfo, rawOcr, providers, fallbackHistory, fallbackAttempts } = result;

      if (fallbackAttempts > 1) {
        console.warn(`[OCR] ${billId} — used ${fallbackAttempts} fallback attempts`);
      }

      const bill = mapParsedToBill(billId, result.parsed, {
        fileUrl,
        storagePath,
        rawOcrReference: rawOcr.length > 10_000 ? rawOcr.slice(0, 10_000) : rawOcr,
        costInfo,
        pipelineMode: providers.mode,
        fxRateUsdInr: (await getSettings()).usdToInr,
      });
      bill.ocr_status = bill.ocr_status === 'NEED_REVIEW' ? 'NEED_REVIEW' : 'OCR_COMPLETED';
      bill.fallback_attempts = fallbackAttempts;
      bill.fallback_history = fallbackHistory;

      await updateBillStatus(billId, bill.ocr_status, bill);
      cacheInvalidate('analytics');

      await checkForDuplicates(billId, result.parsed, bill);

      const parts = extractPartsFromParsed(billId, result.parsed);
      await saveBillParts(parts);

      upsertVendorFromInvoice(billId, result.parsed)
        .then((vid) => { if (vid) updateBill(billId, { vendor_id: vid }).catch(() => {}); })
        .catch((e) => console.warn(`[vendor] ${billId} — registry update failed:`, (e as Error).message));

      if (userId) {
        await chargeUserForOcr(userId, costInfo.total_cost_usd, fileName, billId);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        `[OCR] ${billId} — DONE in ${elapsed}s `
        + `(mode=${providers.mode}, extract=${providers.extraction}, `
        + `struct=${providers.structuring}, parts=${parts.length}, `
        + `$${costInfo.total_cost_usd.toFixed(4)})`,
      );
      recordActivity(userId, 'invoice:complete', 'invoice.completed', billId, {
        fileName, status: bill.ocr_status, costUsd: costInfo.total_cost_usd,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`[OCR] ${billId} — FAILED after ${elapsed}s:`, msg);
      await updateBillStatus(billId, 'FAILED', { processing_status: msg }).catch(() => {});
      recordActivity(userId, 'invoice:fail', 'invoice.failed', billId, { fileName, error: msg });
    }
  })();
}

/** Advisory duplicate check — adds a review reason but does NOT block. */
async function checkForDuplicates(
  billId: string,
  parsed: ParsedInvoiceData,
  bill: BillDoc,
): Promise<void> {
  try {
    const dupes = await findDuplicateBills(parsed.invoice_number, parsed.gstin, billId);
    if (dupes.length > 0) {
      const dupMsg = `Duplicate: invoice ${parsed.invoice_number} already exists (${dupes.length} match)`;
      const reasons = bill.review_reasons ?? [];
      if (!reasons.includes(dupMsg)) reasons.push(dupMsg);
      await updateBill(billId, { review_reasons: reasons });
      console.warn(`[OCR] ${billId} — ${dupMsg}`);
    }
  } catch (e) {
    console.warn(`[OCR] ${billId} — duplicate check failed:`, (e as Error).message);
  }
}

/** Deduct tokens and track OCR cost for a user. Non-fatal on failure. */
async function chargeUserForOcr(
  userId: string,
  costUsd: number,
  fileName: string,
  billId: string,
): Promise<void> {
  try {
    const rounded = Math.round(costUsd * 10000) / 10000;
    const deductAmount = rounded > 0 ? rounded : 0.001;
    await deductTokens(userId, deductAmount, `OCR: ${fileName} ($${deductAmount.toFixed(4)})`, billId);
    await trackOcrCost(userId, costUsd);
  } catch (e) {
    console.warn(`[OCR] ${billId} — token deduction failed:`, (e as Error).message);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** List invoices with pagination and filtering. */
export async function listInvoices(filters: InvoiceListFilters) {
  const page = Math.max(Number(filters.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(filters.pageSize) || 10, 1), 100);
  const status = filters.status as import('../../shared/types.js').BillStatus | undefined;
  const q = filters.q?.trim().toLowerCase();
  const needsReview = filters.needsReview;
  const completed = filters.completed;
  const reviewCode = filters.reviewCode?.trim() || undefined;

  const result = await listBillsPaginated({
    page,
    pageSize,
    status: needsReview || reviewCode ? 'NEED_REVIEW' : (completed ? undefined : status),
    statuses: completed ? ['OCR_COMPLETED', 'VERIFIED'] : undefined,
    needsReview: undefined,
    excludeNeedsReview: undefined,
    reviewCode,
    q,
  });

  return {
    invoices: result.bills.map((b) => billToInvoice(b)),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
  };
}

/** Get status counts for all invoice statuses. */
export async function getStatusCounts() {
  return countAllStatuses();
}

/** Get a single invoice by ID. Throws NotFoundError if missing. */
export async function getInvoice(billId: string): Promise<BillDoc> {
  const bill = await getBill(billId);
  if (!bill) throw new NotFoundError('Invoice', billId);
  return bill;
}

/** Get invoice detail for the UI (with line items). */
export async function getInvoiceForUi(billId: string): Promise<FrontendInvoice> {
  const bill = await getInvoice(billId);
  const parts = await getPartsForBill(billId);
  return billToInvoice(bill, parts);
}

/** Get invoice detail for API key consumers (lean payload). */
export async function getInvoiceForApi(bill: BillDoc) {
  const inv = billToInvoice(bill);
  const ext = toExternalOcrPayload(bill);
  return {
    bill_id: bill.bill_id,
    status: ext.status,
    needs_review: ext.needs_review,
    parsedData: toApiParsed(bill.parsed_data),
    review_reasons: ext.review_reasons,
    review_codes: ext.review_codes,
    total_reconciliation: inv.totalReconciliation ?? null,
    fallback_reason: inv.fallbackReason ?? null,
  };
}

/**
 * Get a signed URL or the raw bytes for an invoice file.
 * Returns { redirect: url } or { buf, contentType } or throws NotFoundError.
 */
export async function getInvoiceFile(billId: string): Promise<
  | { redirect: string }
  | { buf: Buffer; contentType: string; fileName: string }
> {
  const bill = await getInvoice(billId);

  if (!bill.storage_path && !bill.file_url) {
    throw new NotFoundError('File', billId);
  }

  const storagePath = bill.storage_path
    ?? bill.file_url?.replace(/^local:\/\//, '')
    ?? bill.file_url?.replace(/^gs:\/\/[^/]+\//, '');

  if (!storagePath) throw new NotFoundError('File', billId);

  // Prefer signed URL when storage_path exists
  if (bill.storage_path) {
    const signed = await getSignedReadUrl(bill.storage_path);
    if (signed) return { redirect: signed };
  }

  // Stream bytes through the API as fallback
  const stored = await getStoredFile(storagePath);
  if (stored) {
    return {
      buf: stored.buf,
      contentType: stored.contentType,
      fileName: bill.invoice_number ?? billId,
    };
  }

  // External URL (e.g. S3 import) — never treat GCS as public
  if (bill.file_url?.startsWith('http') && !bill.file_url.includes('storage.googleapis.com')) {
    return { redirect: bill.file_url };
  }

  throw new NotFoundError('File', billId);
}

/**
 * Upload one or more invoices. Validates each file, uploads to storage,
 * creates a PROCESSING bill, and starts OCR in the background.
 */
export async function uploadInvoices(files: UploadedFile[], userId?: string): Promise<UploadResult> {
  const created: string[] = [];
  const rejected: { name: string; reason: string }[] = [];

  if (files.length === 0) {
    return { created: [], duplicates: [], rejected: [{ name: '(none)', reason: 'No files in upload' }] };
  }

  for (const file of files) {
    if (!file.buf?.length) {
      rejected.push({ name: file.name, reason: 'Empty file (0 bytes)' });
      continue;
    }
    if (!isPdf(file.buf) && !isImage(file.buf)) {
      rejected.push({ name: file.name, reason: 'Unsupported type — only PDF or JPEG/PNG/WebP' });
      continue;
    }

    try {
      const billId = uuid();
      const { storagePath, publicUrl } = await uploadFile(file.buf, {
        fileName: file.name,
        contentType: isPdf(file.buf) ? 'application/pdf' : 'image/jpeg',
      });

      const initialBill = mapParsedToBill(billId, {} as ParsedInvoiceData, {
        fileUrl: publicUrl,
        storagePath,
      });
      initialBill.ocr_status = 'PROCESSING';
      await applyPipelineSettings(initialBill);
      await createBill(initialBill);

      created.push(billId);
      recordActivity(userId, 'invoice:upload', 'invoice.uploaded', billId, { fileName: file.name });
      processInBackground(billId, file.buf, file.name, publicUrl, storagePath, userId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Upload failed';
      console.error(`[upload] rejected ${file.name}:`, reason);
      rejected.push({ name: file.name, reason });
    }
  }

  return { created, duplicates: [], rejected };
}

/** Import invoices from URLs. Downloads each, validates, and starts OCR. */
export async function importFromUrls(sources: string[], userId?: string): Promise<UploadResult> {
  const created: string[] = [];
  const rejected: string[] = [];

  for (const url of sources) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) { rejected.push(url); continue; }
      const buf = Buffer.from(await resp.arrayBuffer());
      const fileName = url.split('/').pop() ?? 'invoice.pdf';

      if (!isPdf(buf) && !isImage(buf)) { rejected.push(url); continue; }

      const billId = uuid();
      const { storagePath, publicUrl } = await uploadFile(buf, {
        fileName,
        contentType: isPdf(buf) ? 'application/pdf' : 'image/jpeg',
      });

      const initialBill = mapParsedToBill(billId, {} as ParsedInvoiceData, {
        fileUrl: publicUrl,
        storagePath,
      });
      initialBill.ocr_status = 'PROCESSING';
      await applyPipelineSettings(initialBill);
      await createBill(initialBill);

      created.push(billId);
      recordActivity(userId, 'invoice:upload', 'invoice.uploaded', billId, { fileName, sourceUrl: url });
      processInBackground(billId, buf, fileName, publicUrl, storagePath, userId);
    } catch {
      rejected.push(url);
    }
  }

  return { created, duplicates: [], rejected: rejected.map((r) => ({ name: r, reason: 'Failed' })) };
}

/** Re-run OCR on an existing bill. */
export async function reextractInvoice(billId: string, userId?: string): Promise<void> {
  const bill = await getInvoice(billId);
  if (!bill.storage_path) throw new ValidationError('No file stored for this bill');

  const stored = await getStoredFile(bill.storage_path);
  if (!stored) throw new ValidationError('Could not retrieve stored file');

  await updateBillStatus(billId, 'PROCESSING', {});
  const fileName = (bill as { original_filename?: string }).original_filename
    ?? bill.storage_path.split('/').pop()
    ?? `bill-${billId}`;
  recordActivity(userId, 'invoice:reextract', null, billId, { fileName });
  processInBackground(billId, stored.buf, fileName, bill.file_url ?? '', bill.storage_path, userId);
}

/** Cancel a processing invoice. */
export async function cancelInvoice(billId: string, userId?: string): Promise<void> {
  await updateBill(billId, { ocr_status: 'FAILED', processing_status: 'Cancelled by user' });
  recordActivity(userId, 'invoice:cancel', 'invoice.failed', billId, { reason: 'Cancelled by user' });
}

/** Process a DRAFT bill (from email intake). */
export async function processDraft(billId: string, userId?: string): Promise<void> {
  const bill = await getInvoice(billId);
  if (bill.ocr_status !== 'DRAFT') {
    throw new ValidationError(`Cannot process — status is ${bill.ocr_status}, expected DRAFT`);
  }
  if (!bill.storage_path) throw new ValidationError('No file stored for this bill');

  const stored = await getStoredFile(bill.storage_path);
  if (!stored) throw new ValidationError('Could not retrieve stored file');

  await updateBillStatus(billId, 'PROCESSING', {});
  const fileName = (bill as any).original_filename ?? bill.storage_path.split('/').pop() ?? `bill-${billId}`;
  processInBackground(billId, stored.buf, fileName, bill.file_url ?? '', bill.storage_path, userId);
}

/** Human correction — update fields and mark as VERIFIED. */
export async function updateInvoice(billId: string, changes: InvoiceUpdate, userId?: string): Promise<FrontendInvoice> {
  await getInvoice(billId);
  const updates: Record<string, unknown> = {};

  if (changes.vendorName !== undefined) updates.vendor_name = changes.vendorName;
  if (changes.vendorTaxId !== undefined) updates.vendor_gstin = changes.vendorTaxId;
  if (changes.invoiceNumber !== undefined) updates.invoice_number = changes.invoiceNumber;
  if (changes.invoiceDate !== undefined) updates.invoice_date = changes.invoiceDate;
  if (changes.totalAmount !== undefined) updates.grand_total_amount = changes.totalAmount;
  if (changes.subtotal !== undefined) updates.subtotal_amount = changes.subtotal;

  updates.ocr_status = 'VERIFIED';
  await updateBill(billId, updates as any);
  recordActivity(userId, 'invoice:edit', null, billId, { fields: Object.keys(changes) });

  const updated = await getBill(billId);
  const parts = await getPartsForBill(billId);
  return billToInvoice(updated!, parts);
}

/** Delete an invoice and its line items. */
export async function deleteInvoice(billId: string, userId?: string): Promise<void> {
  await getInvoice(billId);
  await deletePartsForBill(billId);
  await deleteBill(billId);
  cacheInvalidate('analytics');
  recordActivity(userId, 'invoice:delete', 'invoice.deleted', billId);
}

/** Run bulk actions (delete, reextract) on multiple invoices. */
export async function bulkAction(action: string, ids: string[], userId?: string): Promise<void> {
  if (action === 'delete') {
    for (const id of ids) {
      await deletePartsForBill(id);
      await deleteBill(id);
      recordActivity(userId, 'invoice:bulk_delete', 'invoice.deleted', id);
    }
    cacheInvalidate('analytics');
  } else if (action === 'reextract') {
    for (const id of ids) {
      try {
        await reextractInvoice(id, userId);
      } catch {
        // skip invoices that can't be reextracted
      }
    }
  }
}

/** Reconcile invoices in a date range. */
export async function reconcileRange(params: ReconcileRangeParams) {
  if (!params.startDate || !params.endDate) {
    throw new ValidationError('start_date and end_date are required (YYYY-MM-DD)');
  }
  return reconcileBillsInCreatedAtRange({
    startDate: params.startDate,
    endDate: params.endDate,
    mode: params.mode,
    includeVerified: params.includeVerified,
    status: params.status,
  });
}

/** Stateless OCR parse (legacy endpoint). */
export async function statelessParse(buf: Buffer) {
  const result = await runPipeline(buf, 'parse');
  return { output: { entries: [{ id: uuid(), parsed_data: toApiParsed(result.parsed) }] } };
}

/** Synchronous OCR — processes and returns full result. */
export async function syncOcr(
  buf: Buffer,
  userId: string,
  isAdmin: boolean,
): Promise<SyncOcrResult> {
  const startTime = Date.now();
  const result = await runPipeline(buf, 'sync');
  const { costInfo, rawOcr, providers, fallbackHistory, fallbackAttempts } = result;

  const billId = uuid();
  const { storagePath, publicUrl } = await uploadFile(buf, {
    fileName: 'api-sync-upload',
    contentType: isPdf(buf) ? 'application/pdf' : 'image/jpeg',
  });

  const bill = mapParsedToBill(billId, result.parsed, {
    fileUrl: publicUrl,
    storagePath,
    rawOcrReference: rawOcr.length > 10_000 ? rawOcr.slice(0, 10_000) : rawOcr,
    costInfo,
    pipelineMode: providers.mode,
    fxRateUsdInr: (await getSettings()).usdToInr,
  });
  bill.fallback_attempts = fallbackAttempts;
  bill.fallback_history = fallbackHistory;
  await createBill(bill);
  recordActivity(userId, 'invoice:upload', 'invoice.uploaded', billId, { source: 'sync-ocr' });
  recordActivity(userId, 'invoice:complete', 'invoice.completed', billId, {
    status: bill.ocr_status, source: 'sync-ocr',
  });

  const parts = extractPartsFromParsed(billId, result.parsed);
  await saveBillParts(parts);

  upsertVendorFromInvoice(billId, result.parsed)
    .then((vid) => { if (vid) updateBill(billId, { vendor_id: vid }).catch(() => {}); })
    .catch(() => {});

  if (!isAdmin) {
    const amt = Math.round(costInfo.total_cost_usd * 10000) / 10000 || 0.001;
    try { await deductTokens(userId, amt, `API OCR sync ($${amt.toFixed(4)})`, billId); } catch { /* non-fatal */ }
    try { await trackOcrCost(userId, costInfo.total_cost_usd); } catch { /* non-fatal */ }
  }

  const ext = toExternalOcrPayload(bill);
  return {
    billId,
    status: ext.status,
    needsReview: ext.needs_review,
    parsedData: toApiParsed(result.parsed),
    reviewReasons: ext.review_reasons,
    reviewCodes: ext.review_codes,
    totalReconciliation: bill.total_reconciliation ?? null,
    fallbackReason: result.fallbackReason ?? null,
    rawOcr,
    cost: {
      mode: providers.mode,
      extractionUsd: providers.mode === 'single' ? (costInfo.total_cost_usd ?? 0) : (costInfo.extraction?.cost_usd ?? 0),
      structuringUsd: providers.mode === 'single' ? null : (costInfo.structuring?.cost_usd ?? 0),
      singleCallUsd: providers.mode === 'single' ? costInfo.total_cost_usd : null,
      extractionProvider: providers.extraction,
      structuringProvider: providers.structuring,
      fallbackReason: result.fallbackReason ?? null,
      totalUsd: costInfo.total_cost_usd,
      totalInr: Math.round(costInfo.total_cost_usd * 83 * 100) / 100,
      inputTokens: costInfo.total_input_tokens ?? 0,
      outputTokens: costInfo.total_output_tokens ?? 0,
      inputCostUsd: costInfo.total_input_cost_usd ?? 0,
      outputCostUsd: costInfo.total_output_cost_usd ?? 0,
    },
    latencyMs: Date.now() - startTime,
  };
}

/** Async OCR — creates bill, starts background processing, returns bill ID. */
export async function asyncOcr(
  buf: Buffer,
  userId: string,
): Promise<{ billId: string }> {
  if (!isPdf(buf) && !isImage(buf)) {
    throw new UnsupportedFileError();
  }

  const billId = uuid();
  const { storagePath, publicUrl } = await uploadFile(buf, {
    fileName: 'api-upload.pdf',
    contentType: isPdf(buf) ? 'application/pdf' : 'image/jpeg',
  });

  const initialBill = mapParsedToBill(billId, {} as ParsedInvoiceData, {
    fileUrl: publicUrl,
    storagePath,
  });
  initialBill.ocr_status = 'PROCESSING';
  await createBill(initialBill);
  recordActivity(userId, 'invoice:upload', 'invoice.uploaded', billId, { source: 'async-ocr' });

  processInBackground(billId, buf, 'api-upload.pdf', publicUrl, storagePath, userId);

  return { billId };
}

// ─── Approval Workflow ──────────────────────────────────────────────────────

export async function submitForApproval(billId: string, submittedBy?: string): Promise<void> {
  const bill = await getInvoice(billId);
  if (bill.ocr_status !== 'OCR_COMPLETED' && bill.ocr_status !== 'NEED_REVIEW' && bill.ocr_status !== 'VERIFIED') {
    throw new ValidationError(`Cannot submit for approval — invoice is ${bill.ocr_status}`);
  }
  await updateBill(billId, {
    approval_status: 'pending',
    approval_step: null,
    submitted_by: submittedBy ?? null,
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
  });
  cacheInvalidate();
  recordActivity(submittedBy, 'invoice:submit_approval', null, billId);
}

export async function approveInvoice(
  billId: string,
  approvedBy: string,
): Promise<{ approved: boolean; nextStep: string | null }> {
  const bill = await getInvoice(billId);
  if (bill.approval_status !== 'pending') {
    throw new ValidationError('Invoice is not pending approval');
  }
  await updateBill(billId, {
    approval_status: 'approved',
    approval_step: 'done',
    approved_by: approvedBy,
    approved_at: new Date().toISOString(),
    rejection_reason: null,
  });
  cacheInvalidate();
  recordActivity(approvedBy, 'invoice:approve', 'invoice.approved', billId);
  return { approved: true, nextStep: null };
}

export async function rejectInvoice(billId: string, rejectedBy: string, reason: string): Promise<void> {
  const bill = await getInvoice(billId);
  if (bill.approval_status !== 'pending') {
    throw new ValidationError('Invoice is not pending approval');
  }
  if (!reason?.trim()) {
    throw new ValidationError('Rejection reason is required');
  }
  await updateBill(billId, {
    approval_status: 'rejected',
    approval_step: null,
    approved_by: rejectedBy,
    approved_at: new Date().toISOString(),
    rejection_reason: reason.trim(),
  });
  cacheInvalidate();
  recordActivity(rejectedBy, 'invoice:reject', 'invoice.rejected', billId, { reason: reason.trim() });
}
