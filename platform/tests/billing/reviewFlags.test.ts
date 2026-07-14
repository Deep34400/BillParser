import { describe, expect, it } from 'vitest';
import { computeReviewReasons } from '../../src/billing/reviewFlags.js';
import type { ParsedInvoiceData } from '../../src/parsing/types.js';

function parsed(overrides: Partial<ParsedInvoiceData> = {}): ParsedInvoiceData {
  return {
    company_name: 'ARPANNA MOTORS PVT LTD',
    gstin: '27AADCA4487F1ZM',
    pan: 'AADCA4487F',
    invoice_number: 'INV-1',
    parts_line_items: [{ taxable_amount: 100 }],
    labour_service_line_items: [],
    totals_and_tax_summary: { grand_total_invoice: 118 },
    confidence: 0.9,
    ...overrides,
  };
}

describe('computeReviewReasons', () => {
  it('returns no reasons for a complete GST invoice', () => {
    expect(computeReviewReasons(parsed())).toEqual([]);
  });

  it('flags handwritten bill when both GSTIN and PAN are missing', () => {
    const reasons = computeReviewReasons(parsed({ gstin: null, pan: null }));
    expect(reasons.some((r) => /handwritten/i.test(r))).toBe(true);
  });

  it('does NOT warn about PAN when GSTIN is present', () => {
    const reasons = computeReviewReasons(parsed({ pan: null }));
    expect(reasons.some((r) => /PAN|GSTIN/i.test(r))).toBe(false);
  });

  it('does NOT warn when PAN is present even if GSTIN is missing', () => {
    const reasons = computeReviewReasons(parsed({ gstin: null }));
    expect(reasons.some((r) => /PAN|GSTIN/i.test(r))).toBe(false);
  });

  it('warns when a present GSTIN is malformed', () => {
    const reasons = computeReviewReasons(parsed({ gstin: 'NOTAGSTIN' }));
    expect(reasons.some((r) => /GSTIN/i.test(r))).toBe(true);
  });

  it('flags missing vendor name', () => {
    const reasons = computeReviewReasons(parsed({ company_name: null }));
    expect(reasons.some((r) => /vendor|company/i.test(r))).toBe(true);
  });

  it('flags a table-header string mistaken for vendor name', () => {
    const reasons = computeReviewReasons(
      parsed({ company_name: 'S.No. PARTICULARS QTY. RATE AMOUNT Rs. P.' }),
    );
    expect(reasons.some((r) => /vendor|company/i.test(r))).toBe(true);
  });

  it('flags missing grand total', () => {
    const reasons = computeReviewReasons(parsed({ totals_and_tax_summary: {} }));
    expect(reasons.some((r) => /total/i.test(r))).toBe(true);
  });

  it('flags when no line items were extracted', () => {
    const reasons = computeReviewReasons(
      parsed({ parts_line_items: [], labour_service_line_items: [] }),
    );
    expect(reasons.some((r) => /line item/i.test(r))).toBe(true);
  });
});
