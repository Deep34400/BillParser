import { v4 as uuid } from 'uuid';
import {
  createBatch,
  getBatch,
  listBatches,
  listBillsByBatch,
  countBillsByBatchStatus,
  type BatchDoc,
} from '../repository.js';
import { billToInvoice } from '../mapper.js';
import { NotFoundError } from '../../shared/errors.js';
import type { BatchSource } from '../models/batch.js';

export const MAX_BATCH_FILES = 25;

export function defaultBatchName(): string {
  return new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }) + ' upload';
}

export async function startBatch(
  userId: string,
  name: string | undefined,
  source: BatchSource,
  totalFiles: number,
): Promise<BatchDoc> {
  const now = new Date().toISOString();
  return createBatch({
    id: uuid(),
    user_id: userId,
    name: name?.trim() || defaultBatchName(),
    source,
    total_files: totalFiles,
    created_at: now,
  });
}

function emptyCounts() {
  return { total: 0, completed: 0, failed: 0, processing: 0, review: 0 };
}

function addStatus(counts: ReturnType<typeof emptyCounts>, status: string, n: number) {
  counts.total += n;
  if (status === 'FAILED') counts.failed += n;
  else if (status === 'PROCESSING' || status === 'UPLOADED') counts.processing += n;
  else if (status === 'NEED_REVIEW') counts.review += n;
  else if (status === 'OCR_COMPLETED' || status === 'VERIFIED') counts.completed += n;
  else counts.processing += n;
}

export async function listUserBatches(userId?: string) {
  const batches = await listBatches(userId, 80);
  const counts = await countBillsByBatchStatus(batches.map((b) => b.id));
  const byBatch = new Map<string, ReturnType<typeof emptyCounts>>();
  for (const row of counts) {
    const cur = byBatch.get(row.batchId) ?? emptyCounts();
    addStatus(cur, row.ocrStatus, row.cnt);
    byBatch.set(row.batchId, cur);
  }
  return {
    batches: batches.map((b) => {
      const c = byBatch.get(b.id) ?? emptyCounts();
      return {
        id: b.id,
        name: b.name ?? defaultBatchName(),
        source: b.source,
        createdAt: b.created_at,
        total: c.total || b.total_files,
        completed: c.completed,
        failed: c.failed,
        processing: c.processing,
        review: c.review,
      };
    }),
  };
}

export async function getBatchDetail(batchId: string, userId?: string) {
  const batch = await getBatch(batchId, userId);
  if (!batch) throw new NotFoundError('Batch', batchId);
  const bills = await listBillsByBatch(batchId, userId);
  const summary = emptyCounts();
  for (const bill of bills) addStatus(summary, bill.ocr_status, 1);
  return {
    batch: {
      id: batch.id,
      name: batch.name ?? defaultBatchName(),
      source: batch.source,
      createdAt: batch.created_at,
      ...summary,
      total: bills.length || batch.total_files,
    },
    invoices: bills.map((b) => billToInvoice(b)),
    summary,
  };
}
