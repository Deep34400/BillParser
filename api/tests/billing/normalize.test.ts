import { describe, it, expect } from 'vitest';
import {
  normalizePartsLineItem, normalizeLabourLineItem, enrichParsedInvoice, roundMoney, partsTaxableMismatch,
} from '../../src/billing/normalize.js';
import { extractSummaryFromMarkdown } from '../../src/billing/footerExtract.js';

describe('schema normalize', () => {
  it('fills taxable from quantity × rate when missing', () => {
    const r = normalizePartsLineItem({ quantity: 2.8, rate: 406.77, item_name_description: 'OIL' });
    expect(r.taxable_amount).toBe(roundMoney(2.8 * 406.77));
  });

  it('snaps taxable when close to quantity × rate', () => {
    const r = normalizePartsLineItem({ quantity: 1, rate: 9.32, taxable_amount: 9.33 });
    expect(r.taxable_amount).toBe(9.32);
  });

  it('keeps printed taxable when it disagrees with quantity × rate', () => {
    const r = normalizePartsLineItem({ quantity: 1, rate: 9.32, taxable_amount: 10.5 });
    expect(r.taxable_amount).toBe(10.5);
    expect(partsTaxableMismatch(r)).toBe(true);
  });

  it('labour uses labour_charges directly', () => {
    const r = normalizeLabourLineItem({ labour_description: 'PMS', labour_charges: 2140 });
    expect(r.labour_charges).toBe(2140);
  });

  it('fills parts_total and labour_total from line sums', () => {
    const data = enrichParsedInvoice({
      parts_line_items: [
        { quantity: 1, rate: 9.32, taxable_amount: 9.32 },
        { quantity: 1, rate: 35.59, taxable_amount: 35.59 },
      ],
      labour_service_line_items: [{ labour_charges: 2140 }],
      totals_and_tax_summary: { parts_discount: 100 },
    });
    expect(data.totals_and_tax_summary?.parts_total).toBe(44.91);
    expect(data.totals_and_tax_summary?.labour_total).toBe(2140);
    expect(data.totals_and_tax_summary?.parts_discount).toBe(100);
  });

  it('extracts discount and GST footer from OCR markdown', () => {
    const md = [
      'Sub Total Amount 2117.31 2140.00',
      'Less Discount on Parts & Labour 325.63 1284.00',
      'CGST @ 9% 161.26 77.04',
      'SGST @ 9% 161.26 77.04',
      'Net Bill Amount (Rounded) 3124.00',
    ].join('\n');
    const fromMd = extractSummaryFromMarkdown(md);
    expect(fromMd.parts_discount).toBe(325.63);
    expect(fromMd.labour_discount).toBe(1284);
    expect(fromMd.parts_cgst_rate).toBe(9);
    expect(fromMd.parts_cgst_amount).toBe(161.26);
    expect(fromMd.grand_total_invoice).toBe(3124);
  });
});
