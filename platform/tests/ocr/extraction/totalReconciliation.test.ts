import { describe, expect, it } from 'vitest';
import { reconcileInvoiceTotal } from '../../../src/ocr/transformer/reconcileTotal.js';
import type { ParsedInvoiceData } from '../../../src/ocr/types/invoice.js';

function parsed(overrides: Partial<ParsedInvoiceData> = {}): ParsedInvoiceData {
  return {
    company_name: 'TEST MOTORS',
    gstin: '27AADCA4487F1ZM',
    pan: 'AADCA4487F',
    invoice_number: 'INV-1',
    invoice_date: '15/01/2025',
    parts_line_items: [
      { quantity: 2, rate: 100, taxable_amount: 200, tax_percentage: 18, hsn_sac_code: '87089900' },
    ],
    labour_service_line_items: [
      { labour_charges: 500, tax_percentage: 18 },
    ],
    totals_and_tax_summary: {
      parts_total: 200,
      labour_total: 500,
      parts_discount: 0,
      labour_discount: 0,
      parts_special_discount: 0,
      labour_special_discount: 0,
      parts_cgst_rate: 9,
      parts_sgst_rate: 9,
      labour_cgst_rate: 9,
      labour_sgst_rate: 9,
      parts_cgst_amount: 18,
      parts_sgst_amount: 18,
      labour_cgst_amount: 45,
      labour_sgst_amount: 45,
      deductibles: null,
      salvage: null,
      sub_total_calculated: 826,
      grand_total_invoice: 826,
    },
    ...overrides,
  };
}

describe('reconcileInvoiceTotal', () => {
  it('matched: true when calculated equals grand_total within ₹2', () => {
    // parts_base = 2*100 = 200, labour_base = 500
    // tax parts = 200 * 18/100 = 36, tax labour = 500 * 18/100 = 90
    // total = 200 + 500 + 36 + 90 = 826
    const r = reconcileInvoiceTotal(parsed());
    expect(r.matched).toBe(true);
    expect(r.calculated_total).toBe(826);
    expect(r.grand_total_invoice).toBe(826);
    expect(r.difference).toBe(0);
    expect(r.reason).toBeNull();
  });

  it('matched: false when difference > ₹2', () => {
    const r = reconcileInvoiceTotal(parsed({
      totals_and_tax_summary: {
        ...parsed().totals_and_tax_summary!,
        grand_total_invoice: 800,
      },
    }));
    expect(r.matched).toBe(false);
    expect(r.calculated_total).toBe(826);
    expect(r.grand_total_invoice).toBe(800);
    expect(r.difference).toBe(26);
    expect(r.reason).toMatch(/mismatch|differ/i);
  });

  it('matched: true when difference is exactly ₹2', () => {
    const r = reconcileInvoiceTotal(parsed({
      totals_and_tax_summary: {
        ...parsed().totals_and_tax_summary!,
        grand_total_invoice: 828,
      },
    }));
    expect(r.matched).toBe(true);
    expect(r.difference).toBe(2);
  });

  it('uses 0 when taxable_amount is 0 even if qty*rate > 0', () => {
    const r = reconcileInvoiceTotal(parsed({
      parts_line_items: [
        { quantity: 1, rate: 1122.88, taxable_amount: 0 },
        { quantity: 1, rate: 100, taxable_amount: 100, tax_percentage: 18 },
      ],
      labour_service_line_items: [],
      totals_and_tax_summary: {
        parts_total: 100,
        labour_total: 0,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        grand_total_invoice: 118,
        sub_total_calculated: 118,
      },
    }));
    // insurance line contributes 0; other line uses qty×rate = 100
    expect(r.parts_base).toBe(100);
    expect(r.matched).toBe(true);
  });

  it('uses qty*rate when taxable_amount is non-zero (even if taxable differs)', () => {
    const r = reconcileInvoiceTotal(parsed({
      parts_line_items: [
        { quantity: 1, rate: 1953.38, taxable_amount: 97.67, tax_percentage: 18 },
      ],
      labour_service_line_items: [],
      totals_and_tax_summary: {
        parts_total: 1953.38,
        labour_total: 0,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        grand_total_invoice: 2304.99, // 1953.38 * 1.18
        sub_total_calculated: 2304.99,
      },
    }));
    expect(r.parts_base).toBe(1953.38);
    expect(r.matched).toBe(true);
  });

  it('uses 0 when qty*rate is 0', () => {
    const r = reconcileInvoiceTotal(parsed({
      parts_line_items: [
        { quantity: 0, rate: 0, taxable_amount: 300, tax_percentage: 18 },
      ],
      labour_service_line_items: [],
      totals_and_tax_summary: {
        parts_total: 0,
        labour_total: 0,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        grand_total_invoice: 0,
        sub_total_calculated: 0,
      },
    }));
    expect(r.parts_base).toBe(0);
    expect(r.matched).toBe(true);
  });

  it('uses qty*rate when taxable_amount is null', () => {
    const r = reconcileInvoiceTotal(parsed({
      parts_line_items: [
        { quantity: 2, rate: 100, taxable_amount: null, tax_percentage: 18 },
      ],
      labour_service_line_items: [],
      totals_and_tax_summary: {
        parts_total: 200,
        labour_total: 0,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        grand_total_invoice: 236,
        sub_total_calculated: 236,
      },
    }));
    expect(r.parts_base).toBe(200);
    expect(r.matched).toBe(true);
  });

  it('applies discounts before tax per side', () => {
    const r = reconcileInvoiceTotal(parsed({
      totals_and_tax_summary: {
        ...parsed().totals_and_tax_summary!,
        parts_discount: 20,
        labour_discount: 50,
        // parts_taxable = 200-20 = 180, labour_taxable = 500-50 = 450
        // tax = 180*0.18 + 450*0.18 = 32.4 + 81 = 113.4
        // total = 180 + 450 + 113.4 = 743.4
        grand_total_invoice: 743.4,
        sub_total_calculated: 743.4,
      },
    }));
    expect(r.parts_base).toBe(200);
    expect(r.labour_base).toBe(500);
    expect(r.matched).toBe(true);
  });

  it('applies special discounts alongside regular discounts', () => {
    const r = reconcileInvoiceTotal(parsed({
      totals_and_tax_summary: {
        ...parsed().totals_and_tax_summary!,
        parts_discount: 10,
        parts_special_discount: 10,
        // parts_taxable = 200-20 = 180, labour=500
        // tax = 180*0.18 + 500*0.18 = 32.4 + 90 = 122.4
        // total = 180 + 500 + 122.4 = 802.4
        grand_total_invoice: 802.4,
        sub_total_calculated: 802.4,
      },
    }));
    expect(r.matched).toBe(true);
  });

  it('uses CGST+SGST rates when both present (ignores amounts)', () => {
    const r = reconcileInvoiceTotal(parsed({
      totals_and_tax_summary: {
        ...parsed().totals_and_tax_summary!,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        parts_cgst_amount: 999, // wrong amount, should be ignored
        parts_sgst_amount: 999,
      },
    }));
    // tax on parts = 200 * 18/100 = 36 (from rates, not amounts)
    expect(r.calculated_total).toBe(826);
    expect(r.matched).toBe(true);
  });

  it('uses IGST rate when CGST/SGST rates absent', () => {
    const r = reconcileInvoiceTotal(parsed({
      totals_and_tax_summary: {
        ...parsed().totals_and_tax_summary!,
        parts_cgst_rate: null,
        parts_sgst_rate: null,
        parts_igst_rate: 18,
        labour_cgst_rate: null,
        labour_sgst_rate: null,
        labour_igst_rate: 18,
      },
    }));
    expect(r.matched).toBe(true);
    expect(r.calculated_total).toBe(826);
  });

  it('zero tax when no rates present', () => {
    // parts=200, labour=500, no tax → 700
    const r = reconcileInvoiceTotal(parsed({
      totals_and_tax_summary: {
        parts_total: 200,
        labour_total: 500,
        parts_cgst_rate: null,
        parts_sgst_rate: null,
        parts_igst_rate: null,
        labour_cgst_rate: null,
        labour_sgst_rate: null,
        labour_igst_rate: null,
        grand_total_invoice: 700,
        sub_total_calculated: 700,
      },
    }));
    expect(r.calculated_total).toBe(700);
    expect(r.matched).toBe(true);
  });

  it('adds deductibles and salvage to calculated total', () => {
    // base calc = 826, deductibles 100, salvage 50 → 826+100+50 = 976
    const r = reconcileInvoiceTotal(parsed({
      totals_and_tax_summary: {
        ...parsed().totals_and_tax_summary!,
        deductibles: 100,
        salvage: 50,
        grand_total_invoice: 976,
      },
    }));
    expect(r.deductibles).toBe(100);
    expect(r.salvage).toBe(50);
    expect(r.calculated_total).toBe(976);
    expect(r.matched).toBe(true);
  });

  it('treats null deductibles/salvage as 0', () => {
    const r = reconcileInvoiceTotal(parsed());
    expect(r.deductibles).toBe(0);
    expect(r.salvage).toBe(0);
  });

  it('skips check (matched true) when no line items and no grand total', () => {
    const r = reconcileInvoiceTotal(parsed({
      parts_line_items: [],
      labour_service_line_items: [],
      totals_and_tax_summary: {},
    }));
    expect(r.matched).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('fails when lines exist but grand_total_invoice is missing', () => {
    const r = reconcileInvoiceTotal(parsed({
      totals_and_tax_summary: {
        ...parsed().totals_and_tax_summary!,
        grand_total_invoice: null,
      },
    }));
    expect(r.matched).toBe(false);
    expect(r.reason).toMatch(/grand total missing/i);
  });
});
