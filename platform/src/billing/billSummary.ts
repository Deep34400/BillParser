import type { ParsedInvoiceData, PartsLineItem, LabourServiceLineItem, TotalsAndTaxSummary } from '../parsing/types.js';
import {
  applyFooterFromMarkdown,
  stripCalculatedFooterAmounts,
  extractGatePassAmount,
  extractCashMemoTotal,
} from './footerExtract.js';

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

function inferGstRates(t: TotalsAndTaxSummary, data: ParsedInvoiceData): void {
  const full = (items: { tax_percentage?: number | null }[]) =>
    items.find((i) => i.tax_percentage != null && i.tax_percentage > 0)?.tax_percentage ?? null;
  const pFull = full(data.parts_line_items ?? []);
  const lFull = full(data.labour_service_line_items ?? []);
  const half = (f: number | null) => (f != null ? f / 2 : null);
  const pHalf = half(pFull);
  const lHalf = half(lFull);
  // Intra-state: CGST = SGST = half the GST rate.
  if (t.parts_cgst_rate == null && pHalf != null) { t.parts_cgst_rate = pHalf; t.parts_sgst_rate = pHalf; }
  if (t.labour_cgst_rate == null && lHalf != null) { t.labour_cgst_rate = lHalf; t.labour_sgst_rate = lHalf; }
  // Inter-state: IGST = the full GST rate. Infer it when an IGST amount is charged but the footer
  // printed only the amount (rate lives in the line-item "IGST%" column, e.g. MG/Morris Garages).
  if (t.parts_igst_rate == null && (t.parts_igst_amount ?? 0) > 0 && pFull != null) t.parts_igst_rate = pFull;
  if (t.labour_igst_rate == null && (t.labour_igst_amount ?? 0) > 0 && lFull != null) t.labour_igst_rate = lFull;
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

  inferGstRates(t, data);
  reconcileSideGst(t);
  stripCalculatedFooterAmounts(t);
  dedupeSingleColumnDuplicate(t, data, footerParts, footerLabour);

  reconcilePrintedTotal(t, data, partsSum, labourSum, markdown);

  const gp = markdown ? extractGatePassAmount(markdown) : null;
  if (gp != null && (t.grand_total_invoice == null || Math.abs(t.grand_total_invoice - gp) > 1)) {
    t.grand_total_invoice = gp;
  }

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
