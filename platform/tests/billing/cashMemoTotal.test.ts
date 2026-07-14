import { describe, expect, it } from 'vitest';
import { extractCashMemoTotal } from '../../src/billing/footerExtract.js';
import { enrichParsedInvoice } from '../../src/billing/normalize.js';
import { computeReviewReasons } from '../../src/billing/reviewFlags.js';
import type { ParsedInvoiceData } from '../../src/parsing/types.js';

const AJAY_PAL_FOOTER =
  '|   | Received the above goods in good order & condition |  | TOTAL | 5700 |   |';

const AJAY_PAL_PARTS = [
  { item_name_description: 'Br Bamfor Ripab', taxable_amount: 400 },
  { item_name_description: 'Br Bamfor Paint', taxable_amount: 1200 },
  { item_name_description: '2-H.S Feindor Paint', taxable_amount: 300 },
  { item_name_description: '2-H.S Feindor Paint', taxable_amount: 1200 },
  { item_name_description: '2-H.S Quator Paired Paint', taxable_amount: 300 },
  { item_name_description: '2-H.S Quator Paired Paint', taxable_amount: 1200 },
  { item_name_description: 'Diggi Paint', taxable_amount: 300 },
  { item_name_description: 'Diggi Paint', taxable_amount: 1200 },
];

describe('extractCashMemoTotal', () => {
  it('reads printed TOTAL from handwritten cash memo table row', () => {
    expect(extractCashMemoTotal(AJAY_PAL_FOOTER)).toBe(5700);
  });

  it('ignores Sub Total rows', () => {
    expect(extractCashMemoTotal('| Sub Total | 6100 |')).toBeNull();
  });
});

describe('AJAY PAL bill totals', () => {
  it('keeps line items in parts and uses printed TOTAL 5700 not line sum 6100', () => {
    const data: ParsedInvoiceData = {
      company_name: 'AJAY PAL',
      parts_line_items: AJAY_PAL_PARTS,
      labour_service_line_items: [],
      totals_and_tax_summary: {},
    };

    const out = enrichParsedInvoice(data, AJAY_PAL_FOOTER);
    expect(out.parts_line_items).toHaveLength(8);
    expect(out.labour_service_line_items).toHaveLength(0);
    expect(out.totals_and_tax_summary?.parts_total).toBe(5700);
    expect(out.totals_and_tax_summary?.grand_total_invoice).toBe(5700);
  });

  it('flags line sum vs printed total mismatch for review', () => {
    const parsed: ParsedInvoiceData = {
      parts_line_items: AJAY_PAL_PARTS,
      labour_service_line_items: [],
      totals_and_tax_summary: { grand_total_invoice: 5700, parts_total: 5700 },
    };
    const reasons = computeReviewReasons(parsed);
    expect(reasons.some((r) => /verify amounts/i.test(r))).toBe(true);
  });
});
