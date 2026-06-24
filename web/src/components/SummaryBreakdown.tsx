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
  const rows: { label: string; value: number; strong?: boolean }[] = [];
  const add = (label: string, value: number | null | undefined, strong = false) => {
    if (value != null) rows.push({ label, value, strong });
  };

  add('Sub Total', inv.subtotal);
  add('Less Discounts', inv.discountAmount);

  const hasGst = inv.cgstAmount != null || inv.sgstAmount != null || inv.igstAmount != null;
  add('CGST', inv.cgstAmount);
  if (inv.sgstAmount != null) add('SGST', inv.sgstAmount);
  else add('IGST', inv.igstAmount);
  if (!hasGst) add('Tax', inv.taxAmount);

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
