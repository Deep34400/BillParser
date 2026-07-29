/**
 * Fraud Repository — data access layer.
 * Bills live in OCR repository (OCR owns that data).
 * Parts query uses Firestore directly for the global scan.
 */
import { listAllBillsLean } from '../ocr/repository.js';
import { env } from '../config/env.js';
import { db, col } from '../config/firebase.js';
import { devStore } from '../shared/devStore.js';
import { cacheGet, cacheSet } from '../shared/cache.js';
import type { BillDoc, BillPartDoc } from '../shared/types.js';

export type { BillDoc, BillPartDoc };

const PARTS_BATCH = 2_500;
const PARTS_MAX = 20_000;
const CACHE_TTL = 300_000; // 5 min — same as lean bills

export async function fetchCompletedBills(): Promise<BillDoc[]> {
  // Shared lean cache (analytics + fraud). Filter completed in memory.
  const bills = await listAllBillsLean();
  return bills.filter((b) => b.ocr_status === 'OCR_COMPLETED' || b.ocr_status === 'VERIFIED');
}

export async function fetchAllParts(): Promise<BillPartDoc[]> {
  const cached = cacheGet<BillPartDoc[]>('fraud:parts:lean');
  if (cached) return cached;

  if (env.localDev) {
    const parts = Array.from(devStore.parts.values()).slice(0, PARTS_MAX);
    cacheSet('fraud:parts:lean', parts, CACHE_TTL);
    return parts;
  }

  const ref = db().collection(col('bill_parts'));
  const all: BillPartDoc[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  while (all.length < PARTS_MAX) {
    const batchSize = Math.min(PARTS_BATCH, PARTS_MAX - all.length);
    let q: FirebaseFirestore.Query = ref
      .select('part_id', 'bill_id', 'line_type', 'name', 'normalized_name', 'rate', 'created_at')
      .orderBy('created_at', 'desc');
    if (lastDoc) q = q.startAfter(lastDoc);
    q = q.limit(batchSize);
    const snap = await q.get();
    for (const doc of snap.docs) all.push(doc.data() as BillPartDoc);
    if (snap.docs.length < batchSize) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }

  cacheSet('fraud:parts:lean', all, CACHE_TTL);
  return all;
}
