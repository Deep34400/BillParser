import { describe, it, expect } from 'vitest';
import { structureFromLlmResponse } from '../../../src/ocr/parser/parser.js';
import { enrichParsedInvoice } from '../../../src/ocr/transformer/normalize/index.js';

/** Real Gemini single-mode raw_ocr from sync API (correct vendor inside JSON + trailing garbage). */
const THIRTY_SIX_RAW = `{"output":{"entries":[{"parsed_data":{"irn":null,"pan":"AADCT1023C","gstin":"07AADCT1023C1Z1","company_name":"THIRTY SIX AUTOMOBILES PVT. LTD.","invoice_number":"GSJ26-05556","invoice_date":"02/07/2026","invoice_time":"11:44:00","service_details":{"last_service":"16/04/2026","service_type":"Customer (2.5)","next_service_due":"10000 KM OR 12 MONTHS WHICHEVER IS EARLIER"},"vehicle_details":{"chassis_number":"MBJUYMK1SRL105165","registration_number":"HR55AV4047","mileage_odometer_reading":78816},"parts_line_items":[{"item_name_description":"WINDSHIELD WASHER FLUID","part_number_item_code":"A-08808-80210","hsn_sac_code":"34029099","quantity":3,"rate":42.0,"taxable_amount":126.0,"tax_percentage":null}],"labour_service_line_items":[{"labour_description":"80,000 KM SERVICE - INSP","labour_code":"80000","hsn_sac_code":"998729","labour_charges":3625.0,"tax_percentage":null}],"totals_and_tax_summary":{"parts_total":5225.55,"labour_total":3625.0,"parts_discount":null,"labour_discount":null,"parts_cgst_rate":null,"parts_sgst_rate":null,"parts_igst_rate":null,"parts_cgst_amount":null,"parts_sgst_amount":null,"parts_igst_amount":null,"labour_cgst_rate":null,"labour_sgst_rate":null,"labour_igst_rate":null,"labour_cgst_amount":null,"labour_sgst_amount":null,"labour_igst_amount":null,"sub_total_calculated":8850.55,"grand_total_invoice":10443.65,"deductibles":null,"salvage":null},"confidence":0.95}]}}
      }}]}}`;

describe('single-mode sync: do not corrupt vendor when rawOcr is JSON', () => {
  it('parses company_name + gstin + pan from Gemini JSON', () => {
    const { parsedData, error } = structureFromLlmResponse(THIRTY_SIX_RAW, '');
    expect(error).toBeUndefined();
    expect(parsedData?.company_name).toBe('THIRTY SIX AUTOMOBILES PVT. LTD.');
    expect(parsedData?.gstin).toBe('07AADCT1023C1Z1');
    expect(parsedData?.pan).toBe('AADCT1023C');
  });

  it('enrich with JSON rawOcr (sync API bug) must KEEP vendor fields', () => {
    const { parsedData } = structureFromLlmResponse(THIRTY_SIX_RAW, '');
    expect(parsedData).toBeTruthy();
    // This is what /api/ocr/sync does today: enrichParsedInvoice(parsed, rawOcr)
    const enriched = enrichParsedInvoice(parsedData!, THIRTY_SIX_RAW);
    expect(enriched.company_name).toBe('THIRTY SIX AUTOMOBILES PVT. LTD.');
    expect(enriched.gstin).toBe('07AADCT1023C1Z1');
    expect(enriched.pan).toBe('AADCT1023C');
    expect(enriched.company_name).not.toMatch(/[{}\]]/);
  });
});
