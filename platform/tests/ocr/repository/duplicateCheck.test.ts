import { describe, it, expect, beforeEach } from 'vitest';
import { devStore } from '../../../src/shared/devStore.js';
import { findDuplicateBills } from '../../../src/ocr/repository.js';
import type { BillDoc } from '../../../src/shared/types.js';

function makeBill(id: string, invoiceNumber: string | null, gstin: string | null = null): BillDoc {
  return {
    bill_id: id,
    bill_type: 'MAINTENANCE',
    ocr_status: 'OCR_COMPLETED',
    schema_version: 1,
    invoice_number: invoiceNumber,
    vendor_gstin: gstin,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  } as BillDoc;
}

describe('findDuplicateBills', () => {
  beforeEach(() => {
    devStore.bills.clear();
  });

  it('returns empty when no duplicates exist', async () => {
    devStore.bills.set('b1', makeBill('b1', 'INV-001', '07AABCC4459P1Z7'));
    const dupes = await findDuplicateBills('INV-002', null, 'b2');
    expect(dupes).toEqual([]);
  });

  it('finds duplicate by invoice number', async () => {
    devStore.bills.set('b1', makeBill('b1', 'INV-001', '07AABCC4459P1Z7'));
    const dupes = await findDuplicateBills('INV-001', '07AABCC4459P1Z7', 'b2');
    expect(dupes).toHaveLength(1);
    expect(dupes[0].bill_id).toBe('b1');
  });

  it('excludes the current bill from results', async () => {
    devStore.bills.set('b1', makeBill('b1', 'INV-001', '07AAB'));
    const dupes = await findDuplicateBills('INV-001', '07AAB', 'b1');
    expect(dupes).toEqual([]);
  });

  it('matches by invoice_number alone when gstin is null', async () => {
    devStore.bills.set('b1', makeBill('b1', 'INV-001', null));
    const dupes = await findDuplicateBills('INV-001', null, 'b2');
    expect(dupes).toHaveLength(1);
  });

  it('does not match different invoice numbers', async () => {
    devStore.bills.set('b1', makeBill('b1', 'INV-001'));
    const dupes = await findDuplicateBills('INV-999', null, 'b2');
    expect(dupes).toEqual([]);
  });

  it('returns null invoice_number as no duplicates', async () => {
    devStore.bills.set('b1', makeBill('b1', null));
    const dupes = await findDuplicateBills(null, null, 'b2');
    expect(dupes).toEqual([]);
  });
});
