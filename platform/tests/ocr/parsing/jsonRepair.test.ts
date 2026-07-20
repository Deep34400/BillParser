import { describe, it, expect } from 'vitest';
import { prepareLlmJsonWithRepair, repairTruncatedJson } from '../../../src/ocr/parsing/coerce.js';
import { structureFromLlmResponse } from '../../../src/ocr/parsing/index.js';

describe('repairTruncatedJson — Gemini malformed closings', () => {
  it('inserts missing } before ] (parsed_data closed too early)', () => {
    // Real Gemini-3.5 mistake: confidence then ] without closing parsed_data
    const broken =
      '{"output":{"entries":[{"parsed_data":{"company_name":"VIPUL MOTORS PVT. LTD.",' +
      '"gstin":"09AABCV0931B1ZS","invoice_number":null,"invoice_date":"25/06/2026",' +
      '"totals_and_tax_summary":{"parts_total":100,"labour_total":50,"salvage":null},' +
      '"confidence":0.95}]}}';

    expect(() => JSON.parse(broken)).toThrow();

    const repaired = repairTruncatedJson(broken);
    const obj = JSON.parse(repaired) as any;
    expect(obj.output.entries[0].parsed_data.company_name).toBe('VIPUL MOTORS PVT. LTD.');
    expect(obj.output.entries[0].parsed_data.confidence).toBe(0.95);
    expect(obj.output.entries[0].parsed_data.totals_and_tax_summary.parts_total).toBe(100);
  });

  it('closes truncated JSON at end of string', () => {
    const truncated = '{"output":{"entries":[{"parsed_data":{"company_name":"ABC","parts_line_items":[{"item_name_description":"Oil"';
    const repaired = repairTruncatedJson(truncated);
    const obj = JSON.parse(repaired) as any;
    expect(obj.output.entries[0].parsed_data.company_name).toBe('ABC');
  });

  it('structureFromLlmResponse recovers VIPUL-style broken JSON via repair', () => {
    const broken =
      '{"output":{"entries":[{"parsed_data":{"irn":null,"pan":null,"gstin":"09AABCV0931B1ZS",' +
      '"company_name":"VIPUL MOTORS PVT. LTD.","invoice_number":null,"invoice_date":"25/06/2026",' +
      '"invoice_time":"16:29:00","service_details":{"last_service":null,"service_type":"Periodic Maintenance Service","next_service_due":null},' +
      '"vehicle_details":{"chassis_number":null,"registration_number":"UP14XX1234","mileage_odometer_reading":null},' +
      '"parts_line_items":[],"labour_service_line_items":[{"labour_description":"PMS","labour_charges":500,"tax_percentage":18}],' +
      '"totals_and_tax_summary":{"parts_total":null,"labour_total":500,"parts_discount":null,"labour_discount":null,' +
      '"parts_cgst_rate":null,"parts_sgst_rate":null,"parts_igst_rate":null,"parts_cgst_amount":null,"parts_sgst_amount":null,' +
      '"parts_igst_amount":null,"labour_cgst_rate":9,"labour_sgst_rate":9,"labour_igst_rate":null,' +
      '"labour_cgst_amount":45,"labour_sgst_amount":45,"labour_igst_amount":null,' +
      '"sub_total_calculated":590,"grand_total_invoice":590,"deductibles":null,"salvage":null},' +
      '"confidence":0.95}]}}';

    const r = structureFromLlmResponse(broken, '');
    expect(r.parsedData).toBeTruthy();
    expect(r.parsedData!.company_name).toBe('VIPUL MOTORS PVT. LTD.');
    expect(r.parsedData!.gstin).toBe('09AABCV0931B1ZS');
    expect(r.parsedData!.confidence).toBe(0.95);
  });

  it('prepareLlmJsonWithRepair is idempotent on valid JSON', () => {
    const ok = '{"output":{"entries":[{"parsed_data":{"company_name":"X","confidence":0.9}}]}}';
    expect(JSON.parse(prepareLlmJsonWithRepair(ok))).toEqual(JSON.parse(ok));
  });
});
