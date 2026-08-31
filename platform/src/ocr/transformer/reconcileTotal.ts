import type { ParsedInvoiceData, TotalsAndTaxSummary } from '../types/invoice.js';

/** Slim audit object: bases + final compare. Discount/tax still applied internally. */
export interface TotalReconciliation {
  matched: boolean;
  calculated_total: number;
  grand_total_invoice: number | null;
  difference: number | null;
  tolerance: 2;
  parts_base: number;
  labour_base: number;
  deductibles: number;
  salvage: number;
  reason: string | null;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function taxRatePct(t: TotalsAndTaxSummary, side: 'parts' | 'labour'): number {
  const cgst = side === 'parts' ? t.parts_cgst_rate : t.labour_cgst_rate;
  const sgst = side === 'parts' ? t.parts_sgst_rate : t.labour_sgst_rate;
  if (cgst != null && sgst != null) return cgst + sgst;
  const igst = side === 'parts' ? t.parts_igst_rate : t.labour_igst_rate;
  if (igst != null) return igst;
  return 0;
}

const TOLERANCE = 2;

export function reconcileInvoiceTotal(parsed: ParsedInvoiceData): TotalReconciliation {
  const t = parsed.totals_and_tax_summary ?? ({} as TotalsAndTaxSummary);
  const parts = parsed.parts_line_items ?? [];
  const labour = parsed.labour_service_line_items ?? [];
  const grand = t.grand_total_invoice ?? null;

  const hasLines = parts.length > 0 || labour.length > 0;
  if (!hasLines && grand == null) {
    return {
      matched: true, calculated_total: 0, grand_total_invoice: null,
      difference: 0, tolerance: 2, parts_base: 0, labour_base: 0,
      deductibles: 0, salvage: 0, reason: null,
    };
  }

  const partsBase = roundMoney(
    parts.reduce((sum, p) => {
      const qr = (p.quantity ?? 0) * (p.rate ?? 0);
      return sum + (qr !== 0 ? qr : (p.taxable_amount ?? 0));
    }, 0),
  );

  const labourBase = roundMoney(
    labour.reduce((sum, l) => sum + (l.labour_charges ?? 0), 0),
  );

  // Discount + tax applied internally — not exposed on the response object
  const partsDisc = (t.parts_discount ?? 0) + (t.parts_special_discount ?? 0);
  const labourDisc = (t.labour_discount ?? 0) + (t.labour_special_discount ?? 0);
  const partsTaxable = roundMoney(partsBase - partsDisc);
  const labourTaxable = roundMoney(labourBase - labourDisc);
  const partsTax = roundMoney(partsTaxable * taxRatePct(t, 'parts') / 100);
  const labourTax = roundMoney(labourTaxable * taxRatePct(t, 'labour') / 100);

  const deductibles = t.deductibles ?? 0;
  const salvage = t.salvage ?? 0;

  const calculated = roundMoney(
    partsTaxable + labourTaxable + partsTax + labourTax + deductibles + salvage,
  );

  if (grand == null) {
    return {
      matched: false, calculated_total: calculated, grand_total_invoice: null,
      difference: null, tolerance: 2, parts_base: partsBase, labour_base: labourBase,
      deductibles, salvage,
      reason: 'Grand total missing — cannot verify bill total.',
    };
  }

  const diff = roundMoney(Math.abs(calculated - grand));
  const matched = diff <= TOLERANCE;

  return {
    matched, calculated_total: calculated, grand_total_invoice: grand,
    difference: diff, tolerance: 2, parts_base: partsBase, labour_base: labourBase,
    deductibles, salvage,
    reason: matched
      ? null
      : `Total mismatch: calculated ₹${calculated.toLocaleString('en-IN')} vs printed ₹${grand.toLocaleString('en-IN')} (diff ₹${diff.toLocaleString('en-IN')}).`,
  };
}
