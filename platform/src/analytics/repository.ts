/**
 * Analytics Repository — data access layer.
 * Bills live in OCR repository (OCR owns that data).
 */
import { listBills } from '../ocr/repository.js';
import type { BillDoc } from '../shared/types.js';

export type { BillDoc };

export async function fetchAllBills(): Promise<BillDoc[]> {
  return listBills({ limit: 10000 });
}
