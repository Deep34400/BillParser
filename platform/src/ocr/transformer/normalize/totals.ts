import type { ParsedInvoiceData, PartsLineItem, LabourServiceLineItem, TotalsAndTaxSummary } from '../../types/invoice.js';
import {
  applyFooterFromMarkdown,
  stripCalculatedFooterAmounts,
  extractGatePassAmount,
  extractCashMemoTotal,
} from './footer.js';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumParts(items: PartsLineItem[]): number | null {
  if (!items.length) return null;
  return roundMoney(items.reduce((a, p) => a + (p.taxable_amount ?? 0), 0));
}

function sumLabour(items: LabourServiceLineItem[]): number | null {
  if (!items.length) return null;
  return roundMoney(items.reduce((a, l) => a + (l.labour_charges ?? 0), 0));
}

/** Footer/OCR subtotal wins; line-item sum is fallback only when footer is missing/zero. */
function coalesceColumnTotal(
  stored: number | null | undefined,
  lineSum: number | null,
): number | undefined {
  if (stored != null && stored > 0) return stored;
  if (lineSum != null && lineSum > 0) return lineSum;
  if (stored === 0) return 0;
  return stored ?? undefined;
}

/** Treat LLM/OCR zero as unknown only when footer was never OCR'd. */
function coalesceDiscount(
  stored: number | null | undefined,
  _otherSide: number | null | undefined,
): number | undefined {
  if (stored != null && stored > 0) return stored;
  if (stored === 0) return 0;
  return stored ?? undefined;
}

/**
 * Style A (Toyota/Chevrolet): LLM returns column total already post-discount
 * (≈ lineSum − discount) while still emitting the discount. Normalize to Style B
 * so UI applies discount once: Sub Total = lineSum, Less Discount, GST on taxable.
 */
function restorePreDiscountColumnTotal(
  t: TotalsAndTaxSummary,
  side: 'parts' | 'labour',
  lineSum: number | null,
): void {
  const sub = t[`${side}_total`];
  const disc = (t[`${side}_discount`] ?? 0) + (t[`${side}_special_discount`] ?? 0);
  if (sub == null || disc <= 0 || lineSum == null || lineSum <= 0) return;
  if (Math.abs(sub - roundMoney(lineSum - disc)) < 0.15 && Math.abs(lineSum - sub) > 0.15) {
    t[`${side}_total`] = roundMoney(lineSum);
  }
}

function dominantTaxRate(items: { tax_percentage?: number | null }[]): number | null {
  const rates = items
    .map((i) => i.tax_percentage)
    .filter((r): r is number => typeof r === 'number' && r > 0);
  if (!rates.length) return null;
  // Most common positive rate (handles mixed 0% + 18%)
  const counts = new Map<number, number>();
  for (const r of rates) counts.set(r, (counts.get(r) ?? 0) + 1);
  let best = rates[0];
  let bestN = 0;
  for (const [r, n] of counts) {
    if (n > bestN) { best = r; bestN = n; }
  }
  return best;
}

function lineItemGst(
  parts: PartsLineItem[],
  labour: LabourServiceLineItem[],
): { parts: number; labour: number; partsRate: number | null; labourRate: number | null } {
  const partsGst = roundMoney(
    parts.reduce((s, p) => s + (p.taxable_amount ?? 0) * ((p.tax_percentage ?? 0) / 100), 0),
  );
  const labourGst = roundMoney(
    labour.reduce((s, l) => s + (l.labour_charges ?? 0) * ((l.tax_percentage ?? 0) / 100), 0),
  );
  return {
    parts: partsGst,
    labour: labourGst,
    partsRate: dominantTaxRate(parts),
    labourRate: dominantTaxRate(labour),
  };
}

function hasAnyGstAmount(t: TotalsAndTaxSummary): boolean {
  return (
    (t.parts_cgst_amount ?? 0) > 0 || (t.parts_sgst_amount ?? 0) > 0 || (t.parts_igst_amount ?? 0) > 0 ||
    (t.labour_cgst_amount ?? 0) > 0 || (t.labour_sgst_amount ?? 0) > 0 || (t.labour_igst_amount ?? 0) > 0
  );
}

function hasCgstSgstRate(t: TotalsAndTaxSummary): boolean {
  return (
    (t.parts_cgst_rate ?? 0) > 0 || (t.parts_sgst_rate ?? 0) > 0 ||
    (t.labour_cgst_rate ?? 0) > 0 || (t.labour_sgst_rate ?? 0) > 0
  );
}

function hasIgstSignal(t: TotalsAndTaxSummary, data: ParsedInvoiceData, markdown?: string | null): boolean {
  if ((t.parts_igst_rate ?? 0) > 0 || (t.labour_igst_rate ?? 0) > 0) return true;
  if ((t.parts_igst_amount ?? 0) > 0 || (t.labour_igst_amount ?? 0) > 0) return true;
  if (!markdown) return false;

  // Footer: "Add : IGST 1,057.50" with CGST/SGST zero or absent
  const igstFooter = /Add\s*:\s*IGST\s*([\d,]+\.?\d*)/i.exec(markdown);
  if (igstFooter) {
    const amt = parseFloat(igstFooter[1].replace(/,/g, ''));
    if (Number.isFinite(amt) && amt > 0) return true;
  }

  // Inter-state: seller GSTIN state ≠ any other GSTIN state in the text
  const seller = (data.gstin ?? '').replace(/\s/g, '').toUpperCase();
  const sellerState = seller.length >= 2 ? seller.slice(0, 2) : '';
  if (!sellerState) return false;
  const all = markdown.match(/\b(\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9])\b/gi) ?? [];
  for (const g of all) {
    const u = g.toUpperCase();
    if (u === seller) continue;
    if (u.slice(0, 2) !== sellerState) return true;
  }
  return false;
}

/**
 * Infer missing rates only from existing amounts / line-item % — do NOT invent CGST/SGST
 * when the footer is empty (that wrongly turns IGST bills into CGST+SGST).
 */
function inferGstRates(t: TotalsAndTaxSummary, data: ParsedInvoiceData): void {
  const pFull = dominantTaxRate(data.parts_line_items ?? []);
  const lFull = dominantTaxRate(data.labour_service_line_items ?? []);
  const pHalf = pFull != null ? pFull / 2 : null;
  const lHalf = lFull != null ? lFull / 2 : null;

  // IGST amount present → fill IGST rate from line items
  if (t.parts_igst_rate == null && (t.parts_igst_amount ?? 0) > 0 && pFull != null) t.parts_igst_rate = pFull;
  if (t.labour_igst_rate == null && (t.labour_igst_amount ?? 0) > 0 && lFull != null) t.labour_igst_rate = lFull;

  // CGST/SGST amount present → fill half rates
  if (t.parts_cgst_rate == null && (t.parts_cgst_amount ?? 0) > 0 && pHalf != null) {
    t.parts_cgst_rate = pHalf;
    if (t.parts_sgst_rate == null) t.parts_sgst_rate = pHalf;
  }
  if (t.labour_cgst_rate == null && (t.labour_cgst_amount ?? 0) > 0 && lHalf != null) {
    t.labour_cgst_rate = lHalf;
    if (t.labour_sgst_rate == null) t.labour_sgst_rate = lHalf;
  }
}

/**
 * When rates exist but amounts are missing (common in Gemini single — no OCR markdown),
 * fill CGST/SGST/IGST from (subtotal − discount) × rate%. Only fills null/undefined — never overwrites.
 */
export function fillMissingGstAmounts(t: TotalsAndTaxSummary): void {
  for (const side of ['parts', 'labour'] as const) {
    const sub = t[`${side}_total`];
    if (sub == null || sub <= 0) continue;
    const disc = (t[`${side}_discount`] ?? 0) + (t[`${side}_special_discount`] ?? 0);
    const taxable = roundMoney(sub - disc);
    if (taxable <= 0) continue;

    const igstRate = t[`${side}_igst_rate`];
    if (igstRate != null && igstRate > 0 && t[`${side}_igst_amount`] == null) {
      t[`${side}_igst_amount`] = roundMoney(taxable * igstRate / 100);
      continue; // IGST and CGST+SGST are mutually exclusive
    }

    const cgstRate = t[`${side}_cgst_rate`] ?? t[`${side}_sgst_rate`];
    const sgstRate = t[`${side}_sgst_rate`] ?? t[`${side}_cgst_rate`];
    if (cgstRate != null && cgstRate > 0 && t[`${side}_cgst_amount`] == null) {
      t[`${side}_cgst_amount`] = roundMoney(taxable * cgstRate / 100);
    }
    if (sgstRate != null && sgstRate > 0 && t[`${side}_sgst_amount`] == null) {
      t[`${side}_sgst_amount`] = roundMoney(taxable * sgstRate / 100);
    }
  }
}

/**
 * When ALL GST amounts are still missing, compute from line items (handles mixed 0%/18%).
 * Prefers IGST when footer/markdown/IGST rate says inter-state, or when no CGST/SGST rates
 * were printed (UnifyGST "GST Rate" column → IGST for inter-state bills).
 */
function fillMissingGstFromLineItems(
  t: TotalsAndTaxSummary,
  data: ParsedInvoiceData,
  markdown?: string | null,
): void {
  if (hasAnyGstAmount(t)) return;

  const { parts, labour, partsRate, labourRate } = lineItemGst(
    data.parts_line_items ?? [],
    data.labour_service_line_items ?? [],
  );
  if (parts <= 0 && labour <= 0) return;

  // Prefer IGST when signaled, or when footer has no CGST/SGST rates at all
  // (Gemini single leaves rates null — default to IGST for a single GST bucket).
  const useIgst = hasIgstSignal(t, data, markdown) || !hasCgstSgstRate(t);

  if (useIgst) {
    if (parts > 0) {
      t.parts_igst_amount = parts;
      if (t.parts_igst_rate == null && partsRate != null) t.parts_igst_rate = partsRate;
      t.parts_cgst_amount = null; t.parts_sgst_amount = null;
      t.parts_cgst_rate = null; t.parts_sgst_rate = null;
    }
    if (labour > 0) {
      t.labour_igst_amount = labour;
      if (t.labour_igst_rate == null && labourRate != null) t.labour_igst_rate = labourRate;
      t.labour_cgst_amount = null; t.labour_sgst_amount = null;
      t.labour_cgst_rate = null; t.labour_sgst_rate = null;
    }
    return;
  }

  // Intra-state: split line GST into equal CGST + SGST
  if (parts > 0) {
    const half = roundMoney(parts / 2);
    t.parts_cgst_amount = half;
    t.parts_sgst_amount = half;
    if (t.parts_cgst_rate == null && partsRate != null) {
      t.parts_cgst_rate = partsRate / 2;
      t.parts_sgst_rate = partsRate / 2;
    }
  }
  if (labour > 0) {
    const half = roundMoney(labour / 2);
    t.labour_cgst_amount = half;
    t.labour_sgst_amount = half;
    if (t.labour_cgst_rate == null && labourRate != null) {
      t.labour_cgst_rate = labourRate / 2;
      t.labour_sgst_rate = labourRate / 2;
    }
  }
}

/**
 * GST-law cleanup per side:
 *  - a side with zero subtotal cannot carry any GST;
 *  - IGST (inter-state) and CGST+SGST (intra-state) are mutually exclusive — when IGST is charged,
 *    any CGST/SGST on that side is a mislabeled duplicate and is dropped.
 */
function reconcileSideGst(t: TotalsAndTaxSummary): void {
  for (const side of ['parts', 'labour'] as const) {
    if (t[`${side}_total`] === 0) {
      t[`${side}_cgst_amount`] = 0; t[`${side}_sgst_amount`] = 0; t[`${side}_igst_amount`] = 0;
      t[`${side}_cgst_rate`] = null; t[`${side}_sgst_rate`] = null; t[`${side}_igst_rate`] = null;
    } else if ((t[`${side}_igst_amount`] ?? 0) > 0) {
      t[`${side}_cgst_amount`] = null; t[`${side}_sgst_amount`] = null;
      t[`${side}_cgst_rate`] = null; t[`${side}_sgst_rate`] = null;
    }
  }
}

const SIDE_FIELDS = [
  '_total', '_discount', '_special_discount',
  '_cgst_amount', '_sgst_amount', '_igst_amount',
  '_cgst_rate', '_sgst_rate', '_igst_rate',
] as const;

function clearSide(t: TotalsAndTaxSummary, side: 'parts' | 'labour'): void {
  t[`${side}_total`] = 0;
  t[`${side}_discount`] = 0; t[`${side}_special_discount`] = 0;
  t[`${side}_cgst_amount`] = 0; t[`${side}_sgst_amount`] = 0; t[`${side}_igst_amount`] = 0;
  t[`${side}_cgst_rate`] = null; t[`${side}_sgst_rate`] = null; t[`${side}_igst_rate`] = null;
}

/** Swap the entire Parts and Labour columns (and per-rate breakdown sides). Sum-preserving. */
function swapSides(t: TotalsAndTaxSummary): void {
  for (const f of SIDE_FIELDS) {
    const pk = `parts${f}` as keyof TotalsAndTaxSummary;
    const lk = `labour${f}` as keyof TotalsAndTaxSummary;
    const tmp = t[pk]; (t[pk] as unknown) = t[lk]; (t[lk] as unknown) = tmp;
  }
  if (Array.isArray(t.gst_breakdown)) {
    for (const e of t.gst_breakdown) { const tmp = e.parts; e.parts = e.labour; e.labour = tmp; }
  }
}

function hasPartsItems(data: ParsedInvoiceData): boolean {
  return (data.parts_line_items ?? []).some((p) => (p.taxable_amount ?? 0) > 0 || (p.quantity != null && p.rate != null));
}

function hasLabourItems(data: ParsedInvoiceData): boolean {
  return (data.labour_service_line_items ?? []).some((l) => (l.labour_charges ?? 0) > 0);
}

/**
 * Single-column consolidation. The OCR footer cannot tell Parts from Labour, so a single-column
 * subtotal ("Sub Total 3,800") is always parked on Parts. When the LLM line items reveal the bill
 * is actually the other side (and line-sum coalescing has revived a duplicate of the same money on
 * that side), two things must happen:
 *   1. drop the duplicate so the bill is not double-counted, and
 *   2. relocate the single column to the side the line items indicate (e.g. an all-labour service
 *      bill belongs under Labour, matching its labour_service_line_items).
 * The relocation is a pure Parts↔Labour swap, so the reconciliation sum is unchanged. No-op for
 * genuine two-column bills (footer captured both sides) and parts/labour-only bills with nothing to
 * revive.
 */
function dedupeSingleColumnDuplicate(
  t: TotalsAndTaxSummary,
  data: ParsedInvoiceData,
  footerParts: number | null | undefined,
  footerLabour: number | null | undefined,
): void {
  const grand = t.grand_total_invoice;
  if (grand == null) return;
  const reconciles = (n: number | null) => n != null && Math.abs(n - grand) <= 1;
  if (footerLabour === 0 && (t.labour_total ?? 0) > 0 && reconciles(columnNet(t, 'parts'))) {
    clearSide(t, 'labour');
    if (hasLabourItems(data) && !hasPartsItems(data)) swapSides(t);
  } else if (footerParts === 0 && (t.parts_total ?? 0) > 0 && reconciles(columnNet(t, 'labour'))) {
    clearSide(t, 'parts');
    if (hasPartsItems(data) && !hasLabourItems(data)) swapSides(t);
  }
}

export function columnNet(t: TotalsAndTaxSummary, side: 'parts' | 'labour'): number | null {
  const sub = side === 'parts' ? t.parts_total : t.labour_total;
  if (sub == null) return null;
  const disc = side === 'parts'
    ? (t.parts_discount ?? 0) + (t.parts_special_discount ?? 0)
    : (t.labour_discount ?? 0) + (t.labour_special_discount ?? 0);
  const cgst = side === 'parts' ? (t.parts_cgst_amount ?? 0) : (t.labour_cgst_amount ?? 0);
  const sgst = side === 'parts' ? (t.parts_sgst_amount ?? 0) : (t.labour_sgst_amount ?? 0);
  const igst = side === 'parts' ? (t.parts_igst_amount ?? 0) : (t.labour_igst_amount ?? 0);
  return roundMoney(sub - disc + cgst + sgst + igst);
}

/** When OCR line-sum drifts from the printed TOTAL on cash memos, trust the printed amount. */
function reconcilePrintedTotal(
  t: TotalsAndTaxSummary,
  data: ParsedInvoiceData,
  partsSum: number | null,
  labourSum: number | null,
  markdown?: string | null,
): void {
  if (!markdown) return;
  const printed = extractCashMemoTotal(markdown);
  if (printed == null) return;

  const lineSum = roundMoney((partsSum ?? 0) + (labourSum ?? 0));
  if (lineSum <= 0 || Math.abs(lineSum - printed) <= 1) return;

  t.grand_total_invoice = printed;
  const hasParts = (partsSum ?? 0) > 0;
  const hasLabour = (labourSum ?? 0) > 0;
  if (hasParts && !hasLabour) {
    t.parts_total = printed;
    t.labour_total = 0;
  } else if (hasLabour && !hasParts) {
    t.labour_total = printed;
    t.parts_total = 0;
  }
  t.sub_total_calculated = printed;
}

/**
 * Single bill-summary pipeline: OCR footer → line sums → discount cleanup → column nets.
 * Used at parse time (API) and display time (web).
 */
export function resolveBillSummary(
  data: ParsedInvoiceData,
  markdown?: string | null,
): TotalsAndTaxSummary {
  let t: TotalsAndTaxSummary = { ...(data.totals_and_tax_summary ?? {}) };

  if (markdown) {
    t = applyFooterFromMarkdown(t, markdown);
  }

  // Footer-declared column subtotals, captured before line-item coalescing can revive a column.
  const footerParts = markdown ? t.parts_total : undefined;
  const footerLabour = markdown ? t.labour_total : undefined;

  const partsSum = sumParts(data.parts_line_items ?? []);
  const labourSum = sumLabour(data.labour_service_line_items ?? []);

  t.parts_total = coalesceColumnTotal(t.parts_total, partsSum);
  t.labour_total = coalesceColumnTotal(t.labour_total, labourSum);

  t.parts_discount = coalesceDiscount(t.parts_discount, t.labour_discount);
  t.labour_discount = coalesceDiscount(t.labour_discount, t.parts_discount);

  restorePreDiscountColumnTotal(t, 'parts', partsSum);
  restorePreDiscountColumnTotal(t, 'labour', labourSum);

  inferGstRates(t, data);
  fillMissingGstAmounts(t);
  fillMissingGstFromLineItems(t, data, markdown);
  reconcileSideGst(t);
  stripCalculatedFooterAmounts(t);
  // Refill after stripping gross×rate mistakes → (subtotal − discount) × rate
  fillMissingGstAmounts(t);
  dedupeSingleColumnDuplicate(t, data, footerParts, footerLabour);

  reconcilePrintedTotal(t, data, partsSum, labourSum, markdown);

  const gp = markdown ? extractGatePassAmount(markdown) : null;
  if (gp != null && (t.grand_total_invoice == null || Math.abs(t.grand_total_invoice - gp) > 1)) {
    t.grand_total_invoice = gp;
  }

  // Recover full labour/parts write-off when LLM missed the discount column
  // (e.g. "Less Discount … | 157.71 | 0.00 | 925.00 |" with labour_discount left as 0).
  inferFullyDiscountedColumn(t);

  const pNet = columnNet(t, 'parts');
  const lNet = columnNet(t, 'labour');
  if (pNet != null && lNet != null && t.grand_total_invoice != null) {
    const netSum = roundMoney(pNet + lNet);
    if (Math.abs(netSum - t.grand_total_invoice) <= 1 || Math.round(netSum) === t.grand_total_invoice) {
      t.sub_total_calculated = netSum;
    }
  }

  return t;
}

/**
 * When one column alone matches grand_total and the other has gross > 0, discount 0,
 * and no GST — treat that column as fully discounted (common Maruti free-labour pattern).
 */
function inferFullyDiscountedColumn(t: TotalsAndTaxSummary): void {
  const grand = t.grand_total_invoice;
  if (grand == null) return;

  const trySide = (side: 'parts' | 'labour') => {
    const total = side === 'parts' ? t.parts_total : t.labour_total;
    const discKey = side === 'parts' ? 'parts_discount' : 'labour_discount';
    const disc = t[discKey] ?? 0;
    if (total == null || total <= 0 || disc > 0) return;

    const cgst = side === 'parts' ? (t.parts_cgst_amount ?? 0) : (t.labour_cgst_amount ?? 0);
    const sgst = side === 'parts' ? (t.parts_sgst_amount ?? 0) : (t.labour_sgst_amount ?? 0);
    const igst = side === 'parts' ? (t.parts_igst_amount ?? 0) : (t.labour_igst_amount ?? 0);
    if (cgst + sgst + igst > 0.05) return;

    const otherNet = columnNet(t, side === 'parts' ? 'labour' : 'parts');
    if (otherNet == null) return;
    if (Math.abs(otherNet - grand) <= 2 || Math.round(otherNet) === Math.round(grand)) {
      t[discKey] = roundMoney(total);
    }
  };

  trySide('labour');
  trySide('parts');
}
