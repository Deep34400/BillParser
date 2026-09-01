import { describe, it, expect } from 'vitest';
import { mapAzapiResponse } from '../../../src/ocr/providers/azapiOcr.js';

const SAMPLE_RESPONSE = {
  status: 'Success',
  requestid: 'req-abc-123',
  output: {
    entries: [{
      id: 'doc-xyz-456',
      parsed_data: {
        company_name: 'SAI SERVICE PRIVATE LIMITED',
        invoice_number: 'JC26010401',
        invoice_date: '2026-08-14',
        gstin: '27AABCS1234F1Z5',
        pan: 'AABCS1234F',
        vehicle_details: {
          registration_number: 'MH12YB9731',
          chassis_number: 'D48112',
          mileage_odometer_reading: 41256,
        },
        service_details: {
          service_type: 'BODY REPAIR',
        },
        parts_line_items: [
          {
            item_name_description: 'UNIT HEAD LAMP LH',
            part_number_item_code: '35321M69R00',
            hsn_sac_code: '85122010',
            quantity: 1,
            rate: 2309.32,
            taxable_amount: 0,
            tax_percentage: null,
          },
          {
            item_name_description: 'GLASS COMP,FRONT DOOR WINDOW,L',
            part_number_item_code: '84502M69R00',
            hsn_sac_code: '70072190',
            quantity: 1,
            rate: 1004.23,
            taxable_amount: 1004.23,
            tax_percentage: 18,
          },
        ],
        labour_service_line_items: [
          {
            labour_description: 'DENTING CHARGES',
            labour_code: 'ZF9992',
            hsn_sac_code: '998729',
            labour_charges: 0,
            tax_percentage: null,
          },
        ],
        totals_and_tax_summary: {
          parts_total: 1240.98,
          labour_total: 0,
          parts_discount: 0,
          parts_cgst_rate: 9,
          parts_sgst_rate: 9,
          parts_cgst_amount: 111.69,
          parts_sgst_amount: 111.69,
          grand_total_invoice: 1964,
        },
      },
    }],
  },
};

describe('mapAzapiResponse', () => {
  it('maps a successful AzAPI response to ParsedInvoiceData', () => {
    const { parsed, documentId } = mapAzapiResponse(SAMPLE_RESPONSE);

    expect(parsed.company_name).toBe('SAI SERVICE PRIVATE LIMITED');
    expect(parsed.invoice_number).toBe('JC26010401');
    expect(parsed.invoice_date).toBe('2026-08-14');
    expect(parsed.gstin).toBe('27AABCS1234F1Z5');
    expect(parsed.pan).toBe('AABCS1234F');

    expect(parsed.vehicle_details?.registration_number).toBe('MH12YB9731');
    expect(parsed.service_details?.service_type).toBe('BODY REPAIR');

    expect(parsed.parts_line_items).toHaveLength(2);
    expect(parsed.parts_line_items![0].item_name_description).toBe('UNIT HEAD LAMP LH');
    expect(parsed.parts_line_items![1].taxable_amount).toBe(1004.23);

    expect(parsed.labour_service_line_items).toHaveLength(1);
    expect(parsed.labour_service_line_items![0].labour_code).toBe('ZF9992');

    expect(parsed.totals_and_tax_summary?.parts_total).toBe(1240.98);
    expect(parsed.totals_and_tax_summary?.parts_cgst_rate).toBe(9);
    expect(parsed.totals_and_tax_summary?.grand_total_invoice).toBe(1964);

    expect(documentId).toBe('doc-xyz-456');
  });

  it('handles grand_total fallback (grand_total instead of grand_total_invoice)', () => {
    const alt = {
      ...SAMPLE_RESPONSE,
      output: {
        entries: [{
          id: 'doc-2',
          parsed_data: {
            company_name: 'Test',
            totals_and_tax_summary: {
              parts_total: 100,
              grand_total: 118,
            },
          },
        }],
      },
    };
    const { parsed } = mapAzapiResponse(alt);
    expect(parsed.totals_and_tax_summary?.grand_total_invoice).toBe(118);
  });

  it('throws on non-success status', () => {
    const bad = { status: 'Failed', message: 'OCR failed' };
    expect(() => mapAzapiResponse(bad)).toThrow('AzAPI OCR failed');
  });

  it('throws when no parsed_data', () => {
    const empty = { status: 'Success', output: { entries: [{ id: 'x' }] } };
    expect(() => mapAzapiResponse(empty)).toThrow('no parsed data');
  });
});
