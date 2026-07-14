import { describe, it, expect } from 'vitest';
import { billToInvoice } from '../../src/lib/billToInvoice.js';
import type { BillDoc, BillPartDoc } from '../../src/models/types.js';

function makeBill(overrides: Partial<BillDoc> = {}): BillDoc {
  return {
    bill_id: 'test-001',
    bill_type: 'MAINTENANCE',
    ocr_status: 'OCR_COMPLETED',
    schema_version: 1,
    created_at: '2026-03-19T00:00:00Z',
    updated_at: '2026-03-19T00:00:00Z',
    ...overrides,
  };
}

describe('billToInvoice', () => {
  it('maps bill_id to id', () => {
    const inv = billToInvoice(makeBill({ bill_id: 'abc-123' }));
    expect(inv.id).toBe('abc-123');
  });

  it('maps OCR_COMPLETED to COMPLETED status', () => {
    const inv = billToInvoice(makeBill({ ocr_status: 'OCR_COMPLETED' }));
    expect(inv.status).toBe('COMPLETED');
  });

  it('maps UPLOADED to PENDING status', () => {
    const inv = billToInvoice(makeBill({ ocr_status: 'UPLOADED' }));
    expect(inv.status).toBe('PENDING');
  });

  it('maps VERIFIED to COMPLETED + verified=true', () => {
    const inv = billToInvoice(makeBill({ ocr_status: 'VERIFIED' }));
    expect(inv.status).toBe('COMPLETED');
    expect(inv.verified).toBe(true);
  });

  it('maps FAILED with error message', () => {
    const inv = billToInvoice(makeBill({
      ocr_status: 'FAILED',
      processing_status: 'OCR timeout',
    }));
    expect(inv.status).toBe('FAILED');
    expect(inv.error).toBe('OCR timeout');
  });

  it('maps vendor and invoice fields', () => {
    const inv = billToInvoice(makeBill({
      vendor_name: 'JSB MOBILITY',
      vendor_gstin: '07AAGCJ6656E1ZF',
      invoice_number: 'DW21S25103620',
      invoice_date: '19.03.2026',
      grand_total_amount: 8691.42,
    }));
    expect(inv.vendorName).toBe('JSB MOBILITY');
    expect(inv.vendorTaxId).toBe('07AAGCJ6656E1ZF');
    expect(inv.invoiceNumber).toBe('DW21S25103620');
    expect(inv.invoiceDate).toBe('19.03.2026');
    expect(inv.totalAmount).toBe(8691.42);
  });

  it('calculates combined GST amounts', () => {
    const inv = billToInvoice(makeBill({
      parsed_data: {
        totals_and_tax_summary: {
          parts_cgst_amount: 100,
          parts_sgst_amount: 100,
          labour_cgst_amount: 50,
          labour_sgst_amount: 50,
        },
      },
    }));
    expect(inv.cgstAmount).toBe(150);
    expect(inv.sgstAmount).toBe(150);
  });

  it('preserves parsedData as the OCR source of truth', () => {
    const parsed = {
      company_name: 'Test Corp',
      invoice_number: 'INV-001',
      parts_line_items: [{ rate: 100, quantity: 2 }],
    };
    const inv = billToInvoice(makeBill({ parsed_data: parsed }));
    expect(inv.parsedData).toEqual(parsed);
  });

  it('maps BillPartDocs to lineItems', () => {
    const parts: BillPartDoc[] = [
      {
        part_id: 'p1', bill_id: 'test-001', line_type: 'PART',
        name: 'FILTER', description: 'FILTER', quantity: 1, rate: 423,
        amount: 423, hsn_sac_code: '84212300', tax_percentage: 18,
        tax_amount: null, part_number: '11668822', manufacturer: null,
        normalized_name: null, confidence_score: null, created_at: '2026-01-01',
      },
      {
        part_id: 'l1', bill_id: 'test-001', line_type: 'LABOUR',
        name: 'Brake cleaning', description: 'Brake cleaning', quantity: 1, rate: 1138.5,
        amount: 1138.5, hsn_sac_code: '998729', tax_percentage: 18,
        tax_amount: null, part_number: 'H1250200', manufacturer: null,
        normalized_name: null, confidence_score: null, created_at: '2026-01-01',
      },
    ];

    const inv = billToInvoice(makeBill(), parts);
    expect(inv.lineItems).toHaveLength(2);
    expect(inv.itemCount).toBe(2);
    expect(inv.lineItems![0].description).toBe('FILTER');
    expect(inv.lineItems![0].amount).toBe(423);
    expect(inv.lineItems![0].labourAmount).toBeNull();
    expect(inv.lineItems![1].description).toBe('Brake cleaning');
    expect(inv.lineItems![1].labourAmount).toBe(1138.5);
    expect(inv.lineItems![1].amount).toBeNull();
  });

  it('sets currency to INR', () => {
    const inv = billToInvoice(makeBill());
    expect(inv.currency).toBe('INR');
  });
});
