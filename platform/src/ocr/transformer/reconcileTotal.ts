import type { ParsedInvoiceData, PartsLineItem, TotalsAndTaxSummary } from '../types/invoice.js';

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

/**
 * Parts line amount for reconciliation:
 * - taxable_amount 0 + tax_percentage 0 → qty × rate (Free/FOC; discount absorbs it)
 * - taxable_amount 0 otherwise → 0 (insurance write-off)
 * - otherwise → qty × rate
 */
export function partsLineAmount(p: PartsLineItem): number {
  if (p.taxable_amount === 0) {
    if (p.tax_percentage === 0) return (p.quantity ?? 0) * (p.rate ?? 0);
    return 0;
  }
  return (p.quantity ?? 0) * (p.rate ?? 0);
}

export function sumPartsBase(parts: PartsLineItem[]): number {
  return roundMoney(parts.reduce((sum, p) => sum + partsLineAmount(p), 0));
}

function taxRatePct(t: TotalsAndTaxSummary, side: 'parts' | 'labour'): number {
  const cgst = side === 'parts' ? t.parts_cgst_rate : t.labour_cgst_rate;
  const sgst = side === 'parts' ? t.parts_sgst_rate : t.labour_sgst_rate;
  if (cgst != null && sgst != null) return cgst + sgst;
  const igst = side === 'parts' ? t.parts_igst_rate : t.labour_igst_rate;
  if (igst != null) return igst;

  // Indian invoices apply the same GST rate to both parts and labour.
  // If this side has no rate but the other side does, inherit it.
  const otherCgst = side === 'parts' ? t.labour_cgst_rate : t.parts_cgst_rate;
  const otherSgst = side === 'parts' ? t.labour_sgst_rate : t.parts_sgst_rate;
  if (otherCgst != null && otherSgst != null) return otherCgst + otherSgst;
  const otherIgst = side === 'parts' ? t.labour_igst_rate : t.parts_igst_rate;
  if (otherIgst != null) return otherIgst;

  return 0;
}

/**
 * Tax for one side. When line tax_percentage values are mixed (e.g. 18% + 0% fuel),
 * tax each line after proportional discount — avoids flat footer rate on zero-rated lines.
 * Uniform (or missing) line rates keep the existing footer-rate behaviour.
 */
function sideTax(
  lines: { amount: number; tax_percentage?: number | null }[],
  discount: number,
  footerRatePct: number,
): number {
  const gross = roundMoney(lines.reduce((s, l) => s + l.amount, 0));
  if (gross <= 0) return 0;

  const presentRates = lines
    .map((l) => l.tax_percentage)
    .filter((r): r is number => r != null);
  const mixedRates = presentRates.length > 0 && new Set(presentRates).size > 1;

  if (!mixedRates) {
    return roundMoney(Math.max(0, gross - discount) * footerRatePct / 100);
  }

  // Mixed rates: 0% items never contribute tax. Absorb discount into 0% items
  // first (covers "Free"/100%-discount items), remainder goes to positive-rate items.
  const zeroGross = roundMoney(
    lines.filter((l) => (l.tax_percentage ?? footerRatePct) <= 0).reduce((s, l) => s + l.amount, 0),
  );
  const positiveDiscount = Math.max(0, discount - zeroGross);
  const positiveGross = roundMoney(gross - zeroGross);

  let tax = 0;
  for (const l of lines) {
    const rate = l.tax_percentage ?? footerRatePct;
    if (rate <= 0) continue;
    const share = positiveGross > 0 ? l.amount / positiveGross : 0;
    const taxable = Math.max(0, l.amount - positiveDiscount * share);
    tax += taxable * rate / 100;
  }
  return roundMoney(tax);
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

  const partsBase = sumPartsBase(parts);

  const labourBase = roundMoney(
    labour.reduce((sum, l) => sum + (l.labour_charges ?? 0), 0),
  );

  const partsDisc = (t.parts_discount ?? 0) + (t.parts_special_discount ?? 0);
  const labourDisc = (t.labour_discount ?? 0) + (t.labour_special_discount ?? 0);
  const partsTaxable = roundMoney(partsBase - partsDisc);
  const labourTaxable = roundMoney(labourBase - labourDisc);
  const partsTax = sideTax(
    parts.map((p) => ({ amount: partsLineAmount(p), tax_percentage: p.tax_percentage })),
    partsDisc,
    taxRatePct(t, 'parts'),
  );
  const labourTax = sideTax(
    labour.map((l) => ({ amount: l.labour_charges ?? 0, tax_percentage: l.tax_percentage })),
    labourDisc,
    taxRatePct(t, 'labour'),
  );

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
