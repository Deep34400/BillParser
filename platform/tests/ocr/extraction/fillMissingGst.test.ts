import { describe, expect, it } from 'vitest';
import { fillMissingGstAmounts, resolveBillSummary } from '../../../src/ocr/extraction/billSummary.js';
import type { ParsedInvoiceData, TotalsAndTaxSummary } from '../../../src/ocr/parsing/types.js';

describe('fillMissingGstAmounts — Kataria-style footer (rates only)', () => {
  it('fills CGST/SGST amounts from (subtotal − discount) × rate%', () => {
    const t: TotalsAndTaxSummary = {
      parts_total: 4130.02,
      labour_total: 2120,
      parts_discount: 619.51,
      labour_discount: 576,
      parts_cgst_rate: 9,
      parts_sgst_rate: 9,
      labour_cgst_rate: 9,
      labour_sgst_rate: 9,
      // amounts missing — Gemini single often returns rates only
      parts_cgst_amount: null,
      parts_sgst_amount: null,
      labour_cgst_amount: null,
      labour_sgst_amount: null,
      grand_total_invoice: 5964,
    };

    fillMissingGstAmounts(t);

    expect(t.parts_cgst_amount).toBeCloseTo(315.95, 2);
    expect(t.parts_sgst_amount).toBeCloseTo(315.95, 2);
    expect(t.labour_cgst_amount).toBeCloseTo(138.96, 2);
    expect(t.labour_sgst_amount).toBeCloseTo(138.96, 2);
  });

  it('does not overwrite existing printed GST amounts', () => {
    const t: TotalsAndTaxSummary = {
      parts_total: 1000,
      parts_discount: 0,
      parts_cgst_rate: 9,
      parts_sgst_rate: 9,
      parts_cgst_amount: 88.88, // printed — keep it
      parts_sgst_amount: 88.88,
    };
    fillMissingGstAmounts(t);
    expect(t.parts_cgst_amount).toBe(88.88);
  });

  it('resolveBillSummary fills GST for Kataria invoice without markdown', () => {
    const data: ParsedInvoiceData = {
      company_name: 'KATARIA AUTOMOBILES PVT LTD',
      gstin: '29AAACK6221C1ZX',
      invoice_number: '152/BR/26000095',
      parts_line_items: [
        { item_name_description: 'GASKET', taxable_amount: 100, tax_percentage: 18 },
      ],
      labour_service_line_items: [
        { labour_description: 'PMS', labour_charges: 1920, tax_percentage: 18 },
        { labour_description: 'WHEEL BALANCING', labour_charges: 200, tax_percentage: 18 },
      ],
      totals_and_tax_summary: {
        parts_total: 4130.02,
        labour_total: 2120,
        parts_discount: 619.51,
        labour_discount: 576,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        labour_cgst_rate: 9,
        labour_sgst_rate: 9,
        grand_total_invoice: 5964,
      },
      confidence: 0.9,
    };

    // No markdown (Gemini single mode) — amounts must still fill
    const t = resolveBillSummary(data, '');
    expect(t.parts_cgst_amount).toBeCloseTo(315.95, 2);
    expect(t.parts_sgst_amount).toBeCloseTo(315.95, 2);
    expect(t.labour_cgst_amount).toBeCloseTo(138.96, 2);
    expect(t.labour_sgst_amount).toBeCloseTo(138.96, 2);

    const partsNet = 4130.02 - 619.51 + 315.95 + 315.95;
    const labourNet = 2120 - 576 + 138.96 + 138.96;
    expect(Math.round(partsNet + labourNet)).toBe(5964);
  });
});
