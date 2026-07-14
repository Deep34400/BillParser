import { describe, expect, it } from 'vitest';
import {
  extractInvoiceDateFromMarkdown,
  normalizeInvoiceDateFields,
} from '../../src/billing/dateExtract.js';

describe('extractInvoiceDateFromMarkdown', () => {
  it('parses DD/MM/YYYY with time from "Date :" label', () => {
    expect(extractInvoiceDateFromMarkdown('Date : 26/08/2025 09:35:01')).toBe('26/08/2025');
  });

  it('prefers Invoice Date over Job Card Date', () => {
    const md = `
Job Card Date: 03/07/2025
Date : 26/08/2025 09:35:01
`;
    expect(extractInvoiceDateFromMarkdown(md)).toBe('26/08/2025');
  });
});

describe('normalizeInvoiceDateFields', () => {
  it('splits datetime in invoice_date into date + time', () => {
    const out = normalizeInvoiceDateFields({
      invoice_date: '26/08/2025 09:35:01',
      invoice_time: null,
    });
    expect(out.invoice_date).toBe('26/08/2025');
    expect(out.invoice_time).toBe('09:35:01');
  });

  it('falls back to markdown when invoice_date is missing', () => {
    const out = normalizeInvoiceDateFields(
      { invoice_date: null, invoice_time: null },
      'Date : 26/08/2025 09:35:01',
    );
    expect(out.invoice_date).toBe('26/08/2025');
    expect(out.invoice_time).toBe('09:35:01');
  });
});
