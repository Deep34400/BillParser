/**
 * OCR Repository — data access layer for bills and bill parts.
 * Contains the actual Firestore CRUD. No re-exports — all DB code lives here.
 */
import { v4 as uuid } from 'uuid';
import { env } from '../config/env.js';
import { db, col } from '../config/firebase.js';
import { devStore } from '../shared/devStore.js';
import { getSettings } from '../shared/settings.js';
import { cacheGet, cacheSet } from '../shared/cache.js';
import type { BillDoc, BillPartDoc, BillType, BillStatus, ParsedInvoiceData, LineType } from '../shared/types.js';
import type { AppSettings } from '../shared/settings.js';

export type { BillDoc, BillPartDoc, BillType, BillStatus, ParsedInvoiceData, AppSettings };
export { getSettings };

// ─── Bill CRUD ──────────────────────────────────────────────────────────────

const BILLS = 'bills';
function billsRef() { return db().collection(col(BILLS)); }

export async function createBill(bill: BillDoc): Promise<BillDoc> {
  if (env.localDev) { devStore.bills.set(bill.bill_id, bill); return bill; }
  await billsRef().doc(bill.bill_id).set(bill);
  return bill;
}

export async function getBill(billId: string): Promise<BillDoc | null> {
  if (env.localDev) return devStore.bills.get(billId) ?? null;
  const snap = await billsRef().doc(billId).get();
  return snap.exists ? (snap.data() as BillDoc) : null;
}

export async function updateBill(billId: string, updates: Partial<BillDoc>): Promise<void> {
  if (env.localDev) {
    const existing = devStore.bills.get(billId);
    if (existing) devStore.bills.set(billId, { ...existing, ...updates, updated_at: new Date().toISOString() });
    return;
  }
  await billsRef().doc(billId).update({ ...updates, updated_at: new Date().toISOString() });
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
  if (env.localDev) {
    let rows = Array.from(devStore.bills.values());
    if (opts.status) rows = rows.filter((b) => b.ocr_status === opts.status);
    if (opts.vehicleId) rows = rows.filter((b) => b.vehicle_id === opts.vehicleId);
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (opts.offset) rows = rows.slice(opts.offset);
    return rows.slice(0, opts.limit ?? 50);
  }
  let q: FirebaseFirestore.Query = billsRef();
  if (opts.status) q = q.where('ocr_status', '==', opts.status);
  if (opts.vehicleId) q = q.where('vehicle_id', '==', opts.vehicleId);
  q = q.orderBy('created_at', 'desc');
  if (opts.offset) q = q.offset(opts.offset);
  q = q.limit(opts.limit ?? 50);
  const snap = await q.get();
  return snap.docs.map((d) => d.data() as BillDoc);
}

const LEAN_BILL_FIELDS = [
  'bill_id', 'fleet_id', 'vehicle_id', 'bill_type', 'vendor_name', 'vendor_gstin',
  'company_name', 'gstin', 'pan', 'invoice_number', 'invoice_date', 'invoice_time',
  'subtotal_amount', 'parts_amount', 'labour_amount',
  'parts_cgst_amount', 'parts_sgst_amount', 'parts_igst_amount',
  'parts_cgst_rate', 'parts_sgst_rate', 'parts_igst_rate',
  'labour_cgst_amount', 'labour_sgst_amount', 'labour_igst_amount',
  'labour_cgst_rate', 'labour_sgst_rate', 'labour_igst_rate',
  'total_tax_amount', 'grand_total_amount', 'deductibles', 'salvage',
  'odometer_reading', 'registration_number', 'ocr_status', 'confidence_score',
  'review_reasons', 'review_codes', 'pipeline_mode',
  'extraction_cost_usd', 'structuring_cost_usd', 'total_cost_usd',
  'extraction_tokens', 'structuring_tokens', 'total_tokens',
  'extraction_provider', 'structuring_provider',
  'schema_version', 'created_at', 'updated_at',
] as const;

/** Cap aggregation scans so analytics/fraud stay fast at 100k+ scale. */
const AGG_MAX_DOCS = 25_000;
const AGG_BATCH = 2_500;

/**
 * Cursor-based lean scan for aggregation (analytics, fraud).
 * Excludes parsed_data/raw_ocr. Caps at maxDocs (default 25k newest).
 * Dedupes concurrent callers via shared in-flight promise + TTL cache.
 */
let leanBillsInflight: Promise<BillDoc[]> | null = null;

export async function listAllBillsLean(opts: {
  status?: BillStatus;
  maxDocs?: number;
  cacheKey?: string;
  cacheTtlMs?: number;
} = {}): Promise<BillDoc[]> {
  const maxDocs = opts.maxDocs ?? AGG_MAX_DOCS;
  const cacheKey = opts.cacheKey ?? `lean:bills:${opts.status ?? 'all'}:${maxDocs}`;
  const ttl = opts.cacheTtlMs ?? 300_000; // 5 min

  const cached = cacheGet<BillDoc[]>(cacheKey);
  if (cached) return cached;

  if (!opts.status && leanBillsInflight) return leanBillsInflight;

  const run = async (): Promise<BillDoc[]> => {
    if (env.localDev) {
      let rows = Array.from(devStore.bills.values());
      if (opts.status) rows = rows.filter((b) => b.ocr_status === opts.status);
      rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return rows.slice(0, maxDocs);
    }

    const all: BillDoc[] = [];
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    while (all.length < maxDocs) {
      const batchSize = Math.min(AGG_BATCH, maxDocs - all.length);
      let q: FirebaseFirestore.Query = billsRef();
      if (opts.status) q = q.where('ocr_status', '==', opts.status);
      q = q.select(...LEAN_BILL_FIELDS).orderBy('created_at', 'desc');
      if (lastDoc) q = q.startAfter(lastDoc);
      q = q.limit(batchSize);
      const snap = await q.get();
      for (const doc of snap.docs) all.push(doc.data() as BillDoc);
      if (snap.docs.length < batchSize) break;
      lastDoc = snap.docs[snap.docs.length - 1];
    }
    return all;
  };

  const promise = run().then((bills) => {
    cacheSet(cacheKey, bills, ttl);
    if (!opts.status) leanBillsInflight = null;
    return bills;
  }).catch((err) => {
    if (!opts.status) leanBillsInflight = null;
    throw err;
  });

  if (!opts.status) leanBillsInflight = promise;
  return promise;
}

export function billNeedsReview(b: BillDoc): boolean {
  // Prefer persisted status (no runtime confidence / reasons heuristics)
  if (b.ocr_status === 'NEED_REVIEW') return true;
  return false;
}

/** Resolve stable review codes (persisted, or inferred from legacy review_reasons text). */
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

export interface PaginatedBills {
  bills: BillDoc[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Count bills matching optional status filter.
 * Uses Firestore count() aggregation in production (no document reads).
 */
export async function countBills(status?: BillStatus): Promise<number> {
  if (env.localDev) {
    let rows = Array.from(devStore.bills.values());
    if (status) rows = rows.filter((b) => b.ocr_status === status);
    return rows.length;
  }
  let q: FirebaseFirestore.Query = billsRef();
  if (status) q = q.where('ocr_status', '==', status);
  const snap = await q.count().get();
  return snap.data().count;
}

/**
 * Count bills per status using Firestore count() aggregation (no doc reads).
 * Also counts review_codes among NEED_REVIEW bills (lean scan).
 * Keys: review_MISSING_TAX_ID, review_TOTAL_MISMATCH, review_PARTS_BASE_MISMATCH, review_LABOUR_BASE_MISMATCH
 */
export async function countAllStatuses(): Promise<Record<string, number>> {
  const statuses: BillStatus[] = ['DRAFT', 'UPLOADED', 'PROCESSING', 'OCR_COMPLETED', 'NEED_REVIEW', 'VERIFIED', 'FAILED'];
  const reviewCodeKeys = [
    'MISSING_TAX_ID', 'TOTAL_MISMATCH', 'PARTS_BASE_MISMATCH', 'LABOUR_BASE_MISMATCH',
  ] as const;

  const addReviewCodeCounts = (counts: Record<string, number>, rows: BillDoc[]) => {
    const needReview = rows.filter((b) => b.ocr_status === 'NEED_REVIEW');
    for (const code of reviewCodeKeys) {
      counts[`review_${code}`] = needReview.filter((b) => billHasReviewCode(b, code)).length;
    }
  };

  if (env.localDev) {
    const rows = Array.from(devStore.bills.values());
    const counts: Record<string, number> = { all: rows.length };
    for (const s of statuses) counts[s] = rows.filter((b) => b.ocr_status === s).length;
    counts.needs_review = counts['NEED_REVIEW'] ?? 0;
    counts.completed_clean = (counts['OCR_COMPLETED'] ?? 0) + (counts['VERIFIED'] ?? 0);
    addReviewCodeCounts(counts, rows);
    return counts;
  }
  const results = await Promise.all([
    countBills(),
    ...statuses.map((s) => countBills(s)),
  ]);
  const counts: Record<string, number> = { all: results[0] };
  statuses.forEach((s, i) => { counts[s] = results[i + 1]; });

  counts.needs_review = counts['NEED_REVIEW'] ?? 0;
  counts.completed_clean = (counts['OCR_COMPLETED'] ?? 0) + (counts['VERIFIED'] ?? 0);

  // Per-reason counts from lean NEED_REVIEW rows
  try {
    const lean = await listAllBillsLean({ maxDocs: AGG_MAX_DOCS });
    addReviewCodeCounts(counts, lean);
  } catch {
    for (const code of reviewCodeKeys) counts[`review_${code}`] = 0;
  }

  return counts;
}

/**
 * Page-based pagination ordered by updated_at DESC.
 * Supports status, multi-status (statuses), needsReview, and text search (q).
 *
 * Status / completed / needsReview filters use the lean in-memory scan so we
 * never depend on a Firestore composite index (ocr_status + updated_at) —
 * missing indexes were returning HTTP 500 and the UI kept showing stale rows.
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
  /** Filter NEED_REVIEW bills by a stable review_code (e.g. TOTAL_MISMATCH). */
  reviewCode?: string;
  q?: string;
} = {}): Promise<PaginatedBills> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 10, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);
  const skip = (page - 1) * pageSize;
  const searchTerm = opts.q?.trim().toLowerCase();

  const filterRows = (rows: BillDoc[]): BillDoc[] => {
    let out = rows;
    if (opts.needsReview) out = out.filter(billNeedsReview);
    else if (opts.statuses?.length) {
      out = out.filter((b) => opts.statuses!.includes(b.ocr_status));
      if (opts.excludeNeedsReview) out = out.filter((b) => !billNeedsReview(b));
    } else if (opts.status) {
      out = out.filter((b) => b.ocr_status === opts.status);
    }
    if (opts.reviewCode) {
      out = out.filter((b) => billHasReviewCode(b, opts.reviewCode!));
    }
    if (searchTerm) out = out.filter((b) => billMatchesSearch(b, searchTerm));
    out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return out;
  };

  if (env.localDev) {
    const rows = filterRows(Array.from(devStore.bills.values()));
    const total = rows.length;
    return { bills: rows.slice(skip, skip + pageSize), total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 };
  }

  // Any status / review filter → lean scan (no composite index required)
  if (opts.needsReview || opts.statuses?.length || opts.status || opts.reviewCode) {
    const lean = await listAllBillsLean({ maxDocs: AGG_MAX_DOCS });
    const rows = filterRows(lean);
    const total = rows.length;
    return { bills: rows.slice(skip, skip + pageSize), total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 };
  }

  if (searchTerm) {
    return searchBillsPaginated(searchTerm, undefined, page, pageSize);
  }

  // Unfiltered "All" list — single-field orderBy works without composite index
  const [total, snap] = await Promise.all([
    countBills(),
    billsRef().orderBy('updated_at', 'desc').offset(skip).limit(pageSize).get(),
  ]);

  const bills = snap.docs.map((d) => d.data() as BillDoc);
  return { bills, total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 };
}

function billMatchesSearch(b: BillDoc, term: string): boolean {
  return (b.vendor_name ?? '').toLowerCase().includes(term)
    || (b.company_name ?? '').toLowerCase().includes(term)
    || (b.invoice_number ?? '').toLowerCase().includes(term)
    || (b.registration_number ?? '').toLowerCase().includes(term);
}

/**
 * Server-side search: parallel prefix queries on vendor_name and invoice_number,
 * merge + dedupe, then paginate in memory. Caps at 500 results per field.
 */
async function searchBillsPaginated(
  term: string, status: BillStatus | undefined, page: number, pageSize: number,
): Promise<PaginatedBills> {
  const SEARCH_LIMIT = 500;
  const upperTerm = term.charAt(0).toUpperCase() + term.slice(1);
  const endChar = '\uf8ff';

  const buildQuery = (field: string, prefix: string) => {
    let q: FirebaseFirestore.Query = billsRef()
      .where(field, '>=', prefix)
      .where(field, '<=', prefix + endChar);
    if (status) q = q.where('ocr_status', '==', status);
    return q.limit(SEARCH_LIMIT).get();
  };

  const [vendorLower, vendorUpper, invoiceRes, regRes] = await Promise.all([
    buildQuery('vendor_name', term),
    term !== upperTerm ? buildQuery('vendor_name', upperTerm) : Promise.resolve(null),
    buildQuery('invoice_number', term),
    buildQuery('registration_number', term.toUpperCase()),
  ]);

  const seen = new Set<string>();
  const merged: BillDoc[] = [];
  const addDocs = (snap: FirebaseFirestore.QuerySnapshot | null) => {
    if (!snap) return;
    for (const doc of snap.docs) {
      const b = doc.data() as BillDoc;
      if (!seen.has(b.bill_id)) { seen.add(b.bill_id); merged.push(b); }
    }
  };
  addDocs(vendorLower);
  addDocs(vendorUpper);
  addDocs(invoiceRes);
  addDocs(regRes);

  merged.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const total = merged.length;
  const skip = (page - 1) * pageSize;
  const bills = merged.slice(skip, skip + pageSize);
  return { bills, total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 };
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

  if (env.localDev) {
    return Array.from(devStore.bills.values()).filter((b) =>
      b.bill_id !== excludeId &&
      b.invoice_number === invoiceNumber &&
      (!vendorGstin || !b.vendor_gstin || b.vendor_gstin === vendorGstin),
    );
  }

  let q: FirebaseFirestore.Query = billsRef().where('invoice_number', '==', invoiceNumber);
  if (vendorGstin) q = q.where('vendor_gstin', '==', vendorGstin);
  q = q.limit(5);
  const snap = await q.get();
  return snap.docs
    .map((d) => d.data() as BillDoc)
    .filter((b) => b.bill_id !== excludeId);
}

export async function deleteBill(billId: string): Promise<void> {
  if (env.localDev) {
    const bill = devStore.bills.get(billId);
    if (bill?.storage_path) devStore.files.delete(bill.storage_path);
    devStore.bills.delete(billId);
    return;
  }
  await billsRef().doc(billId).delete();
}

// ─── Bill Parts CRUD ────────────────────────────────────────────────────────

const PARTS = 'bill_parts';
function partsRef() { return db().collection(col(PARTS)); }

export async function getPartsForBill(billId: string): Promise<BillPartDoc[]> {
  if (env.localDev) {
    return Array.from(devStore.parts.values()).filter((p) => p.bill_id === billId);
  }
  const snap = await partsRef().where('bill_id', '==', billId).get();
  return snap.docs.map((d) => d.data() as BillPartDoc);
}

export async function deletePartsForBill(billId: string): Promise<number> {
  if (env.localDev) {
    let count = 0;
    for (const [id, p] of devStore.parts) {
      if (p.bill_id === billId) { devStore.parts.delete(id); count++; }
    }
    return count;
  }
  const snap = await partsRef().where('bill_id', '==', billId).get();
  const batch = db().batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
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
  if (env.localDev) {
    return Array.from(devStore.bills.values())
      .filter((b) => b.created_at >= startIso && b.created_at <= endIso)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, limit);
  }
  const snap = await billsRef()
    .where('created_at', '>=', startIso)
    .where('created_at', '<=', endIso)
    .orderBy('created_at', 'asc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as BillDoc);
}

export async function saveBillParts(parts: BillPartDoc[]): Promise<void> {
  if (!parts.length) return;
  if (env.localDev) {
    for (const p of parts) devStore.parts.set(p.part_id, p);
    return;
  }
  const batch = db().batch();
  for (const p of parts) batch.set(partsRef().doc(p.part_id), p);
  await batch.commit();
}
