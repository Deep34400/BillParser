/**
 * Analytics Repository — data access layer.
 * Bills live in OCR repository (OCR owns that data).
 */
import { listAllBillsLean } from '../ocr/repository.js';
import type { BillDoc } from '../shared/types.js';

export type { BillDoc };

export async function fetchAllBills(): Promise<BillDoc[]> {
  return listAllBillsLean();
}
