import { env } from '../config/env.js';
import { db, col } from '../config/firebase.js';
import { devStore } from '../lib/devStore.js';
import type { BillDoc, BillStatus } from './types.js';

const COLLECTION = 'bills';

function ref() {
  return db().collection(col(COLLECTION));
}

export async function createBill(bill: BillDoc): Promise<BillDoc> {
  if (env.localDev) {
    devStore.bills.set(bill.bill_id, bill);
    return bill;
  }
  await ref().doc(bill.bill_id).set(bill);
  return bill;
}

export async function getBill(billId: string): Promise<BillDoc | null> {
  if (env.localDev) return devStore.bills.get(billId) ?? null;
  const snap = await ref().doc(billId).get();
  return snap.exists ? (snap.data() as BillDoc) : null;
}

export async function updateBill(
  billId: string,
  updates: Partial<BillDoc>,
): Promise<void> {
  if (env.localDev) {
    const existing = devStore.bills.get(billId);
    if (existing) devStore.bills.set(billId, { ...existing, ...updates, updated_at: new Date().toISOString() });
    return;
  }
  await ref().doc(billId).update({
    ...updates,
    updated_at: new Date().toISOString(),
  });
}

export async function updateBillStatus(
  billId: string,
  status: BillStatus,
  extra?: Partial<BillDoc>,
): Promise<void> {
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
  let q: FirebaseFirestore.Query = ref();
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
  await ref().doc(billId).delete();
}
