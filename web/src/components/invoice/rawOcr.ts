import type { Invoice } from '../../types/index.js';

export function buildFinalOcrJson(inv: Invoice): string | null {
  if (inv.parsedData) {
    return JSON.stringify(
      {
        ...inv.parsedData,
        review_reasons: inv.reviewReasons ?? [],
        review_codes: inv.reviewCodes ?? [],
        total_reconciliation: inv.totalReconciliation ?? null,
      },
      null,
      2,
    );
  }
  return inv.rawText ?? null;
}
