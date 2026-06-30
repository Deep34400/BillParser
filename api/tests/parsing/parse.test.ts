import { describe, it, expect } from 'vitest';
import { parseStructuredOutput } from '../../src/parsing/parse.js';
import { toCanonicalResult } from '../../src/response/toCanonical.js';
import { validateParsedInvoice } from '../../src/parsing/validate.js';
import { normalizeStructured } from '../../src/parsing/index.js';

const SAMPLE = {
  output: {
    entries: [{
      id: '0fb2f9fa-24d9-45c6-9e39-8dfc6304414e',
      parsed_data: {
        irn: '5245b0048b92f2d0f2c93d13cb199dc03f7e92b04395aaa1150ecd5eddea7ee0',
        pan: 'AALCC8489R',
        gstin: '27AALCC8489R1ZD',
        company_name: 'CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED',
        invoice_date: '23/01/2026',
        invoice_time: '16:51:00',
        invoice_number: '20/BC/25031185',
        service_details: {
          last_service: null,
          service_type: 'Peroidic Maintenance Service',
          next_service_due: 'PMS 30',
        },
        vehicle_details: {
          chassis_number: 'D21289',
          registration_number: 'MH01EW7065',
          mileage_odometer_reading: 20397.0,
        },
        parts_line_items: [{
          rate: 9.32,
          quantity: 1.0,
          hsn_sac_code: '84841090',
          tax_percentage: 18.0,
          taxable_amount: 9.32,
          item_name_description: 'GASKET, OIL DRAIN PLUG',
          part_number_item_code: '09168M14015',
        }],
        labour_service_line_items: [{
          labour_code: 'ZE25L0P',
          hsn_sac_code: '998729',
          labour_charges: 2140.0,
          tax_percentage: null,
          labour_description: 'PMS 20/30/40/60/80/90',
        }],
        totals_and_tax_summary: {
          parts_total: 2117.31,
          labour_total: 2140.0,
          parts_discount: 325.63,
          labour_discount: 1284.0,
          parts_cgst_rate: 9,
          parts_sgst_rate: 9,
          parts_cgst_amount: 161.26,
          parts_sgst_amount: 161.26,
          labour_cgst_rate: 9,
          labour_sgst_rate: 9,
          labour_cgst_amount: 77.04,
          labour_sgst_amount: 77.04,
          sub_total_calculated: 3124.28,
          grand_total_invoice: 3124.0,
          deductibles: 900,
          salvage: 500,
        },
        confidence: 0.92,
      },
    }],
  },
};

describe('central invoice schema', () => {
  it('parses the wrapped output.entries[0].parsed_data shape', () => {
    const r = parseStructuredOutput(JSON.stringify(SAMPLE));
    expect(r.format).toBe('schema');
    expect(r.parsed.company_name).toBe('CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED');
    expect(r.parsed.gstin).toBe('27AALCC8489R1ZD');
    expect(r.parsed.parts_line_items).toHaveLength(1);
    expect(r.parsed.labour_service_line_items).toHaveLength(1);
  });

  it('maps schema to canonical DB fields', () => {
    const { parsed } = parseStructuredOutput(JSON.stringify(SAMPLE));
    const c = toCanonicalResult(parsed);
    expect(c.vendorName).toBe('CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED');
    expect(c.vendorTaxId).toBe('27AALCC8489R1ZD');
    expect(c.invoiceNumber).toBe('20/BC/25031185');
    expect(c.invoiceDate).toBe('2026-01-23');
    expect(c.lineItems).toHaveLength(2);
    expect(c.lineItems[0].description).toBe('GASKET, OIL DRAIN PLUG');
    expect(c.lineItems[1].labourAmount).toBe(2140);
    expect(c.summaryColumns?.length).toBeGreaterThanOrEqual(2);
    expect(c.discountAmount).toBe(325.63 + 1284);
  });

  it('validates GSTIN and line items', () => {
    const { parsed } = parseStructuredOutput(JSON.stringify(SAMPLE));
    const issues = validateParsedInvoice(parsed);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('still supports legacy canonical JSON via normalizeStructured', () => {
    const legacy = JSON.stringify({
      vendorName: 'Acme', invoiceDate: '2026-01-02', totalAmount: 1234.5, confidence: 0.9,
      lineItems: [{ description: 'Widget', quantity: 2, amount: 20 }],
    });
    const r = normalizeStructured(legacy);
    expect(r.vendorName).toBe('Acme');
    expect(r.lineItems[0].amount).toBe(20);
  });

  it('repairs comma-formatted unquoted numbers from LLM output', () => {
    const bad = '{"output":{"entries":[{"parsed_data":{"company_name":"Arpanna Motors Private Ltd","gstin":"27AADCA4487F1ZM","invoice_number":"TXA25-07395(Cash)","parts_line_items":[{"item_name_description":"BRAKE FLUID","part_number_item_code":"A-08823-80015","hsn_sac_code":"38190010","quantity":1,"rate": 46.48,"taxable_amount": 1,633.92,"tax_percentage":9}],"labour_service_line_items":[],"totals_and_tax_summary":{"parts_total": 1,823.76,"parts_discount": 91.19,"parts_cgst_amount": 155.94,"grand_total_invoice": 2045},"confidence":0.9}}]}}';
    const r = parseStructuredOutput(bad);
    expect(r.parsed.company_name).toBe('Arpanna Motors Private Ltd');
    expect(r.parsed.parts_line_items![0].taxable_amount).toBe(1633.92);
    expect(r.parsed.totals_and_tax_summary?.parts_total).toBe(1823.76);
    expect(r.parsed.totals_and_tax_summary?.parts_cgst_amount).toBe(155.94);
  });

  it('repairs trailing commas in LLM JSON', () => {
    const bad = '{"output":{"entries":[{"parsed_data":{"company_name":"X","parts_line_items":[],"confidence":0.9,}}]}}';
    const r = parseStructuredOutput(bad);
    expect(r.parsed.company_name).toBe('X');
  });
});
