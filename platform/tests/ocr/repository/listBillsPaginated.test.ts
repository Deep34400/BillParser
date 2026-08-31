import { describe, it, expect, beforeEach } from 'vitest';
import { devStore } from '../../../src/shared/devStore.js';
import { listBillsPaginated, countBills } from '../../../src/ocr/repository.js';
import type { BillDoc } from '../../../src/shared/types.js';

function makeBill(id: string, updatedAt: string, status: BillDoc['ocr_status'] = 'OCR_COMPLETED'): BillDoc {
  return {
    bill_id: id,
    bill_type: 'MAINTENANCE',
    ocr_status: status,
    schema_version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: updatedAt,
  } as BillDoc;
}

describe('listBillsPaginated', () => {
  beforeEach(() => {
    devStore.bills.clear();
  });

  it('returns empty result when no bills exist', async () => {
    const result = await listBillsPaginated({});
    expect(result.bills).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('returns bills ordered by updated_at desc (latest first)', async () => {
    devStore.bills.set('b1', makeBill('b1', '2026-07-01T00:00:00Z'));
    devStore.bills.set('b2', makeBill('b2', '2026-07-03T00:00:00Z'));
    devStore.bills.set('b3', makeBill('b3', '2026-07-02T00:00:00Z'));

    const result = await listBillsPaginated({ pageSize: 10 });
    expect(result.bills.map(b => b.bill_id)).toEqual(['b2', 'b3', 'b1']);
  });

  it('limits results to pageSize', async () => {
    devStore.bills.set('b1', makeBill('b1', '2026-07-01T00:00:00Z'));
    devStore.bills.set('b2', makeBill('b2', '2026-07-02T00:00:00Z'));
    devStore.bills.set('b3', makeBill('b3', '2026-07-03T00:00:00Z'));

    const result = await listBillsPaginated({ pageSize: 2 });
    expect(result.bills).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.totalPages).toBe(2);
  });

  it('returns correct totalPages when all bills fit in one page', async () => {
    devStore.bills.set('b1', makeBill('b1', '2026-07-01T00:00:00Z'));

    const result = await listBillsPaginated({ pageSize: 10 });
    expect(result.bills).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('paginates by page number (page 1, 2, 3)', async () => {
    devStore.bills.set('b1', makeBill('b1', '2026-07-01T00:00:00Z'));
    devStore.bills.set('b2', makeBill('b2', '2026-07-02T00:00:00Z'));
    devStore.bills.set('b3', makeBill('b3', '2026-07-03T00:00:00Z'));
    devStore.bills.set('b4', makeBill('b4', '2026-07-04T00:00:00Z'));
    devStore.bills.set('b5', makeBill('b5', '2026-07-05T00:00:00Z'));

    const page1 = await listBillsPaginated({ pageSize: 2, page: 1 });
    expect(page1.bills.map(b => b.bill_id)).toEqual(['b5', 'b4']);
    expect(page1.page).toBe(1);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);

    const page2 = await listBillsPaginated({ pageSize: 2, page: 2 });
    expect(page2.bills.map(b => b.bill_id)).toEqual(['b3', 'b2']);
    expect(page2.page).toBe(2);

    const page3 = await listBillsPaginated({ pageSize: 2, page: 3 });
    expect(page3.bills.map(b => b.bill_id)).toEqual(['b1']);
    expect(page3.page).toBe(3);
  });

  it('filters by status', async () => {
    devStore.bills.set('b1', makeBill('b1', '2026-07-01T00:00:00Z', 'OCR_COMPLETED'));
    devStore.bills.set('b2', makeBill('b2', '2026-07-02T00:00:00Z', 'FAILED'));
    devStore.bills.set('b3', makeBill('b3', '2026-07-03T00:00:00Z', 'OCR_COMPLETED'));

    const result = await listBillsPaginated({ status: 'FAILED' });
    expect(result.bills).toHaveLength(1);
    expect(result.bills[0].bill_id).toBe('b2');
    expect(result.total).toBe(1);
  });

  it('combines status filter with pagination', async () => {
    devStore.bills.set('b1', makeBill('b1', '2026-07-01T00:00:00Z', 'OCR_COMPLETED'));
    devStore.bills.set('b2', makeBill('b2', '2026-07-02T00:00:00Z', 'OCR_COMPLETED'));
    devStore.bills.set('b3', makeBill('b3', '2026-07-03T00:00:00Z', 'FAILED'));
    devStore.bills.set('b4', makeBill('b4', '2026-07-04T00:00:00Z', 'OCR_COMPLETED'));

    const page1 = await listBillsPaginated({ pageSize: 1, page: 1, status: 'OCR_COMPLETED' });
    expect(page1.bills).toHaveLength(1);
    expect(page1.bills[0].bill_id).toBe('b4');
    expect(page1.total).toBe(3);
    expect(page1.totalPages).toBe(3);

    const page2 = await listBillsPaginated({ pageSize: 1, page: 2, status: 'OCR_COMPLETED' });
    expect(page2.bills).toHaveLength(1);
    expect(page2.bills[0].bill_id).toBe('b2');
  });

  it('defaults to pageSize 10 when not specified', async () => {
    for (let i = 0; i < 25; i++) {
      devStore.bills.set(`b${i}`, makeBill(`b${i}`, `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z`));
    }

    const result = await listBillsPaginated({});
    expect(result.bills).toHaveLength(10);
    expect(result.pageSize).toBe(10);
    expect(result.total).toBe(25);
    expect(result.totalPages).toBe(3);
  });

  it('caps pageSize at 100', async () => {
    const result = await listBillsPaginated({ pageSize: 200 });
    expect(result.pageSize).toBe(100);
  });

  it('returns all completed (OCR_COMPLETED + VERIFIED) when statuses set', async () => {
    devStore.bills.set('b1', makeBill('b1', '2026-07-01T00:00:00Z', 'OCR_COMPLETED'));
    devStore.bills.set('b2', makeBill('b2', '2026-07-02T00:00:00Z', 'VERIFIED'));
    devStore.bills.set('b3', makeBill('b3', '2026-07-03T00:00:00Z', 'FAILED'));
    const result = await listBillsPaginated({ statuses: ['OCR_COMPLETED', 'VERIFIED'] });
    expect(result.total).toBe(2);
    expect(result.bills.map((b) => b.bill_id).sort()).toEqual(['b1', 'b2']);
  });

  it('excludes needs-review bills from completed when excludeNeedsReview=true', async () => {
    const clean = makeBill('clean', '2026-07-05T00:00:00Z', 'OCR_COMPLETED');
    const flagged = makeBill('flag', '2026-07-04T00:00:00Z', 'NEED_REVIEW');
    flagged.review_reasons = ['No GSTIN or PAN detected — likely a handwritten/informal bill. Verify vendor details manually.'];
    devStore.bills.set('clean', clean);
    devStore.bills.set('flag', flagged);

    const result = await listBillsPaginated({
      statuses: ['OCR_COMPLETED', 'VERIFIED'],
      excludeNeedsReview: true,
    });
    expect(result.bills.map((b) => b.bill_id)).toEqual(['clean']);
    expect(result.total).toBe(1);
  });

  it('returns only bills that need review when needsReview=true', async () => {
    const need = makeBill('need', '2026-07-05T00:00:00Z', 'NEED_REVIEW');
    need.review_reasons = ['No GSTIN or PAN detected — likely a handwritten/informal bill. Verify vendor details manually.'];
    const ok = makeBill('ok', '2026-07-04T00:00:00Z', 'OCR_COMPLETED');
    const verified = makeBill('ver', '2026-07-02T00:00:00Z', 'VERIFIED');
    verified.confidence_score = 0.4;
    devStore.bills.set('need', need);
    devStore.bills.set('ok', ok);
    devStore.bills.set('ver', verified);

    const result = await listBillsPaginated({ needsReview: true });
    expect(result.bills.map((b) => b.bill_id)).toEqual(['need']);
    expect(result.total).toBe(1);
  });

  it('filters by status=NEED_REVIEW', async () => {
    devStore.bills.set('a', makeBill('a', '2026-07-05T00:00:00Z', 'NEED_REVIEW'));
    devStore.bills.set('b', makeBill('b', '2026-07-04T00:00:00Z', 'OCR_COMPLETED'));
    const result = await listBillsPaginated({ status: 'NEED_REVIEW' });
    expect(result.total).toBe(1);
    expect(result.bills[0].bill_id).toBe('a');
  });
});

describe('countBills', () => {
  beforeEach(() => {
    devStore.bills.clear();
  });

  it('returns 0 when no bills', async () => {
    expect(await countBills()).toBe(0);
  });

  it('counts all bills', async () => {
    devStore.bills.set('b1', makeBill('b1', '2026-07-01T00:00:00Z'));
    devStore.bills.set('b2', makeBill('b2', '2026-07-02T00:00:00Z'));
    expect(await countBills()).toBe(2);
  });

  it('counts by status', async () => {
    devStore.bills.set('b1', makeBill('b1', '2026-07-01T00:00:00Z', 'OCR_COMPLETED'));
    devStore.bills.set('b2', makeBill('b2', '2026-07-02T00:00:00Z', 'FAILED'));
    devStore.bills.set('b3', makeBill('b3', '2026-07-03T00:00:00Z', 'OCR_COMPLETED'));
    expect(await countBills('FAILED')).toBe(1);
    expect(await countBills('OCR_COMPLETED')).toBe(2);
  });
});
