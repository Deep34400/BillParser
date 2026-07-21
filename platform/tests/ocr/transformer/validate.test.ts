import { describe, expect, it } from 'vitest';
import { validateParsedInvoice, hasValidationErrors } from '../../../src/ocr/transformer/validate.js';
import type { ParsedInvoiceData } from '../../../src/ocr/types/invoice.js';

function base(overrides: Partial<ParsedInvoiceData> = {}): ParsedInvoiceData {
  return {
    company_name: 'VIPUL MOTORS PVT. LTD.',
    gstin: '09AABCV0931B1ZS',
    pan: 'AABCV0931B',
    invoice_number: 'INV-1001',
    invoice_date: '15/01/2025',
    vehicle_details: { registration_number: 'HR55AV4047' },
    parts_line_items: [{ quantity: 2, rate: 100, taxable_amount: 200, tax_percentage: 18, hsn_sac_code: '87089900' }],
    labour_service_line_items: [{ labour_description: 'Service', labour_charges: 500, tax_percentage: 18, hsn_sac_code: '998729' }],
    totals_and_tax_summary: {
      parts_total: 200,
      labour_total: 500,
      parts_cgst_rate: 9,
      parts_sgst_rate: 9,
      parts_cgst_amount: 18,
      parts_sgst_amount: 18,
      labour_cgst_rate: 9,
      labour_sgst_rate: 9,
      labour_cgst_amount: 45,
      labour_sgst_amount: 45,
      sub_total_calculated: 826,
      grand_total_invoice: 826,
    },
    confidence: 0.9,
    ...overrides,
  };
}

function paths(data: ParsedInvoiceData, markdown?: string): string[] {
  return validateParsedInvoice(data, markdown).map((i) => i.path);
}

function messages(data: ParsedInvoiceData, markdown?: string): string[] {
  return validateParsedInvoice(data, markdown).map((i) => i.message);
}

describe('validateParsedInvoice — existing rules still work', () => {
  it('keeps combined missing company/invoice/gstin warning', () => {
    const issues = validateParsedInvoice(base({
      company_name: null,
      invoice_number: null,
      gstin: null,
      parts_line_items: [{ taxable_amount: 10 }],
      labour_service_line_items: [],
    }));
    expect(issues.some((i) => i.message.includes('Missing company_name, invoice_number, and gstin'))).toBe(true);
  });

  it('keeps GSTIN format warning', () => {
    expect(messages(base({ gstin: 'BAD' })).some((m) => /GSTIN format/i.test(m))).toBe(true);
  });

  it('keeps both CGST and IGST amounts warning', () => {
    const data = base({
      totals_and_tax_summary: {
        parts_cgst_amount: 10,
        parts_igst_amount: 10,
        grand_total_invoice: 100,
      },
    });
    expect(messages(data).some((m) => /Both CGST\/SGST and IGST/i.test(m))).toBe(true);
  });

  it('hasValidationErrors is true only for error severity', () => {
    const issues = validateParsedInvoice(base({ confidence: 1.5 }));
    expect(hasValidationErrors(issues)).toBe(true);
  });
});

describe('Document Validation', () => {
  it('warns when company_name is missing', () => {
    expect(paths(base({ company_name: null })).includes('parsed_data.company_name')).toBe(true);
  });

  it('warns when invoice_number is missing', () => {
    expect(paths(base({ invoice_number: null })).includes('parsed_data.invoice_number')).toBe(true);
  });

  it('warns when invoice_date is missing', () => {
    expect(paths(base({ invoice_date: null })).includes('parsed_data.invoice_date')).toBe(true);
  });

  it('warns when GSTIN is missing', () => {
    expect(paths(base({ gstin: null })).includes('parsed_data.gstin')).toBe(true);
  });

  it('warns when vehicle registration is missing', () => {
    expect(paths(base({ vehicle_details: {} })).includes('parsed_data.vehicle_details.registration_number')).toBe(true);
  });

  it('warns when no line items exist', () => {
    const data = base({ parts_line_items: [], labour_service_line_items: [] });
    expect(messages(data).some((m) => /No parts or labour/i.test(m))).toBe(true);
  });
});

describe('GST Validation — rates on parts and labour', () => {
  it('warns on invalid GST line tax_percentage (not 0/3/5/12/18/28)', () => {
    const data = base({
      parts_line_items: [{ quantity: 1, rate: 100, taxable_amount: 100, tax_percentage: 9 }],
    });
    expect(messages(data).some((m) => /valid Indian GST rates/i.test(m))).toBe(true);
  });

  it('accepts valid Indian GST rates on line items', () => {
    for (const rate of [0, 3, 5, 12, 18, 28]) {
      const data = base({
        parts_line_items: [{ quantity: 1, rate: 100, taxable_amount: 100, tax_percentage: rate }],
      });
      expect(messages(data).some((m) => /valid Indian GST rates/i.test(m))).toBe(false);
    }
  });

  it('warns when parts CGST rate != SGST rate', () => {
    const data = base({
      totals_and_tax_summary: {
        parts_total: 200,
        parts_cgst_rate: 9,
        parts_sgst_rate: 6,
        parts_cgst_amount: 18,
        parts_sgst_amount: 12,
        grand_total_invoice: 230,
      },
    });
    expect(messages(data).some((m) => /CGST.*SGST|CGST == SGST/i.test(m))).toBe(true);
  });

  it('warns when labour CGST amount != SGST amount', () => {
    const data = base({
      totals_and_tax_summary: {
        labour_total: 500,
        labour_cgst_rate: 9,
        labour_sgst_rate: 9,
        labour_cgst_amount: 45,
        labour_sgst_amount: 40,
        grand_total_invoice: 585,
      },
    });
    expect(messages(data).some((m) => /CGST.*SGST|CGST == SGST/i.test(m))).toBe(true);
  });

  it('warns when footer GST rate is not a valid Indian rate (parts_igst_rate)', () => {
    const data = base({
      totals_and_tax_summary: {
        parts_total: 200,
        parts_igst_rate: 9,
        parts_igst_amount: 18,
        parts_cgst_rate: null,
        parts_sgst_rate: null,
        parts_cgst_amount: null,
        parts_sgst_amount: null,
        grand_total_invoice: 218,
      },
    });
    expect(messages(data).some((m) => /parts_igst_rate|valid Indian GST/i.test(m))).toBe(true);
  });

  it('warns when GST rate exists but amount is missing (parts_cgst)', () => {
    const data = base({
      totals_and_tax_summary: {
        parts_total: 200,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        parts_cgst_amount: null,
        parts_sgst_amount: 18,
        grand_total_invoice: 218,
      },
    });
    expect(paths(data).some((p) => p.includes('parts_cgst_amount'))).toBe(true);
  });
});

describe('GST Amount Validation', () => {
  it('warns when footer GST amount differs from taxable × rate beyond ₹1', () => {
    const data = base({
      totals_and_tax_summary: {
        parts_total: 200,
        parts_discount: 0,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        parts_cgst_amount: 50, // expected 18
        parts_sgst_amount: 18,
        labour_total: 0,
        grand_total_invoice: 268,
      },
      labour_service_line_items: [],
    });
    expect(messages(data).some((m) => /expected.*GST|GST amount/i.test(m))).toBe(true);
  });

  it('allows ₹1 tolerance on GST amount', () => {
    const data = base({
      parts_line_items: [{ quantity: 1, rate: 100, taxable_amount: 100, tax_percentage: 18 }],
      labour_service_line_items: [],
      totals_and_tax_summary: {
        parts_total: 100,
        parts_cgst_rate: 9,
        parts_sgst_rate: 9,
        parts_cgst_amount: 9.5, // expected 9 — within ₹1
        parts_sgst_amount: 9,
        labour_total: 0,
        grand_total_invoice: 118.5,
        sub_total_calculated: 118.5,
      },
    });
    expect(messages(data).some((m) => /expected.*GST|GST amount mismatch/i.test(m))).toBe(false);
  });
});

describe('Amount Validation', () => {
  it('warns when quantity × rate ≠ taxable_amount', () => {
    const data = base({
      parts_line_items: [{ quantity: 2, rate: 100, taxable_amount: 250, tax_percentage: 18 }],
    });
    expect(messages(data).some((m) => /taxable_amount.*quantity × rate/i.test(m))).toBe(true);
  });

  it('warns when parts_total ≠ sum of parts', () => {
    const data = base({
      parts_line_items: [{ quantity: 1, rate: 100, taxable_amount: 100, tax_percentage: 18 }],
      totals_and_tax_summary: { parts_total: 500, labour_total: 0, grand_total_invoice: 500 },
      labour_service_line_items: [],
    });
    expect(messages(data).some((m) => /parts_total/i.test(m))).toBe(true);
  });

  it('warns when discount exceeds subtotal', () => {
    const data = base({
      totals_and_tax_summary: {
        parts_total: 100,
        parts_discount: 150,
        labour_total: 0,
        grand_total_invoice: 0,
      },
      labour_service_line_items: [],
    });
    expect(messages(data).some((m) => /discount.*exceed/i.test(m))).toBe(true);
  });

  it('warns on negative monetary values', () => {
    const data = base({
      totals_and_tax_summary: {
        parts_total: -10,
        grand_total_invoice: 100,
      },
    });
    expect(messages(data).some((m) => /negative/i.test(m))).toBe(true);
  });

  it('warns when grand total < subtotal without enough discount', () => {
    const data = base({
      totals_and_tax_summary: {
        parts_total: 200,
        labour_total: 500,
        parts_discount: 0,
        labour_discount: 0,
        sub_total_calculated: 700,
        grand_total_invoice: 100,
      },
    });
    expect(messages(data).some((m) => /grand_total|smaller than subtotal/i.test(m))).toBe(true);
  });
});

describe('Invoice Date Validation', () => {
  it('warns when invoice date is in the future', () => {
    const data = base({ invoice_date: '01/01/2099' });
    expect(messages(data).some((m) => /future/i.test(m))).toBe(true);
  });

  it('warns when invoice date is obviously invalid', () => {
    const data = base({ invoice_date: '99/99/9999' });
    expect(messages(data).some((m) => /invalid.*date|date.*invalid/i.test(m))).toBe(true);
  });
});

describe('Vehicle Validation', () => {
  it('warns when registration number format is invalid', () => {
    const data = base({
      vehicle_details: { registration_number: 'NOT-A-PLATE' },
    });
    expect(messages(data).some((m) => /registration/i.test(m))).toBe(true);
  });

  it('accepts a valid Indian registration', () => {
    const data = base({
      vehicle_details: { registration_number: 'MH01FE2778' },
    });
    expect(messages(data).some((m) => /registration.*invalid/i.test(m))).toBe(false);
  });
});

describe('HSN/SAC Validation', () => {
  it('warns when HSN looks like a tax rate', () => {
    const data = base({
      parts_line_items: [{ taxable_amount: 100, hsn_sac_code: '18' }],
    });
    expect(messages(data).some((m) => /HSN\/SAC looks like a tax rate/i.test(m))).toBe(true);
  });

  it('warns when HSN length is not 4/6/8 digits', () => {
    const data = base({
      parts_line_items: [{ taxable_amount: 100, hsn_sac_code: '12345' }],
    });
    expect(messages(data).some((m) => /HSN\/SAC.*4, 6, or 8/i.test(m))).toBe(true);
  });
});

describe('Line Item Validation', () => {
  it('warns on negative parts quantity/rate/taxable', () => {
    const data = base({
      parts_line_items: [{ quantity: -1, rate: -5, taxable_amount: -10 }],
    });
    const msgs = messages(data);
    expect(msgs.some((m) => /negative/i.test(m))).toBe(true);
  });

  it('warns when quantity is zero but rate exists', () => {
    const data = base({
      parts_line_items: [{ quantity: 0, rate: 100, taxable_amount: 0 }],
    });
    expect(messages(data).some((m) => /quantity.*zero/i.test(m))).toBe(true);
  });

  it('warns when labour charges are negative', () => {
    const data = base({
      labour_service_line_items: [{ labour_description: 'X', labour_charges: -50 }],
    });
    expect(messages(data).some((m) => /negative/i.test(m))).toBe(true);
  });

  it('warns when labour charges are missing', () => {
    const data = base({
      labour_service_line_items: [{ labour_description: 'X', labour_charges: null }],
    });
    expect(messages(data).some((m) => /missing labour_charges/i.test(m))).toBe(true);
  });
});

describe('Confidence Validation', () => {
  it('errors when confidence is outside 0..1', () => {
    const issues = validateParsedInvoice(base({ confidence: 2 }));
    expect(issues.some((i) => i.path === 'parsed_data.confidence' && i.severity === 'error')).toBe(true);
  });
});

describe('OCR Consistency Validation', () => {
  it('warns when GSTIN is not found in markdown', () => {
    const md = 'Tax Invoice\nCompany XYZ\nInvoice No INV-1001\nReg HR55AV4047';
    const data = base({ gstin: '09AABCV0931B1ZS', confidence: 0.95 });
    expect(messages(data, md).some((m) => /GSTIN.*not found in OCR/i.test(m))).toBe(true);
  });

  it('warns when invoice number is not found in markdown', () => {
    const md = 'Tax Invoice GSTIN 09AABCV0931B1ZS Reg HR55AV4047';
    expect(messages(base({ confidence: 0.95 }), md).some((m) => /invoice.?number.*not found in OCR/i.test(m))).toBe(true);
  });

  it('warns when vehicle registration is not found in markdown', () => {
    const md = 'Tax Invoice GSTIN 09AABCV0931B1ZS Invoice No INV-1001';
    expect(messages(base({ confidence: 0.95 }), md).some((m) => /registration.*not found in OCR/i.test(m))).toBe(true);
  });
});

describe('read-only contract', () => {
  it('does not mutate ParsedInvoiceData', () => {
    const data = base({
      totals_and_tax_summary: {
        parts_total: 200,
        parts_cgst_rate: 9,
        parts_cgst_amount: null,
        grand_total_invoice: 200,
      },
    });
    const before = JSON.stringify(data);
    validateParsedInvoice(data);
    expect(JSON.stringify(data)).toBe(before);
  });
});
