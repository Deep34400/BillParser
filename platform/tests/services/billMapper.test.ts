import { describe, it, expect } from 'vitest';
import { mapParsedToBill } from '../../src/services/billing/billMapper.js';
import type { ParsedInvoiceData } from '../../src/models/types.js';

describe('mapParsedToBill', () => {
  const BILL_ID = 'test-bill-001';

  it('creates a BillDoc from full ParsedInvoiceData', () => {
    const parsed: ParsedInvoiceData = {
      irn: 'IRN001',
      pan: 'AAGCJ6656E',
      gstin: '07AAGCJ6656E1ZF',
      company_name: 'JSB MOBILITY PVT LTD',
      invoice_date: '19.03.2026',
      invoice_time: '19:53:29',
      invoice_number: 'DW21S25103620',
      vehicle_details: {
        chassis_number: 'M27GD5BEA8H024250',
        registration_number: 'HR55AM4015',
        mileage_odometer_reading: 62341,
      },
      totals_and_tax_summary: {
        parts_total: 3527.12,
        labour_total: 3965,
        parts_igst_amount: 634.87,
        labour_igst_amount: 690.93,
        grand_total_invoice: 8691.42,
      },
    };

    const bill = mapParsedToBill(BILL_ID, parsed, {
      fileUrl: 'https://example.com/bill.pdf',
      storagePath: 'bills/2026-03-19/abc.pdf',
    });

    expect(bill.bill_id).toBe(BILL_ID);
    expect(bill.company_name).toBe('JSB MOBILITY PVT LTD');
    expect(bill.gstin).toBe('07AAGCJ6656E1ZF');
    expect(bill.pan).toBe('AAGCJ6656E');
    expect(bill.invoice_number).toBe('DW21S25103620');
    expect(bill.invoice_date).toBe('19.03.2026');
    expect(bill.parts_amount).toBe(3527.12);
    expect(bill.labour_amount).toBe(3965);
    expect(bill.grand_total_amount).toBe(8691.42);
    expect(bill.registration_number).toBe('HR55AM4015');
    expect(bill.odometer_reading).toBe(62341);
    expect(bill.ocr_status).toBe('OCR_COMPLETED');
    expect(bill.schema_version).toBe(1);
    expect(bill.file_url).toBe('https://example.com/bill.pdf');
  });

  it('calculates total_tax_amount from GST fields', () => {
    const parsed: ParsedInvoiceData = {
      totals_and_tax_summary: {
        parts_cgst_amount: 100,
        parts_sgst_amount: 100,
        labour_cgst_amount: 50,
        labour_sgst_amount: 50,
      },
    };

    const bill = mapParsedToBill(BILL_ID, parsed);
    expect(bill.total_tax_amount).toBe(300);
  });

  it('returns null total_tax_amount when no GST', () => {
    const bill = mapParsedToBill(BILL_ID, {});
    expect(bill.total_tax_amount).toBeNull();
  });

  it('preserves parsed_data as immutable source of truth', () => {
    const parsed: ParsedInvoiceData = {
      company_name: 'Test Corp',
      parts_line_items: [{ rate: 100, quantity: 2 }],
    };
    const bill = mapParsedToBill(BILL_ID, parsed);
    expect(bill.parsed_data).toEqual(parsed);
  });

  it('defaults bill_type to MAINTENANCE', () => {
    const bill = mapParsedToBill(BILL_ID, {});
    expect(bill.bill_type).toBe('MAINTENANCE');
  });

  it('accepts custom bill_type', () => {
    const bill = mapParsedToBill(BILL_ID, {}, { billType: 'FUEL' });
    expect(bill.bill_type).toBe('FUEL');
  });
});
