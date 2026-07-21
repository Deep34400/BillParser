import { describe, it, expect } from 'vitest';
import { extractVendorFields } from '../../src/vendor/vendorMapper.js';
import type { ParsedInvoiceData } from '../../src/shared/types.js';

describe('extractVendorFields', () => {
  it('extracts all available vendor fields from parsed invoice', () => {
    const parsed: ParsedInvoiceData = {
      company_name: 'VIPUL MOTORS PVT. LTD.',
      gstin: '09AABCV0931B1ZS',
      pan: 'AABCV0931B',
      invoice_date: '25/06/2026',
    };

    const fields = extractVendorFields(parsed);
    expect(fields.legal_name).toBe('VIPUL MOTORS PVT. LTD.');
    expect(fields.display_name).toBe('VIPUL MOTORS PVT. LTD.');
    expect(fields.gstin).toBe('09AABCV0931B1ZS');
    expect(fields.pan).toBe('AABCV0931B');
  });

  it('returns null fields when parsed data is empty', () => {
    const fields = extractVendorFields({});
    expect(fields.legal_name).toBeNull();
    expect(fields.gstin).toBeNull();
    expect(fields.pan).toBeNull();
  });

  it('trims whitespace from company name', () => {
    const parsed: ParsedInvoiceData = {
      company_name: '  Kataria Automobiles  ',
      gstin: '07AABCK1234L1ZX',
    };

    const fields = extractVendorFields(parsed);
    expect(fields.legal_name).toBe('Kataria Automobiles');
    expect(fields.display_name).toBe('Kataria Automobiles');
  });

  it('derives PAN from GSTIN when PAN is missing', () => {
    const parsed: ParsedInvoiceData = {
      company_name: 'Some Dealer',
      gstin: '07AABCK1234L1ZX',
    };

    const fields = extractVendorFields(parsed);
    expect(fields.pan).toBe('AABCK1234L');
  });

  it('does not derive PAN from invalid GSTIN', () => {
    const parsed: ParsedInvoiceData = {
      company_name: 'Some Dealer',
      gstin: 'INVALID',
    };

    const fields = extractVendorFields(parsed);
    expect(fields.pan).toBeNull();
  });

  it('returns hasIdentifier=true when GSTIN exists', () => {
    const fields = extractVendorFields({ gstin: '09AABCV0931B1ZS' });
    expect(fields.hasIdentifier).toBe(true);
  });

  it('returns hasIdentifier=true when only company_name exists', () => {
    const fields = extractVendorFields({ company_name: 'Some Vendor' });
    expect(fields.hasIdentifier).toBe(true);
  });

  it('returns hasIdentifier=false when nothing useful exists', () => {
    const fields = extractVendorFields({});
    expect(fields.hasIdentifier).toBe(false);
  });
});
