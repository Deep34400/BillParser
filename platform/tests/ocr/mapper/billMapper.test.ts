import { describe, it, expect } from 'vitest';
import { mapParsedToBill } from '../../../src/ocr/mapper.js';
import type { ParsedInvoiceData } from '../../../src/shared/types.js';

describe('mapParsedToBill', () => {
  const BILL_ID = 'test-bill-001';

  const baseParsed: ParsedInvoiceData = {
    company_name: 'JSB MOBILITY PVT LTD',
    pan: 'AAGCJ6656E',
    gstin: '07AAGCJ6656E1ZF',
    invoice_date: '19.03.2026',
    invoice_number: 'DW21S25103620',
    parts_line_items: [{ taxable_amount: 100, tax_percentage: 18 }],
    totals_and_tax_summary: { parts_total: 100, grand_total_invoice: 118, parts_cgst_rate: 9, parts_sgst_rate: 9 },
    confidence: 0.9,
  };

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
      parts_line_items: [{ taxable_amount: 3527.12, tax_percentage: 18 }],
      labour_service_line_items: [{ labour_charges: 3965, tax_percentage: 18 }],
      totals_and_tax_summary: {
        parts_total: 3527.12,
        labour_total: 3965,
        parts_igst_rate: 18,
        labour_igst_rate: 18,
        parts_igst_amount: 634.87,
        labour_igst_amount: 690.93,
        grand_total_invoice: 8840.7,
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
    expect(bill.grand_total_amount).toBe(8840.7);
    expect(bill.registration_number).toBe('HR55AM4015');
    expect(bill.odometer_reading).toBe(62341);
    expect(bill.ocr_status).toBe('OCR_COMPLETED');
    expect(bill.schema_version).toBe(1);
    expect(bill.file_url).toBe('https://example.com/bill.pdf');
  });

  it('sets NEED_REVIEW when both GSTIN and PAN are missing', () => {
    const bill = mapParsedToBill(BILL_ID, {
      ...baseParsed,
      gstin: null,
      pan: null,
    });
    expect(bill.ocr_status).toBe('NEED_REVIEW');
    expect(bill.review_codes).toContain('MISSING_TAX_ID');
    expect(bill.review_reasons?.some((r) => /handwritten|GSTIN or PAN/i.test(r))).toBe(true);
  });

  it('keeps OCR_COMPLETED when GSTIN is present even with low confidence', () => {
    const bill = mapParsedToBill(BILL_ID, {
      ...baseParsed,
      confidence: 0.4,
    });
    expect(bill.ocr_status).toBe('OCR_COMPLETED');
  });

  it('keeps OCR_COMPLETED when only PAN is present (no GSTIN)', () => {
    const bill = mapParsedToBill(BILL_ID, {
      ...baseParsed,
      gstin: null,
      pan: 'AAGCJ6656E',
    });
    expect(bill.ocr_status).toBe('OCR_COMPLETED');
  });
});
