import { describe, expect, it } from 'vitest';
import { computeReviewReasons } from '../../../src/ocr/transformer/review.js';
import type { ParsedInvoiceData } from '../../../src/ocr/types/invoice.js';

/** Fixture that passes both review heuristics and full validation. */
function parsed(overrides: Partial<ParsedInvoiceData> = {}): ParsedInvoiceData {
  return {
    company_name: 'ARPANNA MOTORS PVT LTD',
    gstin: '27AADCA4487F1ZM',
    pan: 'AADCA4487F',
    invoice_number: 'INV-1',
    invoice_date: '15/01/2025',
    vehicle_details: { registration_number: 'MH01FE2778' },
    parts_line_items: [{
      quantity: 1,
      rate: 100,
      taxable_amount: 100,
      tax_percentage: 18,
      hsn_sac_code: '87089900',
    }],
    labour_service_line_items: [],
    totals_and_tax_summary: {
      parts_total: 100,
      labour_total: 0,
      parts_cgst_rate: 9,
      parts_sgst_rate: 9,
      parts_cgst_amount: 9,
      parts_sgst_amount: 9,
      sub_total_calculated: 118,
      grand_total_invoice: 118,
    },
    confidence: 0.9,
    ...overrides,
  };
}

describe('computeReviewReasons — GSTIN/PAN-only policy', () => {
  it('returns no reasons for a complete GST invoice', () => {
    expect(computeReviewReasons(parsed())).toEqual([]);
  });

  it('flags handwritten bill when both GSTIN and PAN are missing', () => {
    const reasons = computeReviewReasons(parsed({ gstin: null, pan: null }));
    expect(reasons.some((r) => /handwritten|GSTIN or PAN/i.test(r))).toBe(true);
  });

  it('does NOT warn about missing PAN when GSTIN is present', () => {
    const reasons = computeReviewReasons(parsed({ pan: null }));
    expect(reasons).toEqual([]);
  });

  it('does NOT warn when GSTIN is missing if PAN is present', () => {
    const reasons = computeReviewReasons(parsed({ gstin: null }));
    expect(reasons).toEqual([]);
  });

  // --- Temporarily disabled rules (commented in review.ts) ---

  it('does NOT flag missing vendor name (disabled)', () => {
    const reasons = computeReviewReasons(parsed({ company_name: null }));
    expect(reasons).toEqual([]);
  });

  it('flags total mismatch when grand total missing but lines exist', () => {
    const reasons = computeReviewReasons(parsed({
      totals_and_tax_summary: { parts_total: 100, labour_total: 0 },
    }));
    expect(reasons.some((r) => /grand total missing/i.test(r))).toBe(true);
  });

  it('flags total mismatch when empty line items vs non-null grand total', () => {
    const reasons = computeReviewReasons(
      parsed({ parts_line_items: [], labour_service_line_items: [] }),
    );
    expect(reasons.some((r) => /mismatch/i.test(r))).toBe(true);
  });

  it('does NOT surface validation registration issues (disabled)', () => {
    const reasons = computeReviewReasons(
      parsed({ vehicle_details: { registration_number: 'NOT-A-PLATE' } }),
    );
    expect(reasons).toEqual([]);
  });
});
