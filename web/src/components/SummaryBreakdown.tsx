import type { Invoice } from '../types.js';
import { T } from '../theme.js';
import { money } from '../format.js';

// ---------------------------------------------------------------------------
// SummaryBreakdown — the ordered GST totals block:
//   Sub Total → Less Discounts → CGST → SGST/IGST → Sub Total → Net Bill Amount
// Each row renders only when its value is present. SGST and IGST are mutually
// exclusive (show whichever exists). Falls back to a single "Tax" row for
// invoices extracted before the GST split existed, and to "Total" when there
// is no separate Net Bill Amount.
// Renders right-aligned rows; the caller provides the surrounding container.
// ---------------------------------------------------------------------------
export function SummaryBreakdown({ inv, currency }: { inv: Invoice; currency: string }) {
  // Only render once the invoice has any summary figure (skip empty invoices).
  const hasSummary = inv.subtotal != null || inv.totalAmount != null || inv.netAmount != null;
  const rows: { label: string; value: number; strong?: boolean }[] = [];
  const add = (label: string, value: number | null | undefined, strong = false) => {
    if (value != null) rows.push({ label, value, strong });
  };

  add('Sub Total', inv.subtotal);
  // Always show the Less Discounts row, even when zero/absent.
  if (hasSummary) rows.push({ label: 'Less Discounts', value: inv.discountAmount ?? 0 });

  // Always show a GST section: IGST when present, otherwise CGST + SGST (0 when absent).
  if (inv.igstAmount != null) {
    add('IGST', inv.igstAmount);
  } else if (hasSummary) {
    rows.push({ label: 'CGST', value: inv.cgstAmount ?? 0 });
    rows.push({ label: 'SGST', value: inv.sgstAmount ?? 0 });
  }

  if (inv.netAmount != null) {
    add('Sub Total', inv.totalAmount);
    add('Net Bill Amount', inv.netAmount, true);
  } else {
    add('Total', inv.totalAmount, true);
  }

  return (
    <>
      {rows.map((r, i) => (
        <div
          key={`${r.label}-${i}`}
          style={{ fontSize: r.strong ? 15 : 13, fontWeight: r.strong ? 700 : 400, color: r.strong ? T.text : T.muted }}
        >
          {r.label}:{' '}
          <span style={{ fontWeight: r.strong ? 700 : 600, color: T.text, fontFamily: T.mono }}>
            {money(r.value, currency)}
          </span>
        </div>
      ))}
    </>
  );
}
