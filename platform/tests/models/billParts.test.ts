import { describe, it, expect } from 'vitest';
import { extractPartsFromParsed } from '../../src/models/billParts.js';
import type { ParsedInvoiceData } from '../../src/models/types.js';

describe('extractPartsFromParsed', () => {
  const BILL_ID = 'test-bill-001';

  it('extracts parts line items as PART type', () => {
    const parsed: ParsedInvoiceData = {
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
        {
          rate: 33.9,
          quantity: 3,
          hsn_sac_code: '34029099',
          tax_percentage: 18,
          taxable_amount: 101.7,
          item_name_description: 'Solvent-Wdo Clnr',
          part_number_item_code: '23642790',
        },
      ],
      labour_service_line_items: [],
    };

    const parts = extractPartsFromParsed(BILL_ID, parsed);
    expect(parts).toHaveLength(2);
    expect(parts[0].line_type).toBe('PART');
    expect(parts[0].bill_id).toBe(BILL_ID);
    expect(parts[0].name).toBe('FILTER-POLLEN');
    expect(parts[0].rate).toBe(423.73);
    expect(parts[0].quantity).toBe(1);
    expect(parts[0].hsn_sac_code).toBe('84212300');
    expect(parts[0].part_number).toBe('11668822');
  });

  it('extracts labour line items as LABOUR type', () => {
    const parsed: ParsedInvoiceData = {
      parts_line_items: [],
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

    const parts = extractPartsFromParsed(BILL_ID, parsed);
    expect(parts).toHaveLength(1);
    expect(parts[0].line_type).toBe('LABOUR');
    expect(parts[0].name).toBe('Paid Service/60000 KM EV');
    expect(parts[0].rate).toBe(2700);
    expect(parts[0].amount).toBe(2700);
    expect(parts[0].quantity).toBe(1);
    expect(parts[0].hsn_sac_code).toBe('998729');
    expect(parts[0].part_number).toBe('EV4PM60');
  });

  it('handles mixed parts and labour', () => {
    const parsed: ParsedInvoiceData = {
      parts_line_items: [
        { rate: 100, quantity: 2, item_name_description: 'Part A' },
      ],
      labour_service_line_items: [
        { labour_charges: 500, labour_description: 'Labour A' },
        { labour_charges: 300, labour_description: 'Labour B' },
      ],
    };

    const parts = extractPartsFromParsed(BILL_ID, parsed);
    expect(parts).toHaveLength(3);
    const types = parts.map((p) => p.line_type);
    expect(types).toEqual(['PART', 'LABOUR', 'LABOUR']);
  });

  it('returns empty array for empty parsed data', () => {
    const parts = extractPartsFromParsed(BILL_ID, {});
    expect(parts).toEqual([]);
  });

  it('generates unique part_id for each item', () => {
    const parsed: ParsedInvoiceData = {
      parts_line_items: [
        { rate: 100, quantity: 1, item_name_description: 'A' },
        { rate: 200, quantity: 1, item_name_description: 'B' },
      ],
    };

    const parts = extractPartsFromParsed(BILL_ID, parsed);
    expect(parts[0].part_id).not.toBe(parts[1].part_id);
  });

  it('sets created_at timestamp', () => {
    const parsed: ParsedInvoiceData = {
      parts_line_items: [{ rate: 100, quantity: 1, item_name_description: 'A' }],
    };
    const parts = extractPartsFromParsed(BILL_ID, parsed);
    expect(parts[0].created_at).toBeDefined();
    expect(new Date(parts[0].created_at).getTime()).toBeGreaterThan(0);
  });
});
