import { describe, it, expect } from 'vitest';
import { extractSummaryFromMarkdown } from '../../src/billing/footerExtract.js';
import { enrichParsedInvoice } from '../../src/billing/normalize.js';
import { columnNet, resolveBillSummary } from '../../src/billing/billSummary.js';
import type { TotalsAndTaxSummary } from '../../src/parsing/types.js';

/** Regression suite — every supported dealer format must keep passing together. */
describe('bill summary — all dealer formats', () => {
  const formats = {
    saiService: `
Sub Total Amount : 2,117.31 0.00 2,140.00
Less Discount on Parts & Labou : 325.63 0.00 1,284.00
CGST @ 9% : 161.26 77.04
SGST @ 9% : 161.26 77.04
Net Bill Amount (Rounded) : 3,124.00`,

    popularVehicles: `
|  Sub Total : | 2215.25 | 2425.00  |
|  Less Discount | 398.75 | 1017.50  |
|  CGST@ 9 | 163.49 | 126.68  |
|  SGST@ 9 | 163.49 | 126.68  |
Net Bill Amount (Rounded)
3804.00`,

    toyotaPartsOnly: `
|  Parts | 1,823.76 | 91.19 | 1,732.72 | 155.94 | 155.94  |
|  Labour | 0.00 | 0.00 | 0.00 | 0.00 | 0.00  |
Sub Total Amount: 4,614.38
Less Discount on Parts & Labour: 91.19
CGST @ 9%: 155.94
Net Bill Amount (Rounded): 2045.00`,

    toyotaPartsLabour: `
|   |  |  | Labour | 800.00 | 80.00 | 720.00 | 64.8 | 64.80 | 849.60  |
|   |  |  | Parts | 4,099.21 | 204.96 | 3,894.38 | 350.49 | 350.49 | 4,595.36  |
Sub Total Amount: 4,614.38
Less Discount on Parts & Labour: 284.96
CGST @ 9%: 415.29
SGST @ 9%: 415.29
Net Bill Amount (Rounded): 5445.00`,

    fortPointMaruti: `
|  Sub Total Amount | : | 4,982.92 | 0.00 | 4,265.00  |
|  Less Discount on Parts & Labour | : | 498.30 | 0.00 | 2,045.00  |
|  Less Special Discount | : |  |  | 175.00  |
|  IGST @ 28% | : | 589.82 |  |   |
|  IGST @ 18% | : | 428.06 |  | 368.10  |
|  Sub Total Amount | : | 5,502.50 | 0.00 | 2,413.10  |
|  **Net Bill Amount (Rounded)** | **:** | **7,916.00**  |`,

    classicMotorsAutorox: `
|  # | Service | Description | HSN / SAC | GST Rate (%) | Quantity | Unit Price | Taxable | Labour Total  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  1 | FRONT BUMPER REPAIR | Labour | 998714 | 18 | 1.00 | 400.00 | 400.00 | 472.00  |
|  5 | REAR BUMPER REPAIR & PAINT | Labour | 998714 | 18 | 1.00 | 1,250.00 | 1,250.00 | 1,475.00  |
|  **Parts Total** | **₹ 0.00**  |
|  **Labour Total** | **₹ 4,400.00**  |
|  **Grand Total** | **₹ 5,192.00**  |

## Bill Summary
Sub Total Amount (parts): ₹ 0.00
Sub Total Amount (labour): ₹ 4,400.00
Less Discount: ₹ 0.00
CGST @ 9% : ₹ 396.00
SGST @ 9% : ₹ 396.00
Net Bill Amount: ₹ 5,192.00`,

    tyresnmoreTally: `
|  1 | PCR_TYRE_JK_155/80 R13 | 40111010 | 5 TYRES |  | 14,194.90  |
|   | Less : O-CGST (Maharashtra) O-SGST (Maharashtra) TYRE EXCHANGE FESTIVAL Short & Excess |  |  |  | 1,277.54 1,277.54 (-)350.00 0.02  |

## Bill Summary
| Parts | 14,194.90 | 0.00 | 14,194.90 | 1,277.54 | 1,277.54 | 16,749.98 |
Central GST for Parts @ 9% : 1,277.54
State GST for Parts @ 9% : 1,277.54
Sub Total Amount (parts): 14,194.90
Less Discount: 350.00
CGST @ 9%: 1,277.54
SGST @ 9%: 1,277.54
Net Bill Amount: 16,400.00`,

    shawToyota: `
Central GST for Service @ 9% : 1,531.52
State GST for Service @ 9% : 1,531.52
Central GST for Parts @ 9% : 3,195.72
State GST for parts @ 9% : 3,195.72

## Bill Summary
| Labour | 17,688.00 | 671.12 | 17,016.88 | 1531.52 | 1531.52 | 20,079.92 |
| Parts | 35,507.98 | 0.00 | 35,507.98 | 3195.72 | 3195.72 | 41,899.42 |
Central GST for Service @ 9%: 1,531.52
State GST for Service @ 9%: 1,531.52
Central GST for Parts @9%: 3,195.72
State GST for parts @9%: 3,195.72
Sub Total Amount: 53,195.98
Less Discount: 671.12
CGST @ 9%: 4727.24
SGST @ 9%: 4727.24
Rounding: -0.34
Net Bill Amount: 61979.0`,

    akanshaGlass: `
|   | Output IGST @ 18% |  |  | 18 | % |  | 748.08  |
| 70072190 | 3,556.00 | 18% | 640.08 | 640.08  |
| 35069999 | 300.00 | 18% | 54.00 | 54.00  |
| 998729 | 300.00 | 18% | 54.00 | 54.00  |

## Bill Summary
| Labour | 300.00 | 0 | 300.00 | 0 | 0 | 354.00 |
| Parts | 3856.00 | 0 | 3856.00 | 0 | 0 | 4550.08 |
IGST for Parts @ 18% : 694.08
IGST for Labour @ 18% : 54.00
Sub Total Amount (parts | labour): 3856.00 | 300.00
Less Discount: 0
CGST @ %: 0
SGST @ %: 0
Net Bill Amount: 4904.08`,

    // Toyota/Tally bills print "Integrated GST" (not "IGST") and repeat the GST lines verbatim
    // in the body and again in "## Bill Summary" — must be recognized once, not double-counted.
    capitalIntegratedDuplicated: `
Integrated GST For Labour @ 18% : 9.89
Integrated GST for Parts @ 18% : 51.56

## Bill Summary
| Labour | 84.50 | 29.58 | 54.92 | 0.00 | 0.00 | 64.81 |
| Parts | 308.00 | 21.56 | 286.44 | 0.00 | 0.00 | 338.00 |
Integrated GST For Labour @ 18%: 9.89
Integrated GST for Parts @ 18% : 51.56
Sub Total Amount (labour): 84.50
Sub Total Amount (parts): 308.00
Less Discount: 51.14
Net Bill Amount: 403.00`,

    // "Integrated GST for Parts/Labour" per-side split must win over the combined "Output IGST" total.
    akanshaIntegratedSplit: `
|   | Output IGST @ 18% |  |  | 18 | % |  | 1,206.00  |

## Bill Summary
| Labour | 300.00 | 0.00 | 300.00 | 0.00 | 0.00 | 354.00 |
| Parts | 6400.00 | 0.00 | 6400.00 | 0.00 | 0.00 | 7552.00 |
Integrated GST for Parts @ 18% : 1,152.00
Integrated GST for Labour @ 18% : 54.00
Sub Total Amount (parts): 6,400.00
Sub Total Amount (labour): 300.00
Less Discount: 0.00
Net Bill Amount: 7,906.00`,

    // Autoverse (Zoho): "Sub Total (Tax Inclusive)" is the GRAND total, not the base. The real
    // taxable base is the standalone "Total Taxable Amount" line; bill is single-column (parts).
    autoverseTaxInclusive: `
Sub Total (Tax Inclusive) | 17,500.00
Total Taxable Amount | 14,830.50
CGST9 (9%) | 1,334.75
SGST9 (9%) | 1,334.75
Total | Rs.17,500.00`,

    // SN Battery: the "SUBTOTAL | 15 | 5,605.93 | 36,750" row is qty/rate/total (misleading); the
    // real base is the standalone "Taxable Amount" line. Single-column (parts) bill.
    snBatteryTaxable: `
| SUBTOTAL | 15 | ₹ 5,605.93 | ₹ 36,750 |
| Taxable Amount | ₹ 31,144.07 |
| CGST @9% | ₹ 2,802.97 |
| SGST @9% | ₹ 2,802.97 |
| Total Amount | ₹ 36,750 |`,

    // SAI inv_59: the dealer GSTIN (…4998…) is OCR'd onto the same line as the Sub Total row.
    // A 4-digit run embedded in the GSTIN must NOT be read as the parts subtotal (4,846.12 is).
    saiGstinOnSubtotalLine: `
For SAI SERVICE PRIVATE LIMITED Authorised Signatory Dealer GSTIN : 36AABCS4998M1ZK Sub Total Amount : 4,846.12 0.00 4,954.93
Less Discount on Parts & Labour : 484.62 0.00 2,277.47
CGST @ 9% : 392.55 240.97
SGST @ 9% : 392.55 240.97
Net Bill Amount (Rounded) : 8,306.00`,

    // Amit Global: the SAME combined IGST total (1,098.31) is printed on two textually-different
    // lines (goods table "IGST@18% Rounding Off" + bill-summary "IGST @ 18%:") — must apply once.
    amitGlobalDoubledIgst: `
|   | IGST@18% Rounding Off(+/-) |  |  | 18 | % |  | 1,098.31 (-)0.04  |
Sub Total Amount: 6,101.73
Less Discount: 0.00
IGST @ 18%: 1,098.31
Net Bill Amount: 7,200.00`,
  };

  it('Sai Service — 3-column footer', () => {
    const r = extractSummaryFromMarkdown(formats.saiService);
    expect(r).toMatchObject({
      parts_total: 2117.31, labour_total: 2140,
      parts_discount: 325.63, labour_discount: 1284,
      grand_total_invoice: 3124,
    });
  });

  it('Popular Vehicles — pipe two-column footer', () => {
    const r = extractSummaryFromMarkdown(formats.popularVehicles);
    expect(r).toMatchObject({
      parts_total: 2215.25, labour_total: 2425,
      parts_discount: 398.75, labour_discount: 1017.5,
      grand_total_invoice: 3804,
    });
  });

  it('Toyota parts-only — charge table beats combined supplement', () => {
    const r = extractSummaryFromMarkdown(formats.toyotaPartsOnly);
    expect(r.parts_total).toBe(1823.76);
    expect(r.parts_discount).toBe(91.19);
    expect(r.labour_total).toBe(0);
  });

  it('Sai Service pipe footer — first Sub Total row is gross', () => {
    const md = `
|  Sub Total Amount | : | 1,407.19 | 0.00 | 1,975.00  |
|  Less Discount | : | 140.73 | 0.00 | 987.50  |
|  CGST @ 9% | : | 113.98 |  | 88.88  |
|  Sub Total Amount | : | 1,494.42 | 0.00 | 1,165.26  |
Net Bill Amount (Rounded) 2,660.00`;
    const r = extractSummaryFromMarkdown(md);
    expect(r.parts_total).toBe(1407.19);
    expect(r.labour_total).toBe(1975);
  });

  it('Toyota parts+labour — charge table beats combined supplement', () => {
    const r = extractSummaryFromMarkdown(formats.toyotaPartsLabour);
    expect(r).toMatchObject({
      parts_total: 4099.21, labour_total: 800,
      parts_discount: 204.96, labour_discount: 80,
      parts_cgst_amount: 350.49, labour_cgst_amount: 64.8,
      grand_total_invoice: 5445,
    });
  });

  it('Fort Point Maruti — multiple IGST rates + special discount on labour', () => {
    const r = extractSummaryFromMarkdown(formats.fortPointMaruti);
    expect(r).toMatchObject({
      parts_total: 4982.92, labour_total: 4265,
      parts_discount: 498.3, labour_discount: 2045,
      labour_special_discount: 175,
      parts_igst_amount: 1017.88, labour_igst_amount: 368.1,
      grand_total_invoice: 7916,
    });
    expect(r.gst_breakdown).toHaveLength(2);
    const partsNet = columnNet(r as TotalsAndTaxSummary, 'parts');
    const labourNet = columnNet(r as TotalsAndTaxSummary, 'labour');
    expect(partsNet).toBe(5502.5);
    expect(labourNet).toBe(2413.1);
    expect(Math.abs((partsNet ?? 0) + (labourNet ?? 0) - 7916)).toBeLessThanOrEqual(1);
  });

  it('Classic Motors (Autorox) — labour-only, ignores "Labour" description column', () => {
    const r = extractSummaryFromMarkdown(formats.classicMotorsAutorox);
    expect(r.parts_total).toBe(0);
    expect(r.labour_total).toBe(4400);
    expect(r.labour_cgst_amount).toBe(396);
    expect(r.labour_sgst_amount).toBe(396);
    expect(r.grand_total_invoice).toBe(5192);
    const partsNet = columnNet(r as TotalsAndTaxSummary, 'parts');
    const labourNet = columnNet(r as TotalsAndTaxSummary, 'labour');
    expect(partsNet).toBe(0);
    expect(labourNet).toBe(5192);
  });

  it('TYRESNMORE (Tally) — ignores "Less : O-CGST" goods row, keeps printed discount, no double GST', () => {
    const r = extractSummaryFromMarkdown(formats.tyresnmoreTally);
    expect(r.parts_total).toBe(14194.9);
    expect(r.parts_discount).toBe(350);
    expect(r.parts_cgst_amount).toBe(1277.54);
    expect(r.parts_sgst_amount).toBe(1277.54);
    expect(r.gst_breakdown).toHaveLength(2);
    expect(r.grand_total_invoice).toBe(16400);
    expect(Math.abs((columnNet(r as TotalsAndTaxSummary, 'parts') ?? 0) - 16400)).toBeLessThanOrEqual(1);
  });

  it('Shaw Toyota — "Service" GST maps to labour, parts discount stays 0, both GST columns shown', () => {
    const r = extractSummaryFromMarkdown(formats.shawToyota);
    expect(r.parts_total).toBe(35507.98);
    expect(r.labour_total).toBe(17688);
    expect(r.parts_discount).toBe(0);
    expect(r.labour_discount).toBe(671.12);
    expect(r.parts_cgst_amount).toBe(3195.72);
    expect(r.labour_cgst_amount).toBe(1531.52);
    expect(r.gst_breakdown).toHaveLength(2);
    expect(r.gst_breakdown![0].parts).toBe(3195.72);
    expect(r.gst_breakdown![0].labour).toBe(1531.52);
    const net = (columnNet(r as TotalsAndTaxSummary, 'parts') ?? 0) + (columnNet(r as TotalsAndTaxSummary, 'labour') ?? 0);
    expect(Math.round(net)).toBe(61979);
  });

  it('Akansha Glass — inter-state IGST split (charge row with bare 0), no phantom discount', () => {
    const r = extractSummaryFromMarkdown(formats.akanshaGlass);
    expect(r.parts_total).toBe(3856);
    expect(r.labour_total).toBe(300);
    expect(r.parts_discount).toBe(0);
    expect(r.labour_discount).toBe(0);
    expect(r.parts_igst_amount).toBe(694.08);
    expect(r.labour_igst_amount).toBe(54);
    expect(r.gst_breakdown).toHaveLength(1);
    expect(r.gst_breakdown![0].kind).toBe('IGST');
    expect(r.gst_breakdown![0].parts).toBe(694.08);
    expect(r.gst_breakdown![0].labour).toBe(54);
    const net = (columnNet(r as TotalsAndTaxSummary, 'parts') ?? 0) + (columnNet(r as TotalsAndTaxSummary, 'labour') ?? 0);
    expect(Math.round(net)).toBe(4904);
  });

  it('Capital (Integrated GST, duplicated lines) — recognized once, never double-counted', () => {
    const r = extractSummaryFromMarkdown(formats.capitalIntegratedDuplicated);
    expect(r.parts_igst_amount).toBe(51.56);
    expect(r.labour_igst_amount).toBe(9.89);
    const partsNet = columnNet(r as TotalsAndTaxSummary, 'parts');
    const labourNet = columnNet(r as TotalsAndTaxSummary, 'labour');
    expect(partsNet).toBe(338);
    expect(labourNet).toBe(64.81);
    expect(Math.abs((partsNet ?? 0) + (labourNet ?? 0) - 403)).toBeLessThanOrEqual(1);
  });

  it('Akansha (Integrated GST for Parts/Labour) — per-side split beats combined Output IGST total', () => {
    const r = extractSummaryFromMarkdown(formats.akanshaIntegratedSplit);
    expect(r.parts_igst_amount).toBe(1152);
    expect(r.labour_igst_amount).toBe(54);
    const net = (columnNet(r as TotalsAndTaxSummary, 'parts') ?? 0) + (columnNet(r as TotalsAndTaxSummary, 'labour') ?? 0);
    expect(Math.round(net)).toBe(7906);
  });

  it('reconcileSideGst — zero-subtotal side carries no GST, IGST excludes CGST/SGST', () => {
    const data = {
      totals_and_tax_summary: {
        parts_total: 0, labour_total: 2000,
        parts_igst_amount: 360, labour_igst_amount: 360,
        labour_cgst_amount: 99, labour_sgst_amount: 99,
        grand_total_invoice: 2360,
      },
    };
    const t = resolveBillSummary(data);
    expect(t.parts_igst_amount).toBe(0);
    expect(t.labour_igst_amount).toBe(360);
    expect(t.labour_cgst_amount ?? null).toBeNull();
    expect(t.labour_sgst_amount ?? null).toBeNull();
    const net = (columnNet(t, 'parts') ?? 0) + (columnNet(t, 'labour') ?? 0);
    expect(net).toBe(2360);
  });

  it('Autoverse (Zoho) — "Tax Inclusive" sub total ignored, "Total Taxable Amount" is the base', () => {
    const r = extractSummaryFromMarkdown(formats.autoverseTaxInclusive);
    expect(r.parts_total).toBe(14830.5);
    expect(r.labour_total).toBe(0);
    expect(r.parts_cgst_amount).toBe(1334.75);
    expect(r.parts_sgst_amount).toBe(1334.75);
    const net = (columnNet(r as TotalsAndTaxSummary, 'parts') ?? 0) + (columnNet(r as TotalsAndTaxSummary, 'labour') ?? 0);
    expect(Math.abs(net - 17500)).toBeLessThanOrEqual(1);
  });

  it('SN Battery — misleading SUBTOTAL row ignored, standalone Taxable Amount is the base', () => {
    const r = extractSummaryFromMarkdown(formats.snBatteryTaxable);
    expect(r.parts_total).toBe(31144.07);
    expect(r.labour_total).toBe(0);
    expect(r.parts_cgst_amount).toBe(2802.97);
    expect(r.parts_sgst_amount).toBe(2802.97);
    const net = (columnNet(r as TotalsAndTaxSummary, 'parts') ?? 0) + (columnNet(r as TotalsAndTaxSummary, 'labour') ?? 0);
    expect(Math.abs(net - 36750)).toBeLessThanOrEqual(1);
  });

  it('SAI inv_59 — GSTIN digits on the Sub Total line are not read as an amount', () => {
    const r = extractSummaryFromMarkdown(formats.saiGstinOnSubtotalLine);
    expect(r.parts_total).toBe(4846.12);
    expect(r.labour_total).toBe(4954.93);
    const net = (columnNet(r as TotalsAndTaxSummary, 'parts') ?? 0) + (columnNet(r as TotalsAndTaxSummary, 'labour') ?? 0);
    expect(Math.abs(net - 8306)).toBeLessThanOrEqual(1);
  });

  it('Amit Global — same combined IGST printed twice (different text) applied once', () => {
    const r = extractSummaryFromMarkdown(formats.amitGlobalDoubledIgst);
    expect(r.parts_total).toBe(6101.73);
    expect(r.parts_igst_amount).toBe(1098.31);
    const t = resolveBillSummary({ totals_and_tax_summary: r as TotalsAndTaxSummary }, formats.amitGlobalDoubledIgst);
    const net = (columnNet(t, 'parts') ?? 0) + (columnNet(t, 'labour') ?? 0);
    expect(Math.abs(net - 7200)).toBeLessThanOrEqual(1);
  });

  it('Vectrio — single-column service bill: column lands on Labour (matching items), not duplicated', () => {
    const data = {
      parts_line_items: [],
      labour_service_line_items: [{ labour_charges: 5000, tax_percentage: 18, labour_description: 'SERVICE' }],
      totals_and_tax_summary: {
        parts_total: 5000, labour_total: 5000,
        labour_igst_rate: 18, labour_igst_amount: 900,
        grand_total_invoice: 5900,
      },
    };
    const md = `
Sub Total | 5,000.00
IGST18 (18%) | 900.00
Total | Rs.5,900.00`;
    const t = resolveBillSummary(data, md);
    expect(t.parts_total).toBe(0);
    expect(t.labour_total).toBe(5000);
    expect(t.labour_igst_amount).toBe(900);
    const net = (columnNet(t, 'parts') ?? 0) + (columnNet(t, 'labour') ?? 0);
    expect(Math.abs(net - 5900)).toBeLessThanOrEqual(1);
  });

  it('SLV Motors — single-column all-labour bill lands on Labour (not Parts), no double-count', () => {
    const data = {
      parts_line_items: [],
      labour_service_line_items: [
        { labour_charges: 300, tax_percentage: 18, labour_description: 'RH & LH leg Repair' },
        { labour_charges: 200, tax_percentage: 18, labour_description: 'Front Bumper repair' },
        { labour_charges: 1250, tax_percentage: 18, labour_description: 'LH Fender T/P' },
        { labour_charges: 1050, tax_percentage: 18, labour_description: 'RH Running Board T/P' },
        { labour_charges: 1000, tax_percentage: 18, labour_description: '4 Door Rubbing & Polishing' },
      ],
      totals_and_tax_summary: { grand_total_invoice: 4484 },
    };
    const md = `
Sub Total | 3,800.00
SGST@9% | 342.00
CGST@9% | 342.00
Total | 4,484.00`;
    const t = resolveBillSummary(data, md);
    expect(t.parts_total).toBe(0);
    expect(t.labour_total).toBe(3800);
    expect(t.labour_cgst_amount).toBe(342);
    expect(t.labour_sgst_amount).toBe(342);
    const net = (columnNet(t, 'parts') ?? 0) + (columnNet(t, 'labour') ?? 0);
    expect(Math.abs(net - 4484)).toBeLessThanOrEqual(1);
  });

  it('JN Car Care (Autorox, labour-only IGST) — combined "IGST Total" lands on Labour, survives', () => {
    const md = `
| 1 | FRONT BUMPER PAINTING | Labour | 998714 | 18 | 1.00 | 1,250.00 | 1,250.00 | 1,475.00 |
| 2 | FRONT BUMPER REPAIR | Labour | 998714 | 18 | 1.00 | 300.00 | 300.00 | 354.00 |
| Taxable Value | ₹ 1,550.00 |
| IGST Total | ₹ 279.00 |
| Discount Total | ₹ 0.00 |
| Round off | ₹ 1,829.00 |
| Parts Total | ₹ 0.00 |
| Labour Total | ₹ 1,550.00 |
| IGST Total | ₹ 279.00 |
| Grand Total | ₹ 1,829.00 |`;
    const r = extractSummaryFromMarkdown(md);
    expect(r.parts_total).toBe(0);
    expect(r.labour_total).toBe(1550);
    expect(r.labour_igst_amount).toBe(279);
    expect(r.parts_igst_amount ?? 0).toBe(0);

    const data = {
      parts_line_items: [],
      labour_service_line_items: [
        { labour_charges: 1250, tax_percentage: 18, labour_description: 'FRONT BUMPER PAINTING' },
        { labour_charges: 300, tax_percentage: 18, labour_description: 'FRONT BUMPER REPAIR' },
      ],
      totals_and_tax_summary: { grand_total_invoice: 1829 },
    };
    const t = resolveBillSummary(data, md);
    expect(t.labour_igst_amount).toBe(279);
    expect(t.labour_igst_rate).toBe(18);
    const net = (columnNet(t, 'parts') ?? 0) + (columnNet(t, 'labour') ?? 0);
    expect(Math.abs(net - 1829)).toBeLessThanOrEqual(1);
  });

  it('JSB/MG (IGST) — IGST rate inferred from line items when the footer prints only the amount', () => {
    const data = {
      parts_line_items: [{ taxable_amount: 3527.12, tax_percentage: 18 }],
      labour_service_line_items: [{ labour_charges: 3965, tax_percentage: 18 }],
      totals_and_tax_summary: {
        parts_total: 3527.12, labour_total: 3965, labour_discount: 126.5,
        parts_igst_amount: 634.87, labour_igst_amount: 690.93,
        grand_total_invoice: 8691.42,
      },
    };
    const t = resolveBillSummary(data);
    expect(t.parts_igst_rate).toBe(18);
    expect(t.labour_igst_rate).toBe(18);
    // Inter-state bill: never carries CGST/SGST rates.
    expect(t.parts_cgst_rate ?? null).toBeNull();
    expect(t.labour_sgst_rate ?? null).toBeNull();
    const net = (columnNet(t, 'parts') ?? 0) + (columnNet(t, 'labour') ?? 0);
    expect(Math.abs(net - 8691.42)).toBeLessThanOrEqual(1);
  });

  it('enrichParsedInvoice uses gross line amounts when footer has charge table', () => {
    const badLlm = {
      // LLM stored the post-discount taxable on the line; the footer charge table holds the gross.
      parts_line_items: [{ quantity: 1, rate: 4099.21, taxable_amount: 3894.38 }],
      labour_service_line_items: [{ labour_charges: 720, labour_description: 'SERVICE' }],
      totals_and_tax_summary: {
        parts_total: 4614.38,
        labour_total: 720,
        parts_discount: 284.96,
        grand_total_invoice: 5445,
      },
    };
    const e = enrichParsedInvoice(badLlm, formats.toyotaPartsLabour);
    const t = e.totals_and_tax_summary!;
    expect(t.parts_total).toBe(4099.21);
    expect(t.labour_total).toBe(800);
    expect(t.labour_discount).toBe(80);
    expect(e.parts_line_items![0].taxable_amount).toBe(4099.21); // 1 × 4099.21 gross (not the discounted 3894.38)
    expect(e.labour_service_line_items![0].labour_charges).toBe(800);
    const net = (columnNet(t, 'parts') ?? 0) + (columnNet(t, 'labour') ?? 0);
    expect(Math.abs(net - 5445)).toBeLessThanOrEqual(1);
  });
});
