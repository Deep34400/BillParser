import { describe, expect, it } from 'vitest';
import { enrichParsedInvoice } from '../../src/billing/normalize.js';
import type { ParsedInvoiceData } from '../../src/parsing/types.js';

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
