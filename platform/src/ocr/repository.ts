/**
 * OCR Repository — data access layer for bills and bill parts.
 * Contains the actual Firestore CRUD. No re-exports — all DB code lives here.
 */
import { v4 as uuid } from 'uuid';
import { env } from '../config/env.js';
import { db, col } from '../config/firebase.js';
import { devStore } from '../shared/devStore.js';
import { getSettings } from '../shared/settings.js';
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
 * Page-based pagination ordered by updated_at DESC.
 * Returns the requested page along with total/totalPages for UI controls.
 */
export async function listBillsPaginated(opts: {
  page?: number;
  pageSize?: number;
  status?: BillStatus;
} = {}): Promise<PaginatedBills> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 10, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);
  const skip = (page - 1) * pageSize;

  if (env.localDev) {
    let rows = Array.from(devStore.bills.values());
    if (opts.status) rows = rows.filter((b) => b.ocr_status === opts.status);
    rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const total = rows.length;
    const bills = rows.slice(skip, skip + pageSize);
    return { bills, total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 };
  }

  const [total, snap] = await Promise.all([
    countBills(opts.status),
    (() => {
      let q: FirebaseFirestore.Query = billsRef();
      if (opts.status) q = q.where('ocr_status', '==', opts.status);
      q = q.orderBy('updated_at', 'desc');
      if (skip > 0) q = q.offset(skip);
      q = q.limit(pageSize);
      return q.get();
    })(),
  ]);

  const bills = snap.docs.map((d) => d.data() as BillDoc);
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
