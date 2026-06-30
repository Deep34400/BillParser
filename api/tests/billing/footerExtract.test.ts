import { describe, it, expect } from 'vitest';
import { extractSummaryFromMarkdown, lastTwoAmounts, stripCalculatedFooterAmounts, applyFooterFromMarkdown, extractGatePassAmount } from '../../src/billing/footerExtract.js';
import type { TotalsAndTaxSummary } from '../../src/parsing/types.js';

const SAI_SERVICE_FOOTER = `
Sub Total Amount 2117.31 2140.00
Less Discount on Parts & Labour 325.63 1284.00
CGST @ 9% 161.26 77.04
SGST @ 9% 161.26 77.04
Sub Total Amount 2114.20 1010.08
Net Bill Amount (Rounded) 3124.00
`;

describe('footerExtract', () => {
  it('lastTwoAmounts picks parts and labour columns', () => {
    expect(lastTwoAmounts('Less Discount on Parts & Labour 325.63 1284.00')).toEqual([325.63, 1284]);
  });

  it('extracts discount, GST rates, amounts, and net bill from service invoice footer', () => {
    const r = extractSummaryFromMarkdown(SAI_SERVICE_FOOTER);
    expect(r.parts_total).toBe(2117.31);
    expect(r.labour_total).toBe(2140);
    expect(r.parts_discount).toBe(325.63);
    expect(r.labour_discount).toBe(1284);
    expect(r.parts_cgst_rate).toBe(9);
    expect(r.parts_cgst_amount).toBe(161.26);
    expect(r.labour_cgst_amount).toBe(77.04);
    expect(r.parts_sgst_rate).toBe(9);
    expect(r.parts_sgst_amount).toBe(161.26);
    expect(r.labour_sgst_amount).toBe(77.04);
    expect(r.grand_total_invoice).toBe(3124);
  });

  it('handles markdown pipe tables', () => {
    const md = '| Less Discount on Parts & Labour | 325.63 | 1284.00 |';
    expect(extractSummaryFromMarkdown(md).parts_discount).toBe(325.63);
  });

  it('handles 3-column Sai Service footer (Parts | 0 | Labour)', () => {
    const md = `
Sub Total Amount : 2,117.31 0.00 2,140.00
Less Discount on Parts & Labou : 325.63 0.00 1,284.00
CGST @ 9% : 161.26 77.04
SGST @ 9% : 161.26 77.04
Net Bill Amount (Rounded) : 3,124.00
`;
    const r = extractSummaryFromMarkdown(md);
    expect(r.parts_total).toBe(2117.31);
    expect(r.labour_total).toBe(2140);
    expect(r.parts_discount).toBe(325.63);
    expect(r.labour_discount).toBe(1284);
    expect(r.parts_cgst_amount).toBe(161.26);
    expect(r.labour_cgst_amount).toBe(77.04);
    expect(r.grand_total_invoice).toBe(3124);
  });

  it('handles Popular Vehicles pipe-table footer (1017.50, CGST@ 9 without %)', () => {
    const md = `
|  Sub Total : | 2215.25 | 2425.00  |
|  Less Discount | 398.75 | 1017.50  |
|  CGST@ 9 | 163.49 | 126.68  |
|  SGST@ 9 | 163.49 | 126.68  |
|  Sub Total | 2143.49 | 1660.86  |
Net Bill Amount (Rounded)
3804.00
`;
    const r = extractSummaryFromMarkdown(md);
    expect(r.parts_total).toBe(2215.25);
    expect(r.labour_total).toBe(2425);
    expect(r.parts_discount).toBe(398.75);
    expect(r.labour_discount).toBe(1017.5);
    expect(r.parts_cgst_rate).toBe(9);
    expect(r.parts_cgst_amount).toBe(163.49);
    expect(r.labour_cgst_amount).toBe(126.68);
    expect(r.parts_sgst_amount).toBe(163.49);
    expect(r.grand_total_invoice).toBe(3804);
  });

  it('handles Toyota Millennium pipe-table (parts only, labour zero)', () => {
    const md = `
|  Parts | 1,823.76 | 91.19 | 1,732.72 | 155.94 | 155.94  |
|  Labour | 0.00 | 0.00 | 0.00 | 0.00 | 0.00  |
Central GST for Parts @ 9% : 155.94
State GST for parts @ 9% : 155.94
Sub Total Amount: 1,823.76
Less Discount on Parts & Labour: 91.19
Net Bill Amount (Rounded): 2045.00
`;
    const r = extractSummaryFromMarkdown(md);
    expect(r.parts_total).toBe(1823.76);
    expect(r.parts_discount).toBe(91.19);
    expect(r.parts_cgst_amount).toBe(155.94);
    expect(r.parts_sgst_amount).toBe(155.94);
    expect(r.labour_total).toBe(0);
    expect(r.labour_discount).toBe(0);
    expect(r.grand_total_invoice).toBe(2045);
  });

  it('handles Toyota TXA25-07395 (parts + labour, charge table wins over combined supplement)', () => {
    const md = `
|   |  |  | Labour | 800.00 | 80.00 | 720.00 | 64.8 | 64.80 | 849.60  |
|   |  |  | Parts | 4,099.21 | 204.96 | 3,894.38 | 350.49 | 350.49 | 4,595.36  |
Central GST for Labour @ 9% : 64.80
State GST for Labour @ 9% : 64.80
Central GST for Parts @ 9% : 350.49
State GST for parts @ 9% : 350.49
Sub Total Amount: 4,614.38
Less Discount on Parts & Labour: 284.96
CGST @ 9%: 415.29
SGST @ 9%: 415.29
Net Bill Amount (Rounded): 5445.00
`;
    const r = extractSummaryFromMarkdown(md);
    expect(r.parts_total).toBe(4099.21);
    expect(r.labour_total).toBe(800);
    expect(r.parts_discount).toBe(204.96);
    expect(r.labour_discount).toBe(80);
    expect(r.parts_cgst_amount).toBe(350.49);
    expect(r.parts_sgst_amount).toBe(350.49);
    expect(r.labour_cgst_amount).toBe(64.8);
    expect(r.labour_sgst_amount).toBe(64.8);
    expect(r.grand_total_invoice).toBe(5445);
  });

  it('handles Sai Service pipe footer with two Sub Total rows (uses first gross row only)', () => {
    const md = `
|  Sub Total Amount | : | 1,407.19 | 0.00 | 1,975.00  |
|  Less Discount on Parts & Labour | : | 140.73 | 0.00 | 987.50  |
|  CGST @ 9% | : | 113.98 |  | 88.88  |
|  SGST @ 9% | : | 113.98 |  | 88.88  |
|  Sub Total Amount | : | 1,494.42 | 0.00 | 1,165.26  |
Net Bill Amount (Rounded) 2,660.00
`;
    const r = extractSummaryFromMarkdown(md);
    expect(r.parts_total).toBe(1407.19);
    expect(r.labour_total).toBe(1975);
    expect(r.parts_discount).toBe(140.73);
    expect(r.labour_discount).toBe(987.5);
    expect(r.grand_total_invoice).toBe(2660);
  });

  it('handles Fort Point Maruti — multiple IGST rates + special discount on labour', () => {
    const md = `
|  Sub Total Amount | : | 4,982.92 | 0.00 | 4,265.00  |
|  Less Discount on Parts & Labour | : | 498.30 | 0.00 | 2,045.00  |
|  Less Special Discount | : |  |  | 175.00  |
|  IGST @ 28% | : | 589.82 |  |   |
|  IGST @ 18% | : | 428.06 |  | 368.10  |
|  Sub Total Amount | : | 5,502.50 | 0.00 | 2,413.10  |
|  **Net Bill Amount (Rounded)** | **:** | **7,916.00**  |
`;
    const r = extractSummaryFromMarkdown(md);
    expect(r.parts_total).toBe(4982.92);
    expect(r.labour_total).toBe(4265);
    expect(r.parts_discount).toBe(498.3);
    expect(r.labour_discount).toBe(2045);
    expect(r.labour_special_discount).toBe(175);
    expect(r.parts_igst_amount).toBe(1017.88);
    expect(r.labour_igst_amount).toBe(368.1);
    expect(r.gst_breakdown).toHaveLength(2);
    expect(r.grand_total_invoice).toBe(7916);
  });

  it('strips LLM-calculated GST (9% of subtotal) so OCR footer can replace', () => {
    const bad: TotalsAndTaxSummary = {
      parts_total: 2117.31,
      labour_total: 2140,
      parts_discount: 325.63,
      labour_discount: 1284,
      parts_cgst_rate: 9,
      parts_cgst_amount: 190.56, // 9% of GROSS 2117.31 (LLM miscalc; real GST is 9% of taxable)
      parts_sgst_amount: 190.56,
      labour_cgst_amount: 192.6,
      labour_sgst_amount: 192.6,
    };
    stripCalculatedFooterAmounts(bad);
    expect(bad.parts_cgst_amount).toBeUndefined();
    const fixed = applyFooterFromMarkdown(bad, SAI_SERVICE_FOOTER);
    expect(fixed.parts_discount).toBe(325.63);
    expect(fixed.parts_cgst_amount).toBe(161.26);
    expect(fixed.grand_total_invoice).toBe(3124);
  });

  it('reads net bill from Gate Pass when summary table missing', () => {
    const gatePass = `
**Job Card No.** **Bill.No.** **Bill Date** **Amount**
JC25031803 BC/25031185 23-JAN-26 3,124.00
`;
    expect(extractGatePassAmount(gatePass)).toBe(3124);
    const bad: TotalsAndTaxSummary = {
      parts_total: 2117.31,
      labour_total: 2140,
      parts_discount: 0,
      labour_discount: 0,
      parts_cgst_amount: 190.56,
      parts_sgst_amount: 190.56,
      labour_cgst_amount: 192.6,
      labour_sgst_amount: 192.6,
      grand_total_invoice: 4624,
    };
    const fixed = applyFooterFromMarkdown(bad, gatePass);
    expect(fixed.grand_total_invoice).toBe(3124);
    expect(fixed.parts_discount).toBeUndefined();
    expect(fixed.parts_cgst_amount).toBeUndefined();
  });
});
