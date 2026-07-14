import { describe, expect, it } from 'vitest';
import { extractSummaryFromMarkdown } from '../../src/billing/footerExtract.js';
import { resolveBillSummary } from '../../src/billing/billSummary.js';
import type { ParsedInvoiceData } from '../../src/parsing/types.js';

const VARUN_FOOTER = `
| Sub Total Amount | : | 18,859.51 | 0.00 | 16,001.68 |
| Less Discount on Parts & Labour | : | 2,751.59 | 0.00 | 2,160.42 |
| CGST @ 14% | : | 1,695.02 | | |
| SGST @ 14% | : | 1,695.02 | | |
| CGST @ 9% | : | 360.08 | | 1,245.71 |
| SGST @ 9% | : | 360.08 | | 1,245.71 |
| Sub Total Amount | : | 20,218.12 | 0.00 | 16,332.68 |

**Net Bill Amount (Rounded) : 36,551.00**
`.trim();

describe('extractSummaryFromMarkdown — Varun/Maruti mixed GST footer', () => {
  it('captures parts/labour subtotals and discounts from 3-column footer', () => {
    const s = extractSummaryFromMarkdown(VARUN_FOOTER);
    expect(s.parts_total).toBe(18859.51);
    expect(s.labour_total).toBe(16001.68);
    expect(s.parts_discount).toBe(2751.59);
    expect(s.labour_discount).toBe(2160.42);
    expect(s.grand_total_invoice).toBe(36551);
  });

  it('accumulates mixed CGST/SGST rates into gst_breakdown and side totals', () => {
    const s = extractSummaryFromMarkdown(VARUN_FOOTER);
    expect(s.parts_cgst_amount).toBeCloseTo(1695.02 + 360.08, 2);
    expect(s.parts_sgst_amount).toBeCloseTo(1695.02 + 360.08, 2);
    expect(s.labour_cgst_amount).toBeCloseTo(1245.71, 2);
    expect(s.labour_sgst_amount).toBeCloseTo(1245.71, 2);
    expect(s.gst_breakdown?.length).toBeGreaterThanOrEqual(4);
  });
});

describe('resolveBillSummary — Varun footer reconciles to net bill', () => {
  it('parts net + labour net equals grand total', () => {
    const data: ParsedInvoiceData = {
      parts_line_items: [{ taxable_amount: 18859.51 }],
      labour_service_line_items: [{ labour_charges: 16001.68 }],
      totals_and_tax_summary: {},
      confidence: 0.9,
    };
    const t = resolveBillSummary(data, VARUN_FOOTER);
    expect(t.grand_total_invoice).toBe(36551);
    expect(t.parts_total).toBe(18859.51);
    expect(t.labour_total).toBe(16001.68);
    expect(t.parts_discount).toBe(2751.59);
    expect(t.labour_discount).toBe(2160.42);
  });
});

const TYRESNMORE_FOOTER = `
|  1 | **PCR_BATTERY** | 85071000 | **1 BATTERY** | 3,555.00 |  | **3,012.71**  |
|   | **O-CGST (Karnataka)** |  |  |  |  | **271.14**  |
|   | **O-SGST (Karnataka)** |  |  |  |  | **271.14**  |
|   | **OLD Battery_Purchase** |  |  |  |  | **(-)850.00**  |

|  Total | **1 BATTERY** | **₹ 2,705.00**  |

|  HSN/SAC | Taxable Value | CGST |   | SGST/UTGST |   | Total Tax Amount  |
|  85071000 | 3,012.71 | 9% | 271.14 | 9% | 271.14 | 542.28  |
|  **Total** | **3,012.71** |  | **271.14** |  | **271.14** | **542.28**  |

**Net Bill Amount (Rounded) : 2,705.00**
`.trim();

describe('extractSummaryFromMarkdown — Tally TyresNMore O-CGST/O-SGST', () => {
  it('captures O-CGST and O-SGST from goods table rows', () => {
    const s = extractSummaryFromMarkdown(TYRESNMORE_FOOTER);
    expect(s.parts_cgst_amount).toBeCloseTo(271.14, 2);
    expect(s.parts_sgst_amount).toBeCloseTo(271.14, 2);
    expect(s.parts_cgst_rate).toBe(9);
    expect(s.parts_sgst_rate).toBe(9);
    expect(s.parts_total).toBeCloseTo(3012.71, 2);
    expect(s.deductibles).toBe(850);
    expect(s.grand_total_invoice).toBe(2705);
  });

  it('ignores Tally "Less : O-CGST" combined adjustment rows', () => {
    const md = `
Less : O-CGST (Maharashtra) 50.00 O-SGST (Maharashtra) 50.00
| O-CGST (Karnataka) | 271.14 |
| O-SGST (Karnataka) | 271.14 |
`;
    const s = extractSummaryFromMarkdown(md);
    expect(s.parts_cgst_amount).toBeCloseTo(271.14, 2);
    expect(s.parts_sgst_amount).toBeCloseTo(271.14, 2);
  });
});

describe('resolveBillSummary — TyresNMore battery invoice', () => {
  it('reconciles parts net with CGST/SGST to grand total after old battery credit', () => {
    const data: ParsedInvoiceData = {
      parts_line_items: [{ taxable_amount: 3012.71 }],
      labour_service_line_items: [],
      totals_and_tax_summary: {},
      confidence: 0.9,
    };
    const t = resolveBillSummary(data, TYRESNMORE_FOOTER);
    expect(t.parts_cgst_amount).toBeCloseTo(271.14, 2);
    expect(t.parts_sgst_amount).toBeCloseTo(271.14, 2);
    expect(t.grand_total_invoice).toBe(2705);
    expect(t.deductibles).toBe(850);
  });
});
