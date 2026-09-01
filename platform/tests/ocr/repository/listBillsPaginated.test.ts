import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../src/config/db.js';
import { bills } from '../../../src/db/schema.js';
import { createBill, listBillsPaginated, countBills } from '../../../src/ocr/repository.js';
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

async function clearBills() {
  await db().delete(bills);
}

describe('listBillsPaginated', () => {
  beforeEach(clearBills);

  it('returns empty result when no bills exist', async () => {
    const result = await listBillsPaginated({});
    expect(result.bills).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('returns bills ordered by updated_at desc (latest first)', async () => {
    await createBill(makeBill('b1', '2026-07-01T00:00:00Z'));
    await createBill(makeBill('b2', '2026-07-03T00:00:00Z'));
    await createBill(makeBill('b3', '2026-07-02T00:00:00Z'));

    const result = await listBillsPaginated({ pageSize: 10 });
    expect(result.bills.map(b => b.bill_id)).toEqual(['b2', 'b3', 'b1']);
  });

  it('limits results to pageSize', async () => {
    await createBill(makeBill('b1', '2026-07-01T00:00:00Z'));
    await createBill(makeBill('b2', '2026-07-02T00:00:00Z'));
    await createBill(makeBill('b3', '2026-07-03T00:00:00Z'));

    const result = await listBillsPaginated({ pageSize: 2 });
    expect(result.bills).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.totalPages).toBe(2);
  });

  it('returns correct totalPages when all bills fit in one page', async () => {
    await createBill(makeBill('b1', '2026-07-01T00:00:00Z'));

    const result = await listBillsPaginated({ pageSize: 10 });
    expect(result.bills).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('paginates by page number (page 1, 2, 3)', async () => {
    await createBill(makeBill('b1', '2026-07-01T00:00:00Z'));
    await createBill(makeBill('b2', '2026-07-02T00:00:00Z'));
    await createBill(makeBill('b3', '2026-07-03T00:00:00Z'));
    await createBill(makeBill('b4', '2026-07-04T00:00:00Z'));
    await createBill(makeBill('b5', '2026-07-05T00:00:00Z'));

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
    await createBill(makeBill('b1', '2026-07-01T00:00:00Z', 'OCR_COMPLETED'));
    await createBill(makeBill('b2', '2026-07-02T00:00:00Z', 'FAILED'));
    await createBill(makeBill('b3', '2026-07-03T00:00:00Z', 'OCR_COMPLETED'));

    const result = await listBillsPaginated({ status: 'FAILED' });
    expect(result.bills).toHaveLength(1);
    expect(result.bills[0].bill_id).toBe('b2');
    expect(result.total).toBe(1);
  });

  it('combines status filter with pagination', async () => {
    await createBill(makeBill('b1', '2026-07-01T00:00:00Z', 'OCR_COMPLETED'));
    await createBill(makeBill('b2', '2026-07-02T00:00:00Z', 'OCR_COMPLETED'));
    await createBill(makeBill('b3', '2026-07-03T00:00:00Z', 'FAILED'));
    await createBill(makeBill('b4', '2026-07-04T00:00:00Z', 'OCR_COMPLETED'));

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
      await createBill(makeBill(`b${i}`, `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z`));
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
    await createBill(makeBill('b1', '2026-07-01T00:00:00Z', 'OCR_COMPLETED'));
    await createBill(makeBill('b2', '2026-07-02T00:00:00Z', 'VERIFIED'));
    await createBill(makeBill('b3', '2026-07-03T00:00:00Z', 'FAILED'));
    const result = await listBillsPaginated({ statuses: ['OCR_COMPLETED', 'VERIFIED'] });
    expect(result.total).toBe(2);
    expect(result.bills.map((b) => b.bill_id).sort()).toEqual(['b1', 'b2']);
  });

  it('excludes needs-review bills from completed when excludeNeedsReview=true', async () => {
    // NEED_REVIEW is now its own status, so it already falls outside a
    // completed-statuses filter; excludeNeedsReview is belt-and-braces.
    await createBill(makeBill('clean', '2026-07-05T00:00:00Z', 'OCR_COMPLETED'));
    await createBill(makeBill('flag', '2026-07-04T00:00:00Z', 'NEED_REVIEW'));

    const result = await listBillsPaginated({
      statuses: ['OCR_COMPLETED', 'VERIFIED'],
      excludeNeedsReview: true,
    });
    expect(result.bills.map((b) => b.bill_id)).toEqual(['clean']);
    expect(result.total).toBe(1);
  });

  it('returns only bills that need review when needsReview=true', async () => {
    // Needs-review is the persisted NEED_REVIEW status now — low confidence or
    // review_reasons alone no longer qualify a bill.
    await createBill(makeBill('nr1', '2026-07-05T00:00:00Z', 'NEED_REVIEW'));
    await createBill(makeBill('nr2', '2026-07-03T00:00:00Z', 'NEED_REVIEW'));
    const lowConf = makeBill('lowconf', '2026-07-04T00:00:00Z', 'OCR_COMPLETED');
    lowConf.confidence_score = 0.4;
    lowConf.review_reasons = ['Duplicate: INV-1'];
    await createBill(lowConf);
    await createBill(makeBill('ver', '2026-07-02T00:00:00Z', 'VERIFIED'));

    const result = await listBillsPaginated({ needsReview: true });
    expect(result.bills.map((b) => b.bill_id).sort()).toEqual(['nr1', 'nr2']);
    expect(result.total).toBe(2);
  });

  it('substring search matches mid-string, not just prefix', async () => {
    await createBill({ ...makeBill('b1', '2026-07-01T00:00:00Z'), vendor_name: 'Zenith Auto Care Center' });
    await createBill({ ...makeBill('b2', '2026-07-02T00:00:00Z'), vendor_name: 'Unrelated Motors' });

    const result = await listBillsPaginated({ q: 'Auto Care' });
    expect(result.bills.map((b) => b.bill_id)).toEqual(['b1']);
  });
});

describe('countBills', () => {
  beforeEach(clearBills);

  it('returns 0 when no bills', async () => {
    expect(await countBills()).toBe(0);
  });

  it('counts all bills', async () => {
    await createBill(makeBill('b1', '2026-07-01T00:00:00Z'));
    await createBill(makeBill('b2', '2026-07-02T00:00:00Z'));
    expect(await countBills()).toBe(2);
  });

  it('counts by status', async () => {
    await createBill(makeBill('b1', '2026-07-01T00:00:00Z', 'OCR_COMPLETED'));
    await createBill(makeBill('b2', '2026-07-02T00:00:00Z', 'FAILED'));
    await createBill(makeBill('b3', '2026-07-03T00:00:00Z', 'OCR_COMPLETED'));
    expect(await countBills('FAILED')).toBe(1);
    expect(await countBills('OCR_COMPLETED')).toBe(2);
  });
  it('filters by status=NEED_REVIEW', async () => {
    // Needs-review became a persisted status rather than a runtime heuristic, so
    // it is now an ordinary indexed status filter.
    await createBill(makeBill('nr1', '2026-07-05T00:00:00Z', 'NEED_REVIEW'));
    await createBill(makeBill('ok1', '2026-07-04T00:00:00Z', 'OCR_COMPLETED'));
    const result = await listBillsPaginated({ status: 'NEED_REVIEW' });
    expect(result.total).toBe(1);
    expect(result.bills[0].bill_id).toBe('nr1');
  });

});
