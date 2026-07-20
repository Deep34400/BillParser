/**
 * Fraud Repository — data access layer.
 * Bills live in OCR repository (OCR owns that data).
 * Parts query uses Firestore directly for the global scan.
 */
import { listBills } from '../ocr/repository.js';
import { env } from '../config/env.js';
import { db, col } from '../config/firebase.js';
import { devStore } from '../shared/devStore.js';
import type { BillDoc, BillPartDoc } from '../shared/types.js';

export type { BillDoc, BillPartDoc };

export async function fetchCompletedBills(): Promise<BillDoc[]> {
  const bills = await listBills({ limit: 10000 });
  return bills.filter((b) => b.ocr_status === 'OCR_COMPLETED' || b.ocr_status === 'VERIFIED');
}

export async function fetchAllParts(): Promise<BillPartDoc[]> {
  if (env.localDev) return Array.from(devStore.parts.values());
  const snap = await db().collection(col('bill_parts')).get();
  return snap.docs.map((d) => d.data() as BillPartDoc);
}
