import type { Invoice, SummaryColumn } from '../types/index.js';
import { T } from '../theme.js';
import { money } from '../lib/format.js';

// ---------------------------------------------------------------------------
// SummaryColumns — columnwise totals (e.g. Parts | Labour), with the overall
// Net Bill Amount as a single full-width row beneath. Each row renders only
// when at least one column carries a value. Used when inv.summaryColumns has
// entries; otherwise callers fall back to SummaryBreakdown.
// ---------------------------------------------------------------------------
type Key = keyof Pick<SummaryColumn, 'subtotal' | 'discount' | 'cgst' | 'sgst' | 'igst' | 'total'>;
// `forced` rows always render (showing 0.00 when absent) so the summary structure
// is consistent; others render only when a column carries a value.
const ALL_ROWS: { key: Key; label: string; forced?: boolean }[] = [
  { key: 'subtotal', label: 'Sub Total' },
  { key: 'discount', label: 'Less Discounts', forced: true },
  { key: 'cgst', label: 'CGST', forced: true },
  { key: 'sgst', label: 'SGST', forced: true },
  { key: 'igst', label: 'IGST', forced: true },
  { key: 'total', label: 'Sub Total' },
];

export function SummaryColumns({ inv, currency }: { inv: Invoice; currency: string }) {
  const cols = (inv.summaryColumns ?? []).filter(Boolean) as SummaryColumn[];
  if (cols.length === 0) return null;

  // Treat 0 like "not present" for deciding which optional rows to show.
  const present = (v?: number | null) => v != null && v !== 0;
  // Regime: show IGST when any column has it, otherwise CGST + SGST.
  const hasIgst = cols.some((c) => c.igst != null);
  const rows = ALL_ROWS.filter((r) => {
    if (r.key === 'igst') return hasIgst;            // GST regime: IGST...
    if (r.key === 'cgst' || r.key === 'sgst') return !hasIgst; // ...or CGST+SGST
    if (r.forced) return true;                       // Less Discounts always
    return cols.some((c) => present(c[r.key]));      // subtotal / total when present
  });
  const net = inv.netAmount ?? inv.totalAmount;

  const cell: React.CSSProperties = { padding: '5px 14px', fontSize: 13, textAlign: 'right', fontFamily: T.mono, color: T.text, whiteSpace: 'nowrap' };
  const labelCell: React.CSSProperties = { padding: '5px 14px', fontSize: 13, textAlign: 'left', color: T.muted };

  return (
    <table style={{ borderCollapse: 'collapse', minWidth: 360 }}>
      <thead>
        <tr>
          <th style={{ ...labelCell, fontWeight: 600 }} />
          {cols.map((c, i) => (
            <th key={i} style={{ ...cell, fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {c.label ?? `Column ${i + 1}`}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td style={labelCell}>{r.label}</td>
            {cols.map((c, i) => (
              <td key={i} style={{ ...cell, fontWeight: r.key === 'total' ? 600 : 400 }}>
                {present(c[r.key]) ? money(c[r.key], currency) : r.forced ? money(0, currency) : '—'}
              </td>
            ))}
          </tr>
        ))}
        {net != null && (
          <tr>
            <td style={{ ...labelCell, fontWeight: 700, color: T.text, borderTop: `2px solid ${T.border}`, paddingTop: 8 }}>
              Net Bill Amount
            </td>
            <td
              colSpan={cols.length}
              style={{ ...cell, fontSize: 15, fontWeight: 700, borderTop: `2px solid ${T.border}`, paddingTop: 8 }}
            >
              {money(net, currency)}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
