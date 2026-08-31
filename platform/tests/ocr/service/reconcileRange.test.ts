import { describe, expect, it, beforeEach } from 'vitest';
import { env } from '../../../src/config/env.js';
import { devStore } from '../../../src/shared/devStore.js';
import { createBill } from '../../../src/ocr/repository.js';
import { mapParsedToBill } from '../../../src/ocr/mapper.js';
import {
  parseCreatedAtRange,
  reconcileBillsInCreatedAtRange,
} from '../../../src/ocr/service/reconcileRange.js';
import type { ParsedInvoiceData } from '../../../src/shared/types.js';

const goodParsed = (): ParsedInvoiceData => ({
  company_name: 'TEST',
  gstin: '27AADCA4487F1ZM',
  pan: 'AADCA4487F',
  invoice_number: 'INV-OK',
  parts_line_items: [{ quantity: 1, rate: 100, taxable_amount: 100 }],
  labour_service_line_items: [],
  totals_and_tax_summary: {
    parts_total: 100,
    labour_total: 0,
    parts_cgst_rate: 9,
    parts_sgst_rate: 9,
    grand_total_invoice: 118,
  },
});

const badTotalParsed = (): ParsedInvoiceData => ({
  ...goodParsed(),
  invoice_number: 'INV-BAD',
  totals_and_tax_summary: {
    parts_total: 100,
    labour_total: 0,
    parts_cgst_rate: 9,
    parts_sgst_rate: 9,
    grand_total_invoice: 500, // mismatch
  },
});

describe('parseCreatedAtRange', () => {
  it('expands YYYY-MM-DD to inclusive UTC day bounds', () => {
    const r = parseCreatedAtRange('2026-08-01', '2026-08-31');
    expect(r.startIso).toBe('2026-08-01T00:00:00.000Z');
    expect(r.endIso).toBe('2026-08-31T23:59:59.999Z');
  });
});

describe('reconcileBillsInCreatedAtRange', () => {
  beforeEach(() => {
    (env as { localDev: boolean }).localDev = true;
    devStore.bills.clear();
  });

  it('mode=check previews NEED_REVIEW without writing', async () => {
    const bill = mapParsedToBill('b-bad', badTotalParsed());
    bill.created_at = '2026-08-15T12:00:00.000Z';
    bill.ocr_status = 'OCR_COMPLETED';
    bill.review_codes = null;
    await createBill(bill);

    const r = await reconcileBillsInCreatedAtRange({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      mode: 'check',
    });

    expect(r.mode).toBe('check');
    expect(r.updated).toBe(0);
    expect(r.eligible).toBe(1);
    expect(r.results[0].next_status).toBe('NEED_REVIEW');
    expect(r.results[0].would_change).toBe(true);
    expect(r.results[0].updated).toBe(false);

    const stored = await import('../../../src/ocr/repository.js').then((m) => m.getBill('b-bad'));
    expect(stored?.ocr_status).toBe('OCR_COMPLETED');
  });

  it('mode=update persists status, codes, and total_reconciliation', async () => {
    const bill = mapParsedToBill('b-bad2', badTotalParsed());
    bill.created_at = '2026-08-15T12:00:00.000Z';
    bill.ocr_status = 'OCR_COMPLETED';
    bill.review_codes = null;
    await createBill(bill);

    const r = await reconcileBillsInCreatedAtRange({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      mode: 'update',
    });

    expect(r.updated).toBe(1);
    expect(r.results[0].updated).toBe(true);

    const stored = await import('../../../src/ocr/repository.js').then((m) => m.getBill('b-bad2'));
    expect(stored?.ocr_status).toBe('NEED_REVIEW');
    expect(stored?.review_codes).toContain('TOTAL_MISMATCH');
    expect(stored?.total_reconciliation?.matched).toBe(false);
  });

  it('skips VERIFIED unless include_verified', async () => {
    const bill = mapParsedToBill('b-ver', badTotalParsed());
    bill.created_at = '2026-08-15T12:00:00.000Z';
    bill.ocr_status = 'VERIFIED';
    await createBill(bill);

    const skip = await reconcileBillsInCreatedAtRange({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      mode: 'check',
    });
    expect(skip.eligible).toBe(0);
    expect(skip.skipped).toBe(1);

    const incl = await reconcileBillsInCreatedAtRange({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      mode: 'check',
      includeVerified: true,
    });
    expect(incl.eligible).toBe(1);
    expect(incl.results[0].next_status).toBe('NEED_REVIEW');
  });
});
