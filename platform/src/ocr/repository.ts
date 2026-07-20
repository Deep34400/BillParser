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
