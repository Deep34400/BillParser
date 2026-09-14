/**
 * OCR Lifecycle — upload, background processing, sync/async API, approval workflow.
 */
import { v4 as uuid } from 'uuid';
import {
  updateBill, createBill, updateBillStatus,
  extractPartsFromParsed, saveBillParts,
  getSettings,
  type ParsedInvoiceData, type BillDoc,
} from '../repository.js';
import { toApiParsed, mapParsedToBill, toExternalOcrPayload } from '../mapper.js';
import { isPdf, isImage, uploadFile, getStoredFile } from '../../shared/storage.js';
import { runPipeline } from '../process.js';
import { cacheInvalidate } from '../../shared/cache.js';
import { upsertVendorFromInvoice } from '../../vendor/vendorService.js';
import { deductTokens, trackOcrCost } from '../../users/service.js';
import { ValidationError, UnsupportedFileError } from '../../shared/errors.js';
import { recordActivity } from './recordActivity.js';
import { getInvoice } from './invoiceService.js';
import { enqueueOcr, isQueueInitialized } from '../../queue/ocrQueue.js';
import { processOcrJob } from '../../queue/ocrWorker.js';

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
 * Run OCR in the background via pg-boss, or inline when the queue is unavailable (e.g. tests).
 */
function processInBackground(
  billId: string,
  buf: Buffer,
  fileName: string,
  fileUrl: string,
  storagePath: string,
  userId?: string,
): void {
  const jobData = { billId, fileName, publicUrl: fileUrl, storagePath, userId };
  console.log(`[OCR] Starting background processing for ${billId} (${fileName})`);

  if (isQueueInitialized()) {
    enqueueOcr(jobData).catch((err) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[OCR] ${billId} — failed to enqueue job:`, msg);
      updateBillStatus(billId, 'FAILED', { processing_status: `Queue error: ${msg}` }).catch(() => {});
    });
    return;
  }

  (async () => {
    try {
      await processOcrJob(jobData, buf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[OCR] ${billId} — FAILED (inline):`, msg);
      await updateBillStatus(billId, 'FAILED', { processing_status: msg }).catch(() => {});
      recordActivity(userId, 'invoice:fail', 'invoice.failed', billId, { fileName, error: msg });
    }
  })();
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Upload one or more invoices. Validates each file, uploads to storage,
 * creates a PROCESSING bill, and starts OCR in the background.
 */
export async function uploadInvoices(
  files: UploadedFile[],
  userId?: string,
  opts?: { batchId?: string },
): Promise<UploadResult> {
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
      initialBill.user_id = userId ?? null;
      initialBill.batch_id = opts?.batchId ?? null;
      await applyPipelineSettings(initialBill);
      await createBill(initialBill);

      created.push(billId);
      recordActivity(userId, 'invoice:upload', 'invoice.uploaded', billId, { fileName: file.name, batchId: opts?.batchId });
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
export async function importFromUrls(
  sources: string[],
  userId?: string,
  opts?: { batchId?: string },
): Promise<UploadResult> {
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
      initialBill.user_id = userId ?? null;
      initialBill.batch_id = opts?.batchId ?? null;
      await applyPipelineSettings(initialBill);
      await createBill(initialBill);

      created.push(billId);
      recordActivity(userId, 'invoice:upload', 'invoice.uploaded', billId, { fileName, sourceUrl: url, batchId: opts?.batchId });
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
  bill.user_id = userId;
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
  initialBill.user_id = userId;
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
