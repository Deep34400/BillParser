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

describe('computeReviewReasons', () => {
  it('returns no reasons for a complete GST invoice', () => {
    expect(computeReviewReasons(parsed())).toEqual([]);
  });

  it('flags handwritten bill when both GSTIN and PAN are missing', () => {
    const reasons = computeReviewReasons(parsed({ gstin: null, pan: null }));
    expect(reasons.some((r) => /handwritten/i.test(r))).toBe(true);
  });

  it('does NOT warn about missing PAN when GSTIN is present', () => {
    const reasons = computeReviewReasons(parsed({ pan: null }));
    expect(reasons.some((r) => /PAN format|PAN is missing|handwritten/i.test(r))).toBe(false);
  });

  it('does NOT warn when GSTIN is missing if PAN is present (GSTIN-only checks disabled)', () => {
    const reasons = computeReviewReasons(parsed({ gstin: null }));
    expect(reasons.some((r) => /gstin is missing|gstin format/i.test(r))).toBe(false);
    expect(reasons.some((r) => /handwritten/i.test(r))).toBe(false);
  });

  it('does NOT warn when GSTIN is malformed (GST format checks disabled for Needs review)', () => {
    const reasons = computeReviewReasons(parsed({ gstin: 'NOTAGSTIN' }));
    expect(reasons.some((r) => /gstin format|gstin looks invalid/i.test(r))).toBe(false);
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
    const reasons = computeReviewReasons(parsed({
      totals_and_tax_summary: { parts_total: 100, labour_total: 0 },
    }));
    expect(reasons.some((r) => /total/i.test(r))).toBe(true);
  });

  it('flags when no line items were extracted', () => {
    const reasons = computeReviewReasons(
      parsed({ parts_line_items: [], labour_service_line_items: [] }),
    );
    expect(reasons.some((r) => /line item/i.test(r))).toBe(true);
  });

  it('surfaces invalid vehicle registration from validation', () => {
    const reasons = computeReviewReasons(
      parsed({ vehicle_details: { registration_number: 'NOT-A-PLATE' } }),
    );
    expect(reasons.some((r) => /registration/i.test(r))).toBe(true);
  });

  it('surfaces missing vehicle registration from validation', () => {
    const reasons = computeReviewReasons(parsed({ vehicle_details: {} }));
    expect(reasons.some((r) => /registration/i.test(r))).toBe(true);
  });

  it('does NOT surface invalid GST rate on the banner (GST checks disabled)', () => {
    const reasons = computeReviewReasons(parsed({
      parts_line_items: [{ quantity: 1, rate: 100, taxable_amount: 100, tax_percentage: 9, hsn_sac_code: '87089900' }],
    }));
    expect(reasons.some((r) => /gst|tax percentage/i.test(r))).toBe(false);
  });

  it('surfaces totals mismatch on the banner', () => {
    const reasons = computeReviewReasons(parsed({
      parts_line_items: [{ quantity: 1, rate: 100, taxable_amount: 100, tax_percentage: 18, hsn_sac_code: '87089900' }],
      totals_and_tax_summary: {
        parts_total: 500,
        labour_total: 0,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        parts_cgst_amount: 45,
        parts_sgst_amount: 45,
        grand_total_invoice: 590,
        sub_total_calculated: 590,
      },
    }));
    expect(reasons.some((r) => /parts_total/i.test(r))).toBe(true);
  });

  it('does NOT surface GST amount mismatch on the banner (GST checks disabled)', () => {
    const reasons = computeReviewReasons(parsed({
      totals_and_tax_summary: {
        parts_total: 100,
        labour_total: 0,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        parts_cgst_amount: 50,
        parts_sgst_amount: 9,
        grand_total_invoice: 159,
        sub_total_calculated: 159,
      },
    }));
    expect(reasons.some((r) => /GST amount|CGST|SGST|IGST/i.test(r))).toBe(false);
  });
});
