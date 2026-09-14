import { describe, expect, it } from 'vitest';
import { validateAiPairs, validateSummaryClaims } from '../../../src/ocr/compare/validateAiPairs.js';
import { buildMismatches } from '../../../src/ocr/compare/mismatches.js';
import { diffParsedInvoices } from '../../../src/ocr/compare/diffInvoices.js';
import type { NamedLine } from '../../../src/ocr/compare/matchLines.js';
import type { ParsedInvoiceData } from '../../../src/shared/types.js';

function line(name: string, amount: number): NamedLine {
  return { key: name, name, code: null, amount, qty: 1, rate: amount, hsn: null, tax: null };
}

describe('validate AI compare pairs', () => {
  it('keeps a leftover synonym when amounts are close', () => {
    const result = validateAiPairs(
      [line('Brake pad', 1700)],
      [line('pads', 1840)],
      [{ group: 'parts', a: 0, b: 0, confidence: 0.9 }],
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('drops a reused leftover index', () => {
    const result = validateAiPairs(
      [line('Brake pad', 100), line('Oil', 40)],
      [line('pads', 110), line('filter', 40)],
      [
        { group: 'parts', a: 0, b: 0, confidence: 0.9 },
        { group: 'parts', a: 1, b: 0, confidence: 0.8 },
      ],
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected[0]?.reason).toMatch(/reused/i);
  });

  it('drops a pair when money differs a lot and names do not overlap', () => {
    const result = validateAiPairs(
      [line('Engine oil', 200)],
      [line('Wiper', 900)],
      [{ group: 'parts', a: 0, b: 0, confidence: 0.95 }],
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/Amounts differ/);
  });

  it('rejects a summary that invents a missing part', () => {
    const checked = validateSummaryClaims(
      { missing: ['Turbo charger'] },
      ['Air filter'],
      [],
      [],
    );
    expect(checked.ok).toBe(false);
    expect(checked.issues[0]).toMatch(/Turbo charger/);
  });

  it('lists header, total, and line mismatches for the user checklist', () => {
    const a: ParsedInvoiceData = {
      company_name: 'Apex',
      invoice_number: 'A-1',
      parts_line_items: [{ item_name_description: 'Oil filter', taxable_amount: 423 }],
      totals_and_tax_summary: { grand_total_invoice: 1000 },
    };
    const b: ParsedInvoiceData = {
      company_name: 'Apex',
      invoice_number: 'B-1',
      parts_line_items: [{ item_name_description: 'Wiper', taxable_amount: 350 }],
      totals_and_tax_summary: { grand_total_invoice: 1200 },
    };
    const diff = diffParsedInvoices(a, b, { source: 'json' });
    diff.validation.rejectedAi = [{ a: 'pads', b: 'oil', reason: 'AI confidence below 0.6', confidence: 0.4 }];
    const rows = buildMismatches(diff);
    expect(rows.some((r) => r.kind === 'header' && r.label === 'invoice number')).toBe(true);
    expect(rows.some((r) => r.kind === 'total')).toBe(true);
    expect(rows.some((r) => r.kind === 'missing')).toBe(true);
    expect(rows.some((r) => r.kind === 'extra')).toBe(true);
    expect(rows.some((r) => r.kind === 'rejected_ai')).toBe(true);
  });
});
