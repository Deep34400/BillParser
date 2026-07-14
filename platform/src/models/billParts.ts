import { env } from '../config/env.js';
import { db, col } from '../config/firebase.js';
import { devStore } from '../lib/devStore.js';
import type { BillPartDoc, ParsedInvoiceData, LineType } from './types.js';
import { v4 as uuid } from 'uuid';

const COLLECTION = 'bill_parts';

function ref() {
  return db().collection(col(COLLECTION));
}

export async function createBillPart(part: BillPartDoc): Promise<BillPartDoc> {
  if (env.localDev) {
    devStore.parts.set(part.part_id, part);
    return part;
  }
  await ref().doc(part.part_id).set(part);
  return part;
}

export async function getPartsForBill(billId: string): Promise<BillPartDoc[]> {
  if (env.localDev) {
    return Array.from(devStore.parts.values()).filter((p) => p.bill_id === billId);
  }
  const snap = await ref().where('bill_id', '==', billId).get();
  return snap.docs.map((d) => d.data() as BillPartDoc);
}

export async function deletePartsForBill(billId: string): Promise<number> {
  if (env.localDev) {
    let count = 0;
    for (const [id, p] of devStore.parts) {
      if (p.bill_id === billId) {
        devStore.parts.delete(id);
        count++;
      }
    }
    return count;
  }
  const snap = await ref().where('bill_id', '==', billId).get();
  const batch = db().batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

/**
 * Extract line items from parsed OCR data into BillPartDoc records.
 */
export function extractPartsFromParsed(
  billId: string,
  parsed: ParsedInvoiceData,
): BillPartDoc[] {
  const now = new Date().toISOString();
  const parts: BillPartDoc[] = [];

  for (const p of parsed.parts_line_items ?? []) {
    parts.push({
      part_id: uuid(),
      bill_id: billId,
      line_type: 'PART' as LineType,
      name: p.item_name_description ?? null,
      description: p.item_name_description ?? null,
      quantity: p.quantity ?? null,
      rate: p.rate ?? null,
      amount: p.taxable_amount ?? null,
      tax_percentage: p.tax_percentage ?? null,
      tax_amount: null,
      part_number: p.part_number_item_code ?? null,
      hsn_sac_code: p.hsn_sac_code ?? null,
      manufacturer: null,
      normalized_name: null,
      confidence_score: null,
      created_at: now,
    });
  }

  for (const l of parsed.labour_service_line_items ?? []) {
    parts.push({
      part_id: uuid(),
      bill_id: billId,
      line_type: 'LABOUR' as LineType,
      name: l.labour_description ?? null,
      description: l.labour_description ?? null,
      quantity: 1,
      rate: l.labour_charges ?? null,
      amount: l.labour_charges ?? null,
      tax_percentage: l.tax_percentage ?? null,
      tax_amount: null,
      part_number: l.labour_code ?? null,
      hsn_sac_code: l.hsn_sac_code ?? null,
      manufacturer: null,
      normalized_name: null,
      confidence_score: null,
      created_at: now,
    });
  }

  return parts;
}

/** Batch-insert all extracted parts for a bill. */
export async function saveBillParts(parts: BillPartDoc[]): Promise<void> {
  if (!parts.length) return;
  if (env.localDev) {
    for (const p of parts) devStore.parts.set(p.part_id, p);
    return;
  }
  const batch = db().batch();
  for (const p of parts) batch.set(ref().doc(p.part_id), p);
  await batch.commit();
}
