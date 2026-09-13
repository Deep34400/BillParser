import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../src/config/db.js';
import { bills } from '../../../src/db/schema.js';
import { createBill, listBillsCursor } from '../../../src/ocr/repository.js';
import type { BillDoc } from '../../../src/shared/types.js';

function makeBill(
  id: string,
  createdAt: string,
  updatedAt: string,
  status: BillDoc['ocr_status'] = 'OCR_COMPLETED',
): BillDoc {
  return {
    bill_id: id,
    bill_type: 'MAINTENANCE',
    ocr_status: status,
    schema_version: 1,
    created_at: createdAt,
    updated_at: updatedAt,
  } as BillDoc;
}

async function clearBills() {
  await db().delete(bills);
}

describe('listBillsCursor', () => {
  beforeEach(clearBills);

  it('returns empty result when no bills exist', async () => {
    const result = await listBillsCursor({});
    expect(result.rows).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('returns bills ordered by created_at desc (latest first)', async () => {
    await createBill(makeBill('b1', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'));
    await createBill(makeBill('b2', '2026-07-03T00:00:00Z', '2026-07-01T00:00:00Z'));
    await createBill(makeBill('b3', '2026-07-02T00:00:00Z', '2026-07-01T00:00:00Z'));

    const result = await listBillsCursor({ limit: 10 });
    expect(result.rows.map((b) => b.bill_id)).toEqual(['b2', 'b3', 'b1']);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('limits results and sets hasMore + nextCursor', async () => {
    await createBill(makeBill('b1', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'));
    await createBill(makeBill('b2', '2026-07-02T00:00:00Z', '2026-07-02T00:00:00Z'));
    await createBill(makeBill('b3', '2026-07-03T00:00:00Z', '2026-07-03T00:00:00Z'));

    const result = await listBillsCursor({ limit: 2 });
    expect(result.rows.map((b) => b.bill_id)).toEqual(['b3', 'b2']);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('2026-07-02T00:00:00.000Z');
  });

  it('paginates with cursor (created_at < cursor)', async () => {
    await createBill(makeBill('b1', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'));
    await createBill(makeBill('b2', '2026-07-02T00:00:00Z', '2026-07-02T00:00:00Z'));
    await createBill(makeBill('b3', '2026-07-03T00:00:00Z', '2026-07-03T00:00:00Z'));
    await createBill(makeBill('b4', '2026-07-04T00:00:00Z', '2026-07-04T00:00:00Z'));

    const page1 = await listBillsCursor({ limit: 2 });
    expect(page1.rows.map((b) => b.bill_id)).toEqual(['b4', 'b3']);
    expect(page1.hasMore).toBe(true);

    const page2 = await listBillsCursor({ limit: 2, cursor: page1.nextCursor! });
    expect(page2.rows.map((b) => b.bill_id)).toEqual(['b2', 'b1']);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
  });

  it('filters by status', async () => {
    await createBill(makeBill('b1', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z', 'OCR_COMPLETED'));
    await createBill(makeBill('b2', '2026-07-02T00:00:00Z', '2026-07-02T00:00:00Z', 'FAILED'));
    await createBill(makeBill('b3', '2026-07-03T00:00:00Z', '2026-07-03T00:00:00Z', 'OCR_COMPLETED'));

    const result = await listBillsCursor({ status: 'FAILED' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].bill_id).toBe('b2');
  });

  it('defaults to limit 10 when not specified', async () => {
    for (let i = 0; i < 15; i++) {
      const day = String(i + 1).padStart(2, '0');
      await createBill(makeBill(`b${i}`, `2026-07-${day}T00:00:00Z`, `2026-07-${day}T00:00:00Z`));
    }

    const result = await listBillsCursor({});
    expect(result.rows).toHaveLength(10);
    expect(result.hasMore).toBe(true);
  });
});
