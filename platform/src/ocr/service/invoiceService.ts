/**
 * Invoice Service — CRUD operations and data retrieval.
 *
 * Extracted from route.ts so controllers stay thin (HTTP only).
 * OCR lifecycle (upload, background processing, sync/async API, approval)
 * lives in ocrLifecycle.ts and is re-exported here for backward compatibility.
 *
 * Throws AppError subclasses on failure — the global error handler
 * translates them to HTTP responses.
 */
import {
  getBill, listBillsPaginated, listBillsCursor, deleteBill, updateBill,
  getPartsForBill, deletePartsForBill,
  countAllStatuses,
  type BillDoc,
} from '../repository.js';
import { billToInvoice, toApiParsed, toExternalOcrPayload } from '../mapper.js';
import type { FrontendInvoice } from '../mapper.js';
import { getStoredFile, getSignedReadUrl } from '../../shared/storage.js';
import { cacheInvalidate } from '../../shared/cache.js';
import { reconcileBillsInCreatedAtRange } from './reconcileRange.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { recordActivity } from './recordActivity.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InvoiceListFilters {
  page?: number;
  pageSize?: number;
  cursor?: string;
  status?: string;
  q?: string;
  needsReview?: boolean;
  completed?: boolean;
  reviewCode?: string;
  /** When set, restrict results to this owner's bills (non-admin users). */
  userId?: string;
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

// ─── Public API ─────────────────────────────────────────────────────────────

/** List invoices with pagination and filtering. */
export async function listInvoices(filters: InvoiceListFilters) {
  const pageSize = Math.min(Math.max(Number(filters.pageSize) || 10, 1), 100);
  const status = filters.status as import('../../shared/types.js').BillStatus | undefined;
  const q = filters.q?.trim().toLowerCase();
  const needsReview = filters.needsReview;
  const completed = filters.completed;
  const reviewCode = filters.reviewCode?.trim() || undefined;
  const listFilters = {
    status: needsReview || reviewCode ? 'NEED_REVIEW' as const : (completed ? undefined : status),
    statuses: completed ? (['OCR_COMPLETED', 'VERIFIED'] as import('../../shared/types.js').BillStatus[]) : undefined,
    needsReview: undefined as boolean | undefined,
    excludeNeedsReview: undefined as boolean | undefined,
    reviewCode,
    q,
    userId: filters.userId,
  };

  const useCursor = filters.cursor !== undefined || filters.page === undefined;
  if (useCursor) {
    const result = await listBillsCursor({
      limit: pageSize,
      cursor: filters.cursor,
      ...listFilters,
    });

    return {
      invoices: result.rows.map((b) => billToInvoice(b)),
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      pageSize,
    };
  }

  const page = Math.max(Number(filters.page) || 1, 1);
  const result = await listBillsPaginated({
    page,
    pageSize,
    ...listFilters,
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
export async function getInvoice(billId: string, userId?: string): Promise<BillDoc> {
  const bill = await getBill(billId, userId);
  if (!bill) throw new NotFoundError('Invoice', billId);
  return bill;
}

/** Get invoice detail for the UI (with line items). */
export async function getInvoiceForUi(billId: string, userId?: string): Promise<FrontendInvoice> {
  const bill = await getInvoice(billId, userId);
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
export async function getInvoiceFile(billId: string, userId?: string): Promise<
  | { redirect: string }
  | { buf: Buffer; contentType: string; fileName: string }
> {
  const bill = await getInvoice(billId, userId);

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
    const { reextractInvoice } = await import('./ocrLifecycle.js');
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

// Re-export OCR lifecycle for backward-compatible imports from invoiceService.js
export {
  uploadInvoices,
  importFromUrls,
  reextractInvoice,
  cancelInvoice,
  processDraft,
  statelessParse,
  syncOcr,
  asyncOcr,
  submitForApproval,
  approveInvoice,
  rejectInvoice,
  type UploadedFile,
  type UploadResult,
  type SyncOcrResult,
} from './ocrLifecycle.js';
