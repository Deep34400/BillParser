import { describe, expect, it } from 'vitest';
import { extractSummaryFromMarkdown } from '../../../src/ocr/transformer/normalize/footer.js';
import { resolveBillSummary } from '../../../src/ocr/transformer/normalize/totals.js';
import { reconcileInvoiceTotal } from '../../../src/ocr/transformer/reconcileTotal.js';
import type { ParsedInvoiceData } from '../../../src/ocr/types/invoice.js';

const CARRUM_FOOTER = `
| Sub Total Amount | : | 1,577.09 | 0.00 | 925.00 |
| Less Discount on Parts & Labour | : | 157.71 | 0.00 | 925.00 |
| CGST @ 9% | : | 127.76 | | |
| SGST @ 9% | : | 127.76 | | |
| Sub Total Amount | : | 1,674.90 | 0.00 | 0.00 |
**Net Bill Amount (Rounded) : 1,675.00**
`.trim();

const base = (): ParsedInvoiceData => ({
  parts_line_items: [
    { quantity: 1, rate: 59.32, taxable_amount: 59.32 },
    { quantity: 1, rate: 101.69, taxable_amount: 101.69 },
    { quantity: 1, rate: 88.98, taxable_amount: 88.98 },
    { quantity: 2.9, rate: 457.62, taxable_amount: 1327.1 },
  ],
  labour_service_line_items: [
    { labour_charges: 0 }, { labour_charges: 450 }, { labour_charges: 475 },
  ],
  totals_and_tax_summary: {
    parts_total: 1577.09,
    labour_total: 925,
    parts_discount: 157.71,
    labour_discount: 0,
    parts_cgst_rate: 9,
    parts_sgst_rate: 9,
    parts_cgst_amount: 127.76,
    parts_sgst_amount: 127.76,
    labour_cgst_amount: 0,
    labour_sgst_amount: 0,
    grand_total_invoice: 1675,
    sub_total_calculated: 1674.9,
  },
});

describe('Carrum labour full discount', () => {
  it('footer extracts labour_discount 925 from 3-col Less Discount row', () => {
    const s = extractSummaryFromMarkdown(CARRUM_FOOTER);
    expect(s.parts_discount).toBe(157.71);
    expect(s.labour_discount).toBe(925);
  });

  it('resolveBillSummary with markdown sets labour_discount 925 over LLM 0', () => {
    const t = resolveBillSummary(base(), CARRUM_FOOTER);
    expect(t.labour_discount).toBe(925);
  });

  it('without markdown, recovers labour_discount when parts net alone matches grand', () => {
    const t = resolveBillSummary(base(), null);
    expect(t.labour_discount).toBe(925);
  });

  it('reconciliation matches after labour_discount recovered', () => {
    const data = base();
    data.totals_and_tax_summary = resolveBillSummary(data, CARRUM_FOOTER);
    const r = reconcileInvoiceTotal(data);
    expect(r.matched).toBe(true);
  });
});
