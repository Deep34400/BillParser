import { describe, it, expect } from 'vitest';
import { toApiParsed } from '../../src/lib/toApiParsed.js';
import type { ParsedInvoiceData } from '../../src/models/types.js';

describe('toApiParsed', () => {
  it('returns all null keys for empty input', () => {
    const result = toApiParsed(null);
    expect(result.irn).toBeNull();
    expect(result.pan).toBeNull();
    expect(result.gstin).toBeNull();
    expect(result.company_name).toBeNull();
    expect(result.invoice_date).toBeNull();
    expect(result.invoice_time).toBeNull();
    expect(result.invoice_number).toBeNull();
    expect(result.service_details.service_type).toBeNull();
    expect(result.vehicle_details.chassis_number).toBeNull();
    expect(result.parts_line_items).toEqual([]);
    expect(result.labour_service_line_items).toEqual([]);
    expect(result.totals_and_tax_summary.grand_total_invoice).toBeNull();
  });

  it('preserves string fields', () => {
    const input: ParsedInvoiceData = {
      irn: 'IRN123',
      pan: 'AAGCJ6656E',
      gstin: '07AAGCJ6656E1ZF',
      company_name: 'JSB MOBILITY',
      invoice_date: '19.03.2026',
      invoice_time: '19:53:29',
      invoice_number: 'DW21S25103620',
    };
    const result = toApiParsed(input);
    expect(result.irn).toBe('IRN123');
    expect(result.pan).toBe('AAGCJ6656E');
    expect(result.gstin).toBe('07AAGCJ6656E1ZF');
    expect(result.company_name).toBe('JSB MOBILITY');
    expect(result.invoice_date).toBe('19.03.2026');
  });

  it('maps parts line items correctly', () => {
    const input: ParsedInvoiceData = {
      parts_line_items: [
        {
          rate: 423.73,
          quantity: 1,
          hsn_sac_code: '84212300',
          tax_percentage: 18,
          taxable_amount: 423.73,
          item_name_description: 'FILTER-POLLEN',
          part_number_item_code: '11668822',
        },
      ],
    };
    const result = toApiParsed(input);
    expect(result.parts_line_items).toHaveLength(1);
    expect(result.parts_line_items[0].rate).toBe(423.73);
    expect(result.parts_line_items[0].item_name_description).toBe('FILTER-POLLEN');
    expect(result.parts_line_items[0].hsn_sac_code).toBe('84212300');
  });

  it('maps labour line items correctly', () => {
    const input: ParsedInvoiceData = {
      labour_service_line_items: [
        {
          labour_code: 'EV4PM60',
          hsn_sac_code: '998729',
          labour_charges: 2700,
          tax_percentage: 18,
          labour_description: 'Paid Service/60000 KM EV',
        },
      ],
    };
    const result = toApiParsed(input);
    expect(result.labour_service_line_items).toHaveLength(1);
    expect(result.labour_service_line_items[0].labour_charges).toBe(2700);
    expect(result.labour_service_line_items[0].labour_code).toBe('EV4PM60');
  });

  it('resolves IGST-only rates (clears CGST/SGST)', () => {
    const input: ParsedInvoiceData = {
      totals_and_tax_summary: {
        parts_igst_amount: 634.87,
        parts_igst_rate: 18,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        parts_cgst_amount: 0,
        parts_sgst_amount: 0,
      },
    };
    const result = toApiParsed(input);
    expect(result.totals_and_tax_summary.parts_igst_rate).toBe(18);
    expect(result.totals_and_tax_summary.parts_cgst_rate).toBeNull();
    expect(result.totals_and_tax_summary.parts_sgst_rate).toBeNull();
  });

  it('resolves CGST+SGST rates (clears IGST)', () => {
    const input: ParsedInvoiceData = {
      totals_and_tax_summary: {
        labour_cgst_amount: 74.7,
        labour_sgst_amount: 74.7,
        labour_cgst_rate: 9,
        labour_sgst_rate: 9,
        labour_igst_amount: 0,
        labour_igst_rate: 18,
      },
    };
    const result = toApiParsed(input);
    expect(result.totals_and_tax_summary.labour_cgst_rate).toBe(9);
    expect(result.totals_and_tax_summary.labour_sgst_rate).toBe(9);
    expect(result.totals_and_tax_summary.labour_igst_rate).toBeNull();
  });

  it('nullifies rates when no GST amounts', () => {
    const input: ParsedInvoiceData = {
      totals_and_tax_summary: {
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        parts_cgst_amount: 0,
        parts_sgst_amount: 0,
        parts_igst_amount: 0,
      },
    };
    const result = toApiParsed(input);
    expect(result.totals_and_tax_summary.parts_cgst_rate).toBeNull();
    expect(result.totals_and_tax_summary.parts_sgst_rate).toBeNull();
    expect(result.totals_and_tax_summary.parts_igst_rate).toBeNull();
  });

  it('preserves deductibles and salvage', () => {
    const input: ParsedInvoiceData = {
      totals_and_tax_summary: {
        deductibles: 500,
        salvage: 200,
        grand_total_invoice: 5000,
      },
    };
    const result = toApiParsed(input);
    expect(result.totals_and_tax_summary.deductibles).toBe(500);
    expect(result.totals_and_tax_summary.salvage).toBe(200);
    expect(result.totals_and_tax_summary.grand_total_invoice).toBe(5000);
  });
});
