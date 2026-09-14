import { describe, expect, it } from 'vitest';
import { diffParsedInvoices } from '../../../src/ocr/compare/diffInvoices.js';
import { matchNamedLines, tokenOverlap, toPartLine } from '../../../src/ocr/compare/matchLines.js';
import { summarizeDiff } from '../../../src/ocr/compare/summarize.js';
import { parsePairs } from '../../../src/ocr/compare/aiMatch.js';
import { coerceCompareInvoice } from '../../../src/ocr/compare/normalizeJson.js';
import type { ParsedInvoiceData } from '../../../src/shared/types.js';

const a: ParsedInvoiceData = {
  company_name: 'Apex Motors',
  invoice_date: '2026-06-12',
  invoice_number: 'A-1',
  parts_line_items: [
    { item_name_description: 'Oil filter', rate: 423, quantity: 1, taxable_amount: 423 },
    { item_name_description: 'Brake pad', rate: 850, quantity: 2, taxable_amount: 1700 },
    { item_name_description: 'Air filter', rate: 210, quantity: 1, taxable_amount: 210 },
  ],
  totals_and_tax_summary: { parts_total: 2333, labour_total: 4000, grand_total_invoice: 18650 },
};

const b: ParsedInvoiceData = {
  company_name: 'Apex Motors',
  invoice_date: '2026-06-15',
  invoice_number: 'B-1',
  parts_line_items: [
    { item_name_description: 'Oil filter', rate: 423, quantity: 1, taxable_amount: 423 },
    { item_name_description: 'pads', rate: 920, quantity: 2, taxable_amount: 1840 },
    { item_name_description: 'Wiper blade', rate: 350, quantity: 1, taxable_amount: 350 },
  ],
  totals_and_tax_summary: { parts_total: 2613, labour_total: 4550, grand_total_invoice: 19200 },
};

describe('compare engine', () => {
  it('matches exact names and leaves brake pad vs pads unmatched', () => {
    const parts = matchNamedLines(
      (a.parts_line_items ?? []).map(toPartLine),
      (b.parts_line_items ?? []).map(toPartLine),
    );
    expect(parts.lines.some((l) => l.a === 'Oil filter' && l.status === 'match')).toBe(true);
    expect(parts.leftoverA.map((l) => l.name)).toContain('Brake pad');
    expect(parts.leftoverB.map((l) => l.name)).toContain('pads');
    expect(tokenOverlap('brake pad', 'pads')).toBe(0);
  });

  it('fuzzy-matches overlapping tokens when amounts are close', () => {
    const parts = matchNamedLines(
      [{ item_name_description: 'front brake pad', rate: 850, taxable_amount: 850 }].map(toPartLine),
      [{ item_name_description: 'brake pad', rate: 860, taxable_amount: 860 }].map(toPartLine),
    );
    expect(parts.lines[0]?.how).toBe('fuzzy');
    expect(parts.leftoverA).toHaveLength(0);
  });

  it('reports total delta and missing/extra lines', () => {
    const diff = diffParsedInvoices(a, b, { source: 'json' });
    const grand = diff.totals.find((f) => f.field === 'grand_total_invoice');
    expect(grand?.delta).toBe(550);
    expect(diff.counts.missing).toBe(2);
    expect(diff.counts.extra).toBe(2);
    expect(summarizeDiff(diff)).toMatch(/550/);
  });

  it('applies AI leftover pairs without changing money math', () => {
    const diff = diffParsedInvoices(a, b, {
      source: 'json',
      aiPairs: [{ group: 'parts', a: 0, b: 0, confidence: 0.9 }],
    });
    const paired = diff.parts.find((l) => l.how === 'ai');
    expect(paired?.a).toBe('Brake pad');
    expect(paired?.b).toBe('pads');
    expect(paired?.status).toBe('same_item');
    expect(diff.totals.find((f) => f.field === 'grand_total_invoice')?.delta).toBe(550);
  });

  it('parses leftover AI JSON and ignores unsure rows', () => {
    const pairs = parsePairs('here [{"a":0,"b":1,"same":true,"confidence":0.86},{"a":1,"b":0,"same":false}]', 'parts', 2, 2);
    expect(pairs).toEqual([{ group: 'parts', a: 0, b: 1, confidence: 0.86 }]);
  });

  it('coerces loose JSON aliases', () => {
    const parsed = coerceCompareInvoice({
      vendorName: 'Apex',
      totalAmount: 100,
      parts: [{ description: 'Oil', amount: 40 }],
    });
    expect(parsed.company_name).toBe('Apex');
    expect(parsed.totals_and_tax_summary?.grand_total_invoice).toBe(100);
    expect(parsed.parts_line_items?.[0]?.item_name_description).toBe('Oil');
  });
});
