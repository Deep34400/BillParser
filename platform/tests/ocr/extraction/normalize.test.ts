import { describe, expect, it } from 'vitest';
import { enrichParsedInvoice, normalizePartsLineItem } from '../../../src/ocr/transformer/normalize/index.js';
import { reconcileInvoiceTotal, partsLineAmount } from '../../../src/ocr/transformer/reconcileTotal.js';
import type { ParsedInvoiceData } from '../../../src/ocr/types/invoice.js';

const EMPTY: ParsedInvoiceData = {
  irn: null, pan: null, gstin: null, company_name: null,
  invoice_date: null, invoice_time: null, invoice_number: null,
  service_details: { service_type: null, last_service: null, next_service_due: null },
  vehicle_details: { registration_number: null, chassis_number: null, mileage_odometer_reading: null },
  parts_line_items: [], labour_service_line_items: [],
  totals_and_tax_summary: {
    parts_total: null, labour_total: null, parts_discount: null, labour_discount: null,
    parts_cgst_rate: null, parts_sgst_rate: null, parts_igst_rate: null,
    labour_cgst_rate: null, labour_sgst_rate: null, labour_igst_rate: null,
    parts_cgst_amount: null, parts_sgst_amount: null, parts_igst_amount: null,
    labour_cgst_amount: null, labour_sgst_amount: null, labour_igst_amount: null,
    sub_total_calculated: null, grand_total_invoice: null,
    parts_special_discount: null, labour_special_discount: null,
    deductibles: null, salvage: null,
  },
};

describe('cleanCompanyName (via enrichParsedInvoice)', () => {
  it('strips trailing \\n\\nIGST from company_name', () => {
    const data = { ...EMPTY, company_name: 'VIPUL MOTORS PVT. LTD.\n\nIGST' };
    const result = enrichParsedInvoice(data);
    expect(result.company_name).toBe('VIPUL MOTORS PVT. LTD.');
  });

  it('strips trailing CGST/SGST', () => {
    const data = { ...EMPTY, company_name: 'ABC MOTORS\nCGST' };
    const result = enrichParsedInvoice(data);
    expect(result.company_name).toBe('ABC MOTORS');
  });

  it('returns null for empty string', () => {
    const data = { ...EMPTY, company_name: '' };
    const result = enrichParsedInvoice(data);
    expect(result.company_name).toBeNull();
  });

  it('preserves clean company names', () => {
    const data = { ...EMPTY, company_name: 'AJAY PAL' };
    const result = enrichParsedInvoice(data);
    expect(result.company_name).toBe('AJAY PAL');
  });
});

describe('fallbackInvoiceNumber (via enrichParsedInvoice)', () => {
  it('picks Job Card No. from markdown when invoice_number is null', () => {
    const md = '**Job Card No. : JC26007246**\nReg.No. : HR55BA7133';
    const data = { ...EMPTY, invoice_number: null };
    const result = enrichParsedInvoice(data, md);
    expect(result.invoice_number).toBe('JC26007246');
  });

  it('picks Tax Invoice No. from markdown', () => {
    const md = 'Tax Invoice No./Sales Invoice TXA25-08492(Cash)';
    const data = { ...EMPTY, invoice_number: null };
    const result = enrichParsedInvoice(data, md);
    expect(result.invoice_number).toBe('TXA25-08492(Cash)');
  });

  it('picks Invoice No. with colon from markdown', () => {
    const md = 'Invoice No. : 15/BR/25002444';
    const data = { ...EMPTY, invoice_number: null };
    const result = enrichParsedInvoice(data, md);
    expect(result.invoice_number).toBe('15/BR/25002444');
  });

  it('does NOT override existing invoice_number', () => {
    const md = 'Job Card No. : JC26007246';
    const data = { ...EMPTY, invoice_number: 'INV-999' };
    const result = enrichParsedInvoice(data, md);
    expect(result.invoice_number).toBe('INV-999');
  });

  it('returns null when markdown has no match', () => {
    const md = 'Some random text without invoice number';
    const data = { ...EMPTY, invoice_number: null };
    const result = enrichParsedInvoice(data, md);
    expect(result.invoice_number).toBeNull();
  });
});

describe('fillPanFromGstin (via enrichParsedInvoice)', () => {
  it('derives seller PAN from GSTIN when pan is null', () => {
    const data = {
      ...EMPTY,
      gstin: '09AABCV0931B1ZS',
      pan: null,
      company_name: 'VIPUL MOTORS PVT. LTD.',
    };
    const result = enrichParsedInvoice(data);
    expect(result.pan).toBe('AABCV0931B');
    expect(result.gstin).toBe('09AABCV0931B1ZS');
  });

  it('does NOT override an existing PAN', () => {
    const data = {
      ...EMPTY,
      gstin: '09AABCV0931B1ZS',
      pan: 'EXISTING1A',
    };
    const result = enrichParsedInvoice(data);
    expect(result.pan).toBe('EXISTING1A');
  });

  it('Vipul proforma: Job Card No. + PAN from GSTIN', () => {
    const md = `
PROFORMA INVOICE
Job Card No.: JC26007246
Reg.No.: HR55BA7133
VIPUL MOTORS PVT. LTD.
Dealer GSTIN: 09AABCV0931B1ZS
`;
    const data: ParsedInvoiceData = {
      ...EMPTY,
      company_name: 'VIPUL MOTORS PVT. LTD.',
      gstin: '09AABCV0931B1ZS',
      pan: null,
      invoice_number: null,
      invoice_date: '25/06/2026',
    };
    const result = enrichParsedInvoice(data, md);
    expect(result.invoice_number).toBe('JC26007246');
    expect(result.pan).toBe('AABCV0931B');
  });
});

/**
 * Toyota Millennium — Exide battery with 100% discount.
 * Taxable value = "Free" (LLM returns null), tax_percentage = 0.
 * normalizePartsLineItem must NOT fill qty*rate when tax_percentage is 0 and taxable is null.
 */
describe('normalizePartsLineItem — "Free" item (100% discount, 0% tax)', () => {
  it('sets taxable_amount to 0 when tax_percentage is 0 and taxable_amount is null', () => {
    const item = normalizePartsLineItem({
      item_name_description: 'Exide EY34B19L',
      part_number_item_code: 'B-BA01E-34B19',
      hsn_sac_code: '85071000',
      quantity: 1,
      rate: 3630,
      taxable_amount: null,
      tax_percentage: 0,
    });
    expect(item.taxable_amount).toBe(0);
  });

  it('still fills qty*rate when tax_percentage > 0 and taxable_amount is null', () => {
    const item = normalizePartsLineItem({
      item_name_description: 'GASKET',
      quantity: 1,
      rate: 15,
      taxable_amount: null,
      tax_percentage: 9,
    });
    expect(item.taxable_amount).toBe(15);
  });

  it('keeps explicit taxable_amount 0 unchanged (existing behaviour)', () => {
    const item = normalizePartsLineItem({
      item_name_description: 'Exide EY34B19L',
      quantity: 1,
      rate: 3630,
      taxable_amount: 0,
      tax_percentage: 0,
    });
    expect(item.taxable_amount).toBe(0);
  });
});

describe('partsLineAmount — Free vs insurance write-off', () => {
  it('returns qty*rate for Free item (taxable 0 + tax 0%) so discount can absorb it', () => {
    expect(partsLineAmount({ quantity: 1, rate: 3630, taxable_amount: 0, tax_percentage: 0 })).toBe(3630);
  });

  it('returns 0 for insurance write-off (taxable 0, no/positive tax)', () => {
    expect(partsLineAmount({ quantity: 1, rate: 3630, taxable_amount: 0 })).toBe(0);
    expect(partsLineAmount({ quantity: 1, rate: 3630, taxable_amount: 0, tax_percentage: 18 })).toBe(0);
  });

  it('returns qty*rate when tax_percentage > 0 and taxable_amount is null', () => {
    expect(partsLineAmount({ quantity: 2, rate: 50, taxable_amount: null, tax_percentage: 18 })).toBe(100);
  });

  it('returns qty*rate when tax_percentage is null and taxable_amount is null', () => {
    expect(partsLineAmount({ quantity: 2, rate: 50, taxable_amount: null, tax_percentage: null })).toBe(100);
  });
});

describe('Toyota Millennium — full reconciliation with Free battery item', () => {
  function toyotaInvoice(batteryTaxable: number | null): ParsedInvoiceData {
    return {
      ...EMPTY,
      company_name: 'Arpanna Motors Private Ltd',
      gstin: '27AADCA4487F1ZM',
      invoice_number: 'TXA26-04475(Cash)',
      parts_line_items: [
        { item_name_description: 'TOYOTA ENG OIL 3.3 LTR', part_number_item_code: 'L-0888-083202', hsn_sac_code: '27101972', quantity: 37, rate: 58.71, taxable_amount: 2172.27, tax_percentage: 18 },
        { item_name_description: 'GASKET', part_number_item_code: 'A-90118-WC184', hsn_sac_code: '84841090', quantity: 1, rate: 15, taxable_amount: 15, tax_percentage: 18 },
        { item_name_description: 'FILTER ASSY,OIL', part_number_item_code: 'A-90118-WC340', hsn_sac_code: '84212300', quantity: 1, rate: 95, taxable_amount: 95, tax_percentage: 18 },
        { item_name_description: 'Exide EY34B19L', part_number_item_code: 'B-BA01E-34B19', hsn_sac_code: '85071000', quantity: 1, rate: 3630, taxable_amount: batteryTaxable, tax_percentage: 0 },
      ],
      labour_service_line_items: [
        { labour_description: '50,000 KM SERVICE - INSP', labour_code: '50000', hsn_sac_code: '998729', labour_charges: 3220, tax_percentage: 18 },
      ],
      totals_and_tax_summary: {
        parts_total: 5912.27,
        labour_total: 3220,
        parts_discount: 3744.11,
        labour_discount: 322,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        labour_cgst_rate: 9,
        labour_sgst_rate: 9,
        parts_cgst_amount: 195.12,
        parts_sgst_amount: 195.12,
        labour_cgst_amount: 260.82,
        labour_sgst_amount: 260.82,
        grand_total_invoice: 5978,
      },
      confidence: 0.9,
    };
  }

  it('sets Free battery taxable_amount to 0 when LLM returns null', () => {
    const enriched = enrichParsedInvoice(toyotaInvoice(null));
    const battery = enriched.parts_line_items?.find((p) => p.part_number_item_code === 'B-BA01E-34B19');
    expect(battery?.taxable_amount).toBe(0);
    expect(reconcileInvoiceTotal(enriched).matched).toBe(true);
  });

  it('sets Free battery taxable_amount to 0 when LLM copies gross (3630)', () => {
    const enriched = enrichParsedInvoice(toyotaInvoice(3630));
    const battery = enriched.parts_line_items?.find((p) => p.part_number_item_code === 'B-BA01E-34B19');
    expect(battery?.taxable_amount).toBe(0);
    const recon = reconcileInvoiceTotal(enriched);
    expect(recon.matched).toBe(true);
    expect(recon.difference).toBeLessThanOrEqual(2);
  });

  it('does not zero genuine 0% fuel when discount does not cover it', () => {
    const data: ParsedInvoiceData = {
      ...EMPTY,
      parts_line_items: [
        { quantity: 1, rate: 1000, taxable_amount: 1000, tax_percentage: 18 },
        { quantity: 1, rate: 200, taxable_amount: 200, tax_percentage: 0 },
      ],
      labour_service_line_items: [],
      totals_and_tax_summary: {
        parts_total: 1200,
        parts_discount: 0,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        grand_total_invoice: 1380,
      },
      confidence: 0.9,
    };
    const enriched = enrichParsedInvoice(data);
    const fuel = enriched.parts_line_items?.find((p) => p.tax_percentage === 0);
    expect(fuel?.taxable_amount).toBe(200);
  });
});
