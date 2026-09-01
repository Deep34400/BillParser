import { describe, expect, it } from 'vitest';
import { computeReview, computeReviewReasons } from '../../../src/ocr/transformer/review.js';
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

describe('computeReview — review codes', () => {
  it('returns no reasons/codes for a complete GST invoice', () => {
    const r = computeReview(parsed());
    expect(r.reasons).toEqual([]);
    expect(r.codes).toEqual([]);
  });

  it('flags MISSING_TAX_ID when both GSTIN and PAN are missing', () => {
    const r = computeReview(parsed({ gstin: null, pan: null }));
    expect(r.codes).toContain('MISSING_TAX_ID');
    expect(r.reasons.some((x) => /handwritten|GSTIN or PAN/i.test(x))).toBe(true);
  });

  it('does NOT warn about missing PAN when GSTIN is present', () => {
    expect(computeReviewReasons(parsed({ pan: null }))).toEqual([]);
  });

  it('does NOT warn when GSTIN is missing if PAN is present', () => {
    expect(computeReviewReasons(parsed({ gstin: null }))).toEqual([]);
  });

  it('does NOT flag missing vendor name (disabled)', () => {
    expect(computeReviewReasons(parsed({ company_name: null }))).toEqual([]);
  });

  it('flags TOTAL_MISMATCH when grand total missing but lines exist', () => {
    const r = computeReview(parsed({
      totals_and_tax_summary: { parts_total: 100, labour_total: 0, parts_cgst_rate: 9, parts_sgst_rate: 9 },
    }));
    expect(r.codes).toContain('TOTAL_MISMATCH');
    expect(r.reasons.some((x) => /grand total missing/i.test(x))).toBe(true);
  });

  it('flags TOTAL_MISMATCH when empty line items vs non-null grand total', () => {
    const r = computeReview(
      parsed({ parts_line_items: [], labour_service_line_items: [] }),
    );
    expect(r.codes).toContain('TOTAL_MISMATCH');
  });

  it('flags PARTS_BASE_MISMATCH when taxable sum ≠ parts_total and total also mismatches', () => {
    const r = computeReview(parsed({
      parts_line_items: [{ quantity: 2, rate: 100, taxable_amount: 200 }],
      totals_and_tax_summary: {
        parts_total: 100, // should be 200
        labour_total: 0,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        grand_total_invoice: 999, // does not reconcile with line base
        sub_total_calculated: 236,
      },
    }));
    expect(r.codes).toContain('PARTS_BASE_MISMATCH');
    expect(r.codes).toContain('TOTAL_MISMATCH');
  });

  it('does NOT flag PARTS_BASE when bad footer parts_total but line base reconciles to grand total', () => {
    const r = computeReview(parsed({
      parts_line_items: [
        { quantity: 1, rate: 1122.88, taxable_amount: 0 }, // contributes 0
        { quantity: 1, rate: 100, taxable_amount: 100, tax_percentage: 18 }, // qty×rate
      ],
      labour_service_line_items: [{ labour_charges: 0 }],
      totals_and_tax_summary: {
        parts_total: 6395.38, // wrong footer — line base is 100
        labour_total: 0,
        parts_discount: 0,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        deductibles: 500,
        grand_total_invoice: 618, // 100 + 18 tax + 500
      },
    }));
    expect(r.total_reconciliation?.matched).toBe(true);
    expect(r.codes).not.toContain('PARTS_BASE_MISMATCH');
    expect(r.codes).not.toContain('TOTAL_MISMATCH');
  });

  it('does NOT flag PARTS_BASE when insurance lines have rate 0 so qty*rate matches parts_total', () => {
    const r = computeReview({
      company_name: 'MY CAR',
      gstin: '27AAECM2713M1ZD',
      pan: 'AAECM2713M',
      parts_line_items: [
        { quantity: 1, rate: 0, taxable_amount: 0 },
        { quantity: 1, rate: 54.23, taxable_amount: 54.23 },
        { quantity: 1, rate: 54.23, taxable_amount: 54.23 },
        { quantity: 1, rate: 79.66, taxable_amount: 79.66 },
        { quantity: 1, rate: 78.81, taxable_amount: 78.81 },
      ],
      labour_service_line_items: [{ labour_charges: 0 }],
      totals_and_tax_summary: {
        parts_total: 266.93,
        labour_total: 0,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        deductibles: 500,
        grand_total_invoice: 815,
      },
    });
    expect(r.codes).not.toContain('PARTS_BASE_MISMATCH');
    expect(r.codes).not.toContain('TOTAL_MISMATCH');
  });

  it('flags LABOUR_BASE_MISMATCH when labour sum ≠ labour_total', () => {
    const r = computeReview(parsed({
      parts_line_items: [],
      labour_service_line_items: [{ labour_charges: 500 }],
      totals_and_tax_summary: {
        parts_total: 0,
        labour_total: 400, // should be 500
        labour_cgst_rate: 9,
        labour_sgst_rate: 9,
        grand_total_invoice: 590, // 500 * 1.18
        sub_total_calculated: 590,
      },
    }));
    expect(r.codes).toContain('LABOUR_BASE_MISMATCH');
  });

  it('does NOT surface validation registration issues (disabled)', () => {
    expect(computeReviewReasons(
      parsed({ vehicle_details: { registration_number: 'NOT-A-PLATE' } }),
    )).toEqual([]);
  });
});
