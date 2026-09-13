import type { TotalsAndTaxSummary } from '../../../types/invoice.js';

import { stripCalculatedFooterAmounts } from './gst.js';
import { clearUntrustedZeroDiscounts } from './discount.js';
import { extractSummaryFromMarkdown, extractGatePassAmount } from './chargeTable.js';

const FOOTER_KEYS: (keyof TotalsAndTaxSummary)[] = [
  'parts_total', 'labour_total', 'parts_discount', 'labour_discount',
  'parts_cgst_rate', 'parts_sgst_rate', 'parts_igst_rate',
  'labour_cgst_rate', 'labour_sgst_rate', 'labour_igst_rate',
  'parts_cgst_amount', 'parts_sgst_amount', 'parts_igst_amount',
  'labour_cgst_amount', 'labour_sgst_amount', 'labour_igst_amount',
  'parts_special_discount', 'labour_special_discount',
  'deductibles', 'salvage',
  'grand_total_invoice',
];

/** OCR footer wins over LLM — strips calculated GST, then applies printed footer values. */
export function applyFooterFromMarkdown(t: TotalsAndTaxSummary, markdown: string): TotalsAndTaxSummary {
  const out = { ...t };
  stripCalculatedFooterAmounts(out);
  clearUntrustedZeroDiscounts(out, markdown);
  const fromMd = extractSummaryFromMarkdown(markdown);
  for (const k of FOOTER_KEYS) {
    const v = fromMd[k];
    if (typeof v === 'number') out[k] = v as never;
  }
  if (fromMd.gst_breakdown?.length) out.gst_breakdown = fromMd.gst_breakdown;
  const gp = extractGatePassAmount(markdown);
  if (gp != null && (out.grand_total_invoice == null || Math.abs(out.grand_total_invoice - gp) > 1)) {
    out.grand_total_invoice = gp;
  }
  stripCalculatedFooterAmounts(out);
  return out;
}

export { FOOTER_KEYS };

export {
  parseMoneyToken,
  moneyTokensFromText,
  footerColumnAmounts,
  lastTwoAmounts,
  isCalculatedGstAmount,
  stripCalculatedFooterAmounts,
} from './gst.js';

export {
  footerMissingInMarkdown,
  clearUntrustedZeroDiscounts,
} from './discount.js';

export {
  extractSummaryFromMarkdown,
  extractGatePassAmount,
} from './chargeTable.js';

export { extractCashMemoTotal } from './cashMemo.js';
