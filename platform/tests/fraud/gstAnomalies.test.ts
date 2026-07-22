import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/fraud/repository.js', () => ({
  fetchCompletedBills: vi.fn(),
  fetchAllParts: vi.fn(),
}));

import { detectGstAnomalies } from '../../src/fraud/service.js';
import { fetchCompletedBills } from '../../src/fraud/repository.js';
import type { BillDoc } from '../../src/shared/types.js';

const mockedFetch = vi.mocked(fetchCompletedBills);

function toyotaBill(): BillDoc {
  return {
    bill_id: 'toyota-txg25-14415',
    bill_type: 'MAINTENANCE',
    ocr_status: 'OCR_COMPLETED',
    schema_version: 1,
    invoice_number: 'TXG25-14415',
    vendor_name: 'MGF TOYOTA CAPITAL VEHICLES SALES LTD.',
    parts_amount: 286.44,
    labour_amount: 54.92,
    parts_igst_rate: 18,
    labour_igst_rate: 18,
    parts_igst_amount: 51.56,
    labour_igst_amount: 9.89,
    grand_total_amount: 403,
    parsed_data: {
      totals_and_tax_summary: {
        parts_total: 286.44,
        labour_total: 54.92,
        parts_discount: 21.56,
        labour_discount: 29.58,
        parts_igst_rate: 18,
        labour_igst_rate: 18,
        parts_igst_amount: 51.56,
        labour_igst_amount: 9.89,
        sub_total_calculated: 341.36,
        grand_total_invoice: 403,
      },
    },
    created_at: '2025-11-29T00:00:00Z',
    updated_at: '2025-11-29T00:00:00Z',
  } as BillDoc;
}

/** Style B: parts_total is pre-discount line sum; GST = (total − discount) × rate */
function carrumBill(): BillDoc {
  return {
    bill_id: 'carrum-15-br-25002444',
    bill_type: 'MAINTENANCE',
    ocr_status: 'OCR_COMPLETED',
    schema_version: 1,
    invoice_number: '15/BR/25002444',
    vendor_name: 'CARRUMMOBILITY SOLUTIONS PRIVATELIMITED',
    parts_amount: 3122.39,
    labour_amount: 2961.02,
    parts_cgst_rate: 9,
    parts_sgst_rate: 9,
    parts_cgst_amount: 252.92,
    parts_sgst_amount: 252.92,
    labour_cgst_rate: 9,
    labour_sgst_rate: 9,
    labour_cgst_amount: 151.25,
    labour_sgst_amount: 151.25,
    grand_total_amount: 5299,
    parsed_data: {
      totals_and_tax_summary: {
        parts_total: 3122.39,
        labour_total: 2961.02,
        parts_discount: 312.25,
        labour_discount: 1280.51,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        parts_cgst_amount: 252.92,
        parts_sgst_amount: 252.92,
        labour_cgst_rate: 9,
        labour_sgst_rate: 9,
        labour_cgst_amount: 151.25,
        labour_sgst_amount: 151.25,
        sub_total_calculated: 6083.41,
        grand_total_invoice: 5299,
      },
    },
    created_at: '2025-10-09T00:00:00Z',
    updated_at: '2025-10-09T00:00:00Z',
  } as BillDoc;
}

describe('detectGstAnomalies', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it('does NOT flag Toyota invoice where amount is already post-discount (style A)', async () => {
    // 286.44 × 18% = 51.56 — discount must NOT be required
    mockedFetch.mockResolvedValue([toyotaBill()]);
    expect(await detectGstAnomalies()).toEqual([]);
  });

  it('does NOT flag Carrum invoice where GST is on (amount − discount) (style B)', async () => {
    // Parts: (3122.39 − 312.25) × 18% = 505.84 = 252.92+252.92
    // Labour: (2961.02 − 1280.51) × 18% = 302.50 = 151.25+151.25
    mockedFetch.mockResolvedValue([carrumBill()]);
    expect(await detectGstAnomalies()).toEqual([]);
  });

  it('flags when GST amount matches neither style A nor style B', async () => {
    const bill = toyotaBill();
    bill.parts_igst_amount = 10; // wrong — neither 286.44×18% nor (286.44−21.56)×18%
    mockedFetch.mockResolvedValue([bill]);
    const alerts = await detectGstAnomalies();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('GST_MISMATCH');
    expect((alerts[0].details.issues as string[]).some((s) => s.includes('Parts'))).toBe(true);
  });

  it('flags CGST ≠ SGST rate on intra-state invoice', async () => {
    mockedFetch.mockResolvedValue([{
      ...toyotaBill(),
      parts_igst_rate: null,
      parts_igst_amount: null,
      labour_igst_rate: null,
      labour_igst_amount: null,
      parts_cgst_rate: 9,
      parts_sgst_rate: 5,
      parts_cgst_amount: 25,
      parts_sgst_amount: 14,
      labour_cgst_rate: null,
      labour_sgst_rate: null,
      labour_cgst_amount: null,
      labour_sgst_amount: null,
      parsed_data: {
        totals_and_tax_summary: {
          parts_total: 286.44,
          labour_total: 0,
          parts_discount: 21.56,
          parts_cgst_rate: 9,
          parts_sgst_rate: 5,
          parts_cgst_amount: 25,
          parts_sgst_amount: 14,
        },
      },
    } as BillDoc]);

    const alerts = await detectGstAnomalies();
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const issues = alerts[0].details.issues as string[];
    expect(issues.some((s) => s.includes('CGST rate') && s.includes('SGST rate'))).toBe(true);
  });
});
