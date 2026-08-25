/**
 * Fraud Repository — data access layer.
 * Bills live in OCR repository (OCR owns that data).
 */
import { desc } from 'drizzle-orm';
import { fetchAllBills } from '../ocr/repository.js';
import { db } from '../config/db.js';
import { billParts } from '../db/schema.js';
import type { BillDoc, BillPartDoc } from '../shared/types.js';

export type { BillDoc, BillPartDoc };

export async function fetchCompletedBills(): Promise<BillDoc[]> {
  const bills = await fetchAllBills();
  return bills.filter((b) => b.ocr_status === 'OCR_COMPLETED' || b.ocr_status === 'VERIFIED');
}

export async function fetchAllParts(): Promise<BillPartDoc[]> {
  const rows = await db().select({
    partId: billParts.partId, billId: billParts.billId, lineType: billParts.lineType,
    name: billParts.name, normalizedName: billParts.normalizedName, rate: billParts.rate,
    createdAt: billParts.createdAt,
  }).from(billParts).orderBy(desc(billParts.createdAt));

  return rows.map((row) => ({
    part_id: row.partId, bill_id: row.billId, line_type: row.lineType as BillPartDoc['line_type'],
    name: row.name, description: null, quantity: null, rate: row.rate, amount: null,
    tax_percentage: null, tax_amount: null, part_number: null, hsn_sac_code: null,
    manufacturer: null, normalized_name: row.normalizedName, confidence_score: null,
    created_at: row.createdAt.toISOString(),
  }));
}
