import type { TotalsAndTaxSummary } from '../../../types/invoice.js';

import { roundMoney } from '../../../../shared/numbers.js';
import { footerColumnAmounts, moneyTokensFromText } from './gst.js';

/** True when OCR markdown lacks the printed Parts|Labour bill summary footer. */
export function footerMissingInMarkdown(md: string): boolean {
  return !/(less\s*discount|cgst\s*@|o-?cgst|sub\s*total|net\s*bill\s*amount)/i.test(md);
}

/**
 * When the summary footer was never OCR'd, the LLM's "0" discounts and computed GST amounts cannot
 * be trusted (there is no printed evidence to confirm them) — drop them so they show as unknown
 * rather than wrong. No-op when a footer is present, so footer-backed bills are unaffected.
 */
export function clearUntrustedZeroDiscounts(t: TotalsAndTaxSummary, markdown: string): void {
  if (!footerMissingInMarkdown(markdown)) return;
  if (t.parts_discount === 0) delete t.parts_discount;
  if (t.labour_discount === 0) delete t.labour_discount;
  for (const k of ['parts_cgst_amount', 'parts_sgst_amount', 'parts_igst_amount',
    'labour_cgst_amount', 'labour_sgst_amount', 'labour_igst_amount'] as const) {
    delete t[k];
  }
}

export function applySpecialDiscountLine(out: Partial<TotalsAndTaxSummary>, line: string): void {
  const tokens = moneyTokensFromText(line);
  if (!tokens.length) return;
  const [p, l] = footerColumnAmounts(line);
  if (p != null && l != null) {
    if (p > 0) out.parts_special_discount = roundMoney((out.parts_special_discount ?? 0) + p);
    if (l > 0) out.labour_special_discount = roundMoney((out.labour_special_discount ?? 0) + l);
    return;
  }
  if (tokens.length >= 3) {
    if (tokens[0] > 0) out.parts_special_discount = roundMoney((out.parts_special_discount ?? 0) + tokens[0]);
    if (tokens[tokens.length - 1] > 0) {
      out.labour_special_discount = roundMoney((out.labour_special_discount ?? 0) + tokens[tokens.length - 1]);
    }
    return;
  }
  if (tokens.length === 2) {
    out.parts_special_discount = roundMoney((out.parts_special_discount ?? 0) + tokens[0]);
    out.labour_special_discount = roundMoney((out.labour_special_discount ?? 0) + tokens[1]);
    return;
  }
  // Single amount in 3-column (Parts | 0 | Labour) footer → labour column
  out.labour_special_discount = roundMoney((out.labour_special_discount ?? 0) + tokens[0]);
}
