import { describe, expect, it } from 'vitest';
import {
  columnNet,
  fillMissingGstAmounts,
  resolveBillSummary,
} from '../../../src/ocr/transformer/normalize/totals.js';
import type { ParsedInvoiceData, TotalsAndTaxSummary } from '../../../src/ocr/types/invoice.js';

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
      parts_cgst_amount: 88.88,
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

/**
 * J.M.D. Auto Garage — Gemini single returns all GST footer null.
 * PDF: CGST 0 + SGST 0 + IGST 1,057.50. Mixed line rates (0% + 18%).
 * Parts = 1175×18% = 211.50; Labour = 4700×18% = 846.00.
 */
describe('resolveBillSummary — JMD Auto Garage IGST from line items', () => {
  function jmdInvoice(): ParsedInvoiceData {
    return {
      company_name: 'J. M. D. AUTO GARAGE',
      gstin: '27AZFPP2560C1ZJ',
      pan: 'AZFPP2560C',
      invoice_number: 'JMD/4183/25-26',
      invoice_date: '19/03/2026',
      parts_line_items: [
        { item_name_description: 'REAR BUMPER PAINTING', taxable_amount: 1000, tax_percentage: 18 },
        { item_name_description: 'REAR BUMPER REPAIRING BRACKET REPAIRING', taxable_amount: 175, tax_percentage: 18 },
        { item_name_description: 'PETROL', taxable_amount: 200, tax_percentage: 0 },
      ],
      labour_service_line_items: [
        { labour_description: 'FRONT BUMPER DAINTING & PAINTING', labour_charges: 1000, tax_percentage: 18 },
        { labour_description: 'RHS FENDER REPAIRING', labour_charges: 250, tax_percentage: 18 },
        { labour_description: 'R.H.S FENDER PAINTING', labour_charges: 1000, tax_percentage: 18 },
        { labour_description: 'L.H.S QUARTER PANEL REPAIR', labour_charges: 450, tax_percentage: 0 },
        { labour_description: 'L.H.S QUARTER PANEL PAINTING', labour_charges: 1000, tax_percentage: 18 },
        { labour_description: 'RHS REAR DOOR REPAIR', labour_charges: 450, tax_percentage: 18 },
        { labour_description: 'RHS REAR DOOR PANTING', labour_charges: 1000, tax_percentage: 18 },
      ],
      totals_and_tax_summary: {
        parts_total: 1375,
        labour_total: 5150,
        parts_discount: 0,
        labour_discount: 0,
        parts_cgst_rate: null,
        parts_sgst_rate: null,
        parts_igst_rate: null,
        parts_cgst_amount: null,
        parts_sgst_amount: null,
        parts_igst_amount: null,
        labour_cgst_rate: null,
        labour_sgst_rate: null,
        labour_igst_rate: null,
        labour_cgst_amount: null,
        labour_sgst_amount: null,
        labour_igst_amount: null,
        sub_total_calculated: 6525,
        grand_total_invoice: 7583,
      },
      confidence: 0.95,
    };
  }

  it('fills IGST from line items when all GST footer fields are null (no markdown)', () => {
    const t = resolveBillSummary(jmdInvoice(), '');
    expect(t.parts_igst_amount).toBeCloseTo(211.5, 2);
    expect(t.labour_igst_amount).toBeCloseTo(846, 2);
    expect(t.parts_igst_rate).toBe(18);
    expect(t.labour_igst_rate).toBe(18);
    expect(t.parts_cgst_amount ?? 0).toBe(0);
    expect(t.parts_sgst_amount ?? 0).toBe(0);
    expect(t.labour_cgst_amount ?? 0).toBe(0);
    expect(t.labour_sgst_amount ?? 0).toBe(0);
  });

  it('fills IGST when markdown shows Add : IGST', () => {
    const md = `
Total Amt. Before Tax 6,525.00
Add : CGST 0.00
Add : SGST 0.00
Add : IGST 1,057.50
Tax Amt. : GST 1,057.50
Total Amt. After Tax 7,583.00
Buyer GSTIN : 06AALCC8489R1ZH
Our GSTIN : 27AZFPP2560C1ZJ
`;
    const t = resolveBillSummary(jmdInvoice(), md);
    const totalIgst = (t.parts_igst_amount ?? 0) + (t.labour_igst_amount ?? 0);
    expect(totalIgst).toBeCloseTo(1057.5, 1);
    expect((t.parts_cgst_amount ?? 0) + (t.labour_cgst_amount ?? 0)).toBe(0);
  });
});

/**
 * JMD/1540/26-27 — same garage, but intra-state (buyer + seller state 27).
 * Printed footer: CGST 995.34 + SGST 995.34 + IGST 0.
 * LLM wrongly parks tax in IGST; must reclassify to CGST+SGST without breaking IGST bills.
 */
describe('resolveBillSummary — JMD intra-state CGST/SGST (not IGST)', () => {
  function jmdIntraState(): ParsedInvoiceData {
    return {
      company_name: 'J. M. D. AUTO GARAGE',
      gstin: '27AZFPP2560C1ZJ',
      pan: 'AZFPP2560C',
      invoice_number: 'JMD/1540/26-27',
      invoice_date: '20/08/2026',
      parts_line_items: [
        { item_name_description: 'FRONT BUMPER SERVICEABLE', taxable_amount: 1000, tax_percentage: 18 },
        { item_name_description: 'L.H.S HEAD LIGHT NEW', taxable_amount: 2309.32, tax_percentage: 18 },
        { item_name_description: 'FULE', taxable_amount: 200, tax_percentage: 0 },
      ],
      labour_service_line_items: [
        { labour_description: 'FRONT BUMPER SERVICEABLE', labour_charges: 200, tax_percentage: 18 },
        { labour_description: 'FRONT BUMPER PAINTING', labour_charges: 1000, tax_percentage: 18 },
        { labour_description: 'L.H.S FENDER PAINTING', labour_charges: 1000, tax_percentage: 18 },
        { labour_description: 'DICKEY PAINTING', labour_charges: 1000, tax_percentage: 18 },
        { labour_description: 'DICKEY REPAIRING', labour_charges: 400, tax_percentage: 18 },
        { labour_description: 'OTHER LABOUR', labour_charges: 4150, tax_percentage: 18 },
      ],
      totals_and_tax_summary: {
        parts_total: 3509.32,
        labour_total: 7750,
        parts_discount: 0,
        labour_discount: 0,
        // LLM wrongly filled IGST (same total as CGST+SGST)
        parts_cgst_rate: null,
        parts_sgst_rate: null,
        parts_igst_rate: 18,
        labour_cgst_rate: null,
        labour_sgst_rate: null,
        labour_igst_rate: 18,
        parts_cgst_amount: null,
        parts_sgst_amount: null,
        parts_igst_amount: 595.68,
        labour_cgst_amount: null,
        labour_sgst_amount: null,
        labour_igst_amount: 1395,
        grand_total_invoice: 13250,
      },
      confidence: 0.95,
    };
  }

  const INTRA_MD = `
Total Amt. Before Tax 11,259.32
Add : CGST 995.34
Add : SGST 995.34
Add : IGST 0.00
Tax Amt. : 1,990.68
Total Invoice Amount 13,250.00
Buyer GSTIN : 27AALCC8489R1ZD
Our GSTIN : 27AZFPP2560C1ZJ
`;

  it('reclassifies LLM IGST → CGST+SGST when footer shows Add : CGST/SGST and IGST 0', () => {
    const t = resolveBillSummary(jmdIntraState(), INTRA_MD);
    expect((t.parts_igst_amount ?? 0) + (t.labour_igst_amount ?? 0)).toBe(0);
    expect(t.parts_igst_rate ?? 0).toBe(0);
    expect(t.labour_igst_rate ?? 0).toBe(0);
    const cgst = (t.parts_cgst_amount ?? 0) + (t.labour_cgst_amount ?? 0);
    const sgst = (t.parts_sgst_amount ?? 0) + (t.labour_sgst_amount ?? 0);
    expect(cgst).toBeCloseTo(995.34, 1);
    expect(sgst).toBeCloseTo(995.34, 1);
    expect(t.parts_cgst_rate).toBe(9);
    expect(t.parts_sgst_rate).toBe(9);
  });

  it('fills CGST/SGST from line items when footer is CGST and amounts were null', () => {
    const data = jmdIntraState();
    data.totals_and_tax_summary = {
      ...data.totals_and_tax_summary!,
      parts_igst_rate: null,
      labour_igst_rate: null,
      parts_igst_amount: null,
      labour_igst_amount: null,
    };
    const t = resolveBillSummary(data, INTRA_MD);
    expect((t.parts_igst_amount ?? 0) + (t.labour_igst_amount ?? 0)).toBe(0);
    expect((t.parts_cgst_amount ?? 0) + (t.labour_cgst_amount ?? 0)).toBeGreaterThan(0);
    expect((t.parts_sgst_amount ?? 0) + (t.labour_sgst_amount ?? 0)).toBeGreaterThan(0);
  });
});

/**
 * JSB Mobility / Chevrolet-style: LLM returns labour_total already post-discount
 * (lineSum − discount) plus the same discount again. GST is correctly on the
 * post-discount taxable. UI must not subtract discount twice.
 */
describe('resolveBillSummary — post-discount labour_total (JSB Mobility)', () => {
  function jsbInvoice(): ParsedInvoiceData {
    return {
      company_name: 'JSB MOBILITY PVT LTD',
      gstin: '07AAGCJ6656E1ZF',
      invoice_number: 'DW21S26100348',
      parts_line_items: [
        { item_name_description: 'Hydraulic Brake Fluid 0.25L', taxable_amount: 467.8, tax_percentage: 18 },
        { item_name_description: 'Solvent-Wdo Clnr', taxable_amount: 101.69, tax_percentage: 18 },
        { item_name_description: 'FILTER-POLLEN', taxable_amount: 423.73, tax_percentage: 18 },
        { item_name_description: 'BLADE ASM-WSW', taxable_amount: 295.76, tax_percentage: 18 },
        { item_name_description: 'PAD ASM-FRT BRK SYS', taxable_amount: 9916.1, tax_percentage: 18 },
        { item_name_description: 'BLADE ASM-R/WDO WPR', taxable_amount: 535.59, tax_percentage: 18 },
        { item_name_description: 'BLADE ASM-WSW', taxable_amount: 351.69, tax_percentage: 18 },
        { item_name_description: 'Engine Coolant 5 L', taxable_amount: 1449.15, tax_percentage: 18 },
      ],
      labour_service_line_items: [
        { labour_description: 'Paid Service/60000 KM EV', labour_charges: 2700, tax_percentage: 18 },
        { labour_description: 'Front brake pads - set - renew', labour_charges: 962.5, tax_percentage: 18 },
      ],
      totals_and_tax_summary: {
        parts_total: 13541.51,
        labour_total: 3566.25, // already = 3662.50 − 96.25
        parts_discount: 0,
        labour_discount: 96.25,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        parts_cgst_amount: 1218.73,
        parts_sgst_amount: 1218.73,
        labour_cgst_rate: 9,
        labour_sgst_rate: 9,
        labour_cgst_amount: 320.96, // 9% of 3566.25 (correct Style A)
        labour_sgst_amount: 320.96,
        grand_total_invoice: 20187.14,
      },
      confidence: 0.95,
    };
  }

  it('restores pre-discount labour_total and keeps GST; labour net + parts net = grand total', () => {
    const t = resolveBillSummary(jsbInvoice());
    expect(t.labour_total).toBeCloseTo(3662.5, 2);
    expect(t.labour_discount).toBeCloseTo(96.25, 2);
    expect(t.labour_cgst_amount).toBeCloseTo(320.96, 2);
    expect(t.labour_sgst_amount).toBeCloseTo(320.96, 2);
    expect(columnNet(t, 'labour')).toBeCloseTo(4208.17, 2);
    expect(columnNet(t, 'parts')).toBeCloseTo(15978.97, 2);
    const netSum = (columnNet(t, 'parts') ?? 0) + (columnNet(t, 'labour') ?? 0);
    expect(netSum).toBeCloseTo(20187.14, 1);
  });
});

/**
 * Popular Vehicles Service Estimate — GST only on labour (SGST+CGST 360).
 * Parts Tax Paid = 0. LLM wrongly fills parts 9%+9%. Clear parts GST.
 */
describe('resolveBillSummary — GST only on labour (Popular Vehicles estimate)', () => {
  function popularEstimate(): ParsedInvoiceData {
    return {
      company_name: 'POPULAR VEHICLES & SERVICES LTD.',
      invoice_number: 'ES26000512',
      parts_line_items: [
        { quantity: 1, rate: 12, taxable_amount: 12 },
        { quantity: 2.8, rate: 540, taxable_amount: 1512 },
      ],
      labour_service_line_items: [
        { labour_charges: 2000 },
      ],
      totals_and_tax_summary: {
        parts_total: 2792,
        labour_total: 2000,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        labour_cgst_rate: 9,
        labour_sgst_rate: 9,
        parts_cgst_amount: 251.28,
        parts_sgst_amount: 251.28,
        labour_cgst_amount: 180,
        labour_sgst_amount: 180,
        grand_total_invoice: 5152,
      },
      confidence: 0.9,
    };
  }

  it('clears spurious parts CGST/SGST when grand matches without parts tax', () => {
    const t = resolveBillSummary(popularEstimate());
    expect((t.parts_cgst_amount ?? 0) + (t.parts_sgst_amount ?? 0)).toBe(0);
    expect(t.parts_cgst_rate ?? 0).toBe(0);
    expect(t.parts_sgst_rate ?? 0).toBe(0);
    expect(t.labour_cgst_amount).toBeCloseTo(180, 1);
    expect(t.labour_sgst_amount).toBeCloseTo(180, 1);
    const net = (columnNet(t, 'parts') ?? 0) + (columnNet(t, 'labour') ?? 0);
    expect(net).toBeCloseTo(5152, 1);
  });

  it('keeps parts rates null after second resolveBillSummary (enrich double-pass)', () => {
    const first = resolveBillSummary(popularEstimate());
    const second = resolveBillSummary({
      ...popularEstimate(),
      totals_and_tax_summary: first,
    });
    expect(second.parts_cgst_amount).toBe(0);
    expect(second.parts_sgst_amount).toBe(0);
    expect(second.parts_cgst_rate ?? 0).toBe(0);
    expect(second.parts_sgst_rate ?? 0).toBe(0);
    expect(second.labour_cgst_rate).toBe(9);
  });
});
