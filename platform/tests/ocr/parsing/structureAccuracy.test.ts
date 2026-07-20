/**
 * Tests that structureFromLlmResponse correctly parses various invoice types.
 */
import { describe, it, expect } from 'vitest';
import { structureFromLlmResponse } from '../../../src/ocr/parsing/parse.js';

describe('structureFromLlmResponse — diverse invoice types', () => {
  it('parses Indian automotive invoice', () => {
    const json = JSON.stringify({
      output: { entries: [{ parsed_data: {
        company_name: 'Fort Point Automotive',
        gstin: '27AACCP5360R1ZT',
        invoice_number: '1/BC/25006704',
        invoice_date: '29/08/2025',
        vehicle_details: { registration_number: 'MH01EW1671', chassis_number: 'C12268' },
        parts_line_items: [
          { item_name_description: 'GASKET,OIL DRAIN PLUG', part_number_item_code: '09168M14015', hsn_sac_code: '84841090', quantity: 1, rate: 9.32, taxable_amount: 9.32, tax_percentage: 18 },
        ],
        labour_service_line_items: [],
        totals_and_tax_summary: {
          parts_total: 100, labour_total: 50,
          parts_cgst_rate: 9, parts_sgst_rate: 9,
          parts_cgst_amount: 9, parts_sgst_amount: 9,
          grand_total_invoice: 168,
        },
        confidence: 0.95,
      }}]},
    });
    const r = structureFromLlmResponse(json, '');
    expect(r.parsedData).toBeTruthy();
    expect(r.parsedData!.company_name).toBe('Fort Point Automotive');
    expect(r.parsedData!.vehicle_details?.registration_number).toBe('MH01EW1671');
    expect(r.parsedData!.parts_line_items?.length).toBe(1);
    expect(r.parsedData!.totals_and_tax_summary?.grand_total_invoice).toBe(168);
  });

  it('parses SaaS subscription invoice (Cursor Pro)', () => {
    const json = JSON.stringify({
      output: { entries: [{ parsed_data: {
        company_name: 'Anysphere, Inc.',
        invoice_number: 'E3TSVYGG-0003',
        invoice_date: '19/07/2026',
        gstin: null,
        pan: null,
        vehicle_details: null,
        parts_line_items: [],
        labour_service_line_items: [
          { labour_description: 'Cursor Pro (Jul 18–Aug 18, 2026)', labour_charges: 20.00, tax_percentage: 18 },
        ],
        totals_and_tax_summary: {
          labour_total: 20.00,
          labour_igst_rate: 18,
          labour_igst_amount: 3.60,
          sub_total_calculated: 20.00,
          grand_total_invoice: 23.60,
        },
        confidence: 0.95,
      }}]},
    });
    const r = structureFromLlmResponse(json, '');
    expect(r.parsedData).toBeTruthy();
    expect(r.parsedData!.company_name).toBe('Anysphere, Inc.');
    expect(r.parsedData!.labour_service_line_items?.length).toBe(1);
    expect(r.parsedData!.labour_service_line_items![0].labour_description).toContain('Cursor Pro');
    expect(r.parsedData!.totals_and_tax_summary?.grand_total_invoice).toBe(23.60);
  });

  it('parses general services invoice', () => {
    const json = JSON.stringify({
      output: { entries: [{ parsed_data: {
        company_name: 'ABC Consulting',
        invoice_number: 'INV-2026-100',
        invoice_date: '15/07/2026',
        parts_line_items: [],
        labour_service_line_items: [
          { labour_description: 'Consulting — 40 hrs', labour_charges: 4000.00 },
          { labour_description: 'Travel reimbursement', labour_charges: 500.00 },
        ],
        totals_and_tax_summary: {
          labour_total: 4500.00,
          sub_total_calculated: 4500.00,
          grand_total_invoice: 4500.00,
        },
        confidence: 0.90,
      }}]},
    });
    const r = structureFromLlmResponse(json, '');
    expect(r.parsedData).toBeTruthy();
    expect(r.parsedData!.labour_service_line_items?.length).toBe(2);
    expect(r.parsedData!.totals_and_tax_summary?.grand_total_invoice).toBe(4500.00);
  });

  it('strips junk company_name "Invoice" even without markdown (single mode)', () => {
    const json = JSON.stringify({
      output: { entries: [{ parsed_data: {
        company_name: 'Invoice',
        invoice_number: 'E3TSVYGG-0003',
        labour_service_line_items: [
          { labour_description: 'Cursor Pro', labour_charges: 20, tax_percentage: 18 },
        ],
        totals_and_tax_summary: { grand_total_invoice: 23.60 },
        confidence: 0.9,
      }}]},
    });
    const r = structureFromLlmResponse(json, '');
    expect(r.parsedData).toBeTruthy();
    expect(r.parsedData!.company_name).toBeNull();
    expect(r.parsedData!.invoice_number).toBe('E3TSVYGG-0003');
  });

  it('strips raw JSON blob dumped into company_name', () => {
    const blob = '{"output":{"entries":[{"parsed_data":{"company_name":"Anysphere, Inc."}}]}}';
    const json = JSON.stringify({
      output: { entries: [{ parsed_data: {
        company_name: blob,
        invoice_number: 'E3TSVYGG-0003',
        confidence: 0.5,
      }}]},
    });
    const r = structureFromLlmResponse(json, '');
    expect(r.parsedData).toBeTruthy();
    expect(r.parsedData!.company_name).toBeNull();
  });

  it('parses Gemini shortcut shape: output as array (not entries)', () => {
    // gemini-3.5 often returns {"output":[{parsed_data:...}]} instead of output.entries
    const json = JSON.stringify({
      output: [{
        parsed_data: {
          irn: '13cc66de362ae600dc2125074a2b3f6094f476d6bb8763d7848787ffd7667257',
          gstin: '07AADCT1023C1Z1',
          company_name: 'THIRTY SIX AUTOMOBILES PVT. LTD.',
          invoice_number: 'TXD25-04437(Cash)',
          invoice_date: '16/09/2025',
          invoice_time: '14:19:00',
          parts_line_items: [],
          labour_service_line_items: [
            { labour_description: 'Labour', labour_charges: 1000, tax_percentage: 18 },
          ],
          totals_and_tax_summary: { grand_total_invoice: 1180 },
          confidence: 0.95,
        },
      }],
    });
    const r = structureFromLlmResponse(json, '');
    expect(r.parsedData).toBeTruthy();
    expect(r.parsedData!.company_name).toBe('THIRTY SIX AUTOMOBILES PVT. LTD.');
    expect(r.parsedData!.gstin).toBe('07AADCT1023C1Z1');
    expect(r.parsedData!.invoice_number).toBe('TXD25-04437(Cash)');
  });

  it('parses flat parsed_data at root', () => {
    const json = JSON.stringify({
      parsed_data: {
        company_name: 'Flat Co',
        gstin: '27AAAAA0000A1Z5',
        confidence: 0.8,
      },
    });
    const r = structureFromLlmResponse(json, '');
    expect(r.parsedData!.company_name).toBe('Flat Co');
  });

  it('returns null for invalid JSON', () => {
    const r = structureFromLlmResponse('this is not json', '');
    expect(r.parsedData).toBeNull();
  });
});
