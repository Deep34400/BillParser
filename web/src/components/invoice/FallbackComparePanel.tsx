import { useState, type ReactNode } from 'react';
import type { Invoice } from '../../types/index.js';
import { T } from '../../theme.js';
import { amount, costFmt } from '../../lib/format.js';

type FallbackHist = NonNullable<Invoice['fallbackHistory']>[number];

function fmtVal(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toLocaleString('en-IN') : '—';
  return String(v);
}

function buildMissSummary(primary: FallbackHist | undefined, winner: FallbackHist | undefined): string[] {
  const notes: string[] = [];
  if (!primary || !winner) return notes;
  if (primary.error) {
    notes.push(`Primary (${primary.model}) failed with API error — no usable OCR data.`);
    return notes;
  }
  const a = primary.parsed_snapshot;
  const b = winner.parsed_snapshot;

  // Always lead with reconciliation story when Primary mismatched
  if (primary.difference != null && !primary.reconciliation_matched) {
    notes.push(
      `Primary (${primary.model}) totals did not match: calculated ₹${fmtVal(primary.calculated_total)} vs printed ₹${fmtVal(primary.grand_total_invoice)} → diff ₹${primary.difference.toLocaleString('en-IN')}.`,
    );
    if (winner.reconciliation_matched) {
      notes.push(
        `${winner.label} (${winner.model}) matched: calculated ₹${fmtVal(winner.calculated_total)} ≈ printed ₹${fmtVal(winner.grand_total_invoice)}.`,
      );
    }
  }

  if (!a && !b) {
    if (notes.length === 0) notes.push('No stored OCR snapshots for this invoice — re-extract to capture Primary vs Secondary details.');
    return notes;
  }
  if (!a && b) {
    notes.push(`Primary had no snapshot; ${winner.label} produced the saved OCR.`);
    return notes;
  }
  if (!b) return notes;

  const pa = a!;
  const checks: [string, unknown, unknown][] = [
    ['Company name', pa.company_name, b.company_name],
    ['Invoice number', pa.invoice_number, b.invoice_number],
    ['GSTIN', pa.gstin, b.gstin],
    ['PAN', pa.pan, b.pan],
    ['Invoice date', pa.invoice_date, b.invoice_date],
    ['Registration', pa.vehicle_details?.registration_number, b.vehicle_details?.registration_number],
    ['Grand total (printed)', pa.totals_and_tax_summary?.grand_total_invoice, b.totals_and_tax_summary?.grand_total_invoice],
    ['Parts total', pa.totals_and_tax_summary?.parts_total, b.totals_and_tax_summary?.parts_total],
    ['Labour total', pa.totals_and_tax_summary?.labour_total, b.totals_and_tax_summary?.labour_total],
  ];
  for (const [label, left, right] of checks) {
    const lEmpty = left == null || left === '';
    const rEmpty = right == null || right === '';
    if (lEmpty && !rEmpty) notes.push(`${label}: Primary missed — ${winner.label} got "${fmtVal(right)}"`);
    else if (!lEmpty && !rEmpty && String(left) !== String(right)) {
      notes.push(`${label}: Primary="${fmtVal(left)}" → ${winner.label}="${fmtVal(right)}"`);
    }
  }
  const pParts = pa.parts_line_items?.length ?? primary.summary?.parts_count ?? 0;
  const wParts = b.parts_line_items?.length ?? winner.summary?.parts_count ?? 0;
  const pLab = pa.labour_service_line_items?.length ?? primary.summary?.labour_count ?? 0;
  const wLab = b.labour_service_line_items?.length ?? winner.summary?.labour_count ?? 0;
  if (pParts !== wParts) notes.push(`Parts lines: Primary extracted ${pParts} → ${winner.label} extracted ${wParts} (likely cause of totals mismatch)`);
  if (pLab !== wLab) notes.push(`Labour lines: Primary extracted ${pLab} → ${winner.label} extracted ${wLab}`);
  if (notes.length === 0) notes.push('Key header fields look similar — difference is mainly in line/totals math.');
  return notes;
}


const lineTh: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: T.muted,
  textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: `1px solid ${T.border}`,
  background: T.rail, whiteSpace: 'nowrap',
};
const lineTd: React.CSSProperties = {
  padding: '7px 10px', fontSize: 12, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top',
};

/** One attempt's parts + labour tables (same look as invoice breakdown) */
function AttemptLinesView({ attempt, title }: { attempt: FallbackHist; title?: string }) {
  const [showExtras, setShowExtras] = useState(false);
  const p = attempt.parsed_snapshot;
  if (attempt.error) {
    return <div style={{ fontSize: 12, color: T.red, padding: 12 }}>API error — no lines. {attempt.error}</div>;
  }
  if (!p) {
    return <div style={{ fontSize: 12, color: T.muted, padding: 12 }}>No snapshot — Re-extract to load this model's lines.</div>;
  }
  const parts = p.parts_line_items ?? [];
  const labour = p.labour_service_line_items ?? [];
  const t = p.totals_and_tax_summary;

  const hasIgst = t && ((t.parts_igst_amount ?? 0) !== 0 || (t.labour_igst_amount ?? 0) !== 0
    || (t.parts_igst_rate ?? 0) > 0 || (t.labour_igst_rate ?? 0) > 0);
  const showGst = !!t && (hasIgst || t.parts_cgst_rate != null || t.labour_cgst_rate != null
    || t.parts_cgst_amount != null || t.labour_cgst_amount != null || !!p.gstin);
  const hasDeductibles = t != null && t.deductibles != null && t.deductibles !== 0;
  const hasSalvage = t != null && t.salvage != null && t.salvage !== 0;

  const sumLabel: React.CSSProperties = {
    padding: '7px 12px', fontSize: 12, textAlign: 'left', color: T.muted,
    borderBottom: `1px solid ${T.border}`,
  };
  const sumCell: React.CSSProperties = {
    padding: '7px 12px', fontSize: 12, textAlign: 'right', fontFamily: T.mono,
    color: T.text, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap',
  };

  return (
    <div>
      {title && (
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: T.text }}>
          {title}
          {attempt.reconciliation_matched
            ? <span style={{ marginLeft: 8, fontSize: 10, color: T.green }}>MATCHED</span>
            : <span style={{ marginLeft: 8, fontSize: 10, color: T.red }}>
                DIFF ₹{attempt.difference != null ? attempt.difference.toLocaleString('en-IN') : '—'}
              </span>}
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, marginBottom: 6 }}>
        PARTS · {parts.length} items
        {t?.parts_total != null && <span style={{ marginLeft: 8, fontFamily: T.mono }}>total {amount(t.parts_total)}</span>}
      </div>
      {parts.length === 0 ? (
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 14 }}>No parts lines</div>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: 16, border: `1px solid ${T.border}`, borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: T.font }}>
            <thead>
              <tr>
                <th style={lineTh}>#</th>
                <th style={lineTh}>Description</th>
                <th style={lineTh}>Part no.</th>
                <th style={{ ...lineTh, textAlign: 'right' }}>Qty</th>
                <th style={{ ...lineTh, textAlign: 'right' }}>Rate</th>
                <th style={{ ...lineTh, textAlign: 'right' }}>Taxable</th>
                <th style={{ ...lineTh, textAlign: 'right' }}>Tax %</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((row, i) => (
                <tr key={i}>
                  <td style={{ ...lineTd, color: T.muted }}>{i + 1}</td>
                  <td style={lineTd}>{row.item_name_description ?? '—'}</td>
                  <td style={{ ...lineTd, fontFamily: T.mono, fontSize: 11 }}>{row.part_number_item_code ?? '—'}</td>
                  <td style={{ ...lineTd, textAlign: 'right', fontFamily: T.mono }}>{row.quantity ?? '—'}</td>
                  <td style={{ ...lineTd, textAlign: 'right', fontFamily: T.mono }}>{amount(row.rate)}</td>
                  <td style={{ ...lineTd, textAlign: 'right', fontFamily: T.mono }}>{amount(row.taxable_amount)}</td>
                  <td style={{ ...lineTd, textAlign: 'right' }}>{row.tax_percentage != null ? `${row.tax_percentage}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, marginBottom: 6 }}>
        LABOUR · {labour.length} items
        {t?.labour_total != null && <span style={{ marginLeft: 8, fontFamily: T.mono }}>total {amount(t.labour_total)}</span>}
      </div>
      {labour.length === 0 ? (
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 14 }}>No labour lines</div>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: 16, border: `1px solid ${T.border}`, borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: T.font }}>
            <thead>
              <tr>
                <th style={lineTh}>#</th>
                <th style={lineTh}>Description</th>
                <th style={lineTh}>Code</th>
                <th style={{ ...lineTh, textAlign: 'right' }}>Charges</th>
                <th style={{ ...lineTh, textAlign: 'right' }}>Tax %</th>
              </tr>
            </thead>
            <tbody>
              {labour.map((row, i) => (
                <tr key={i}>
                  <td style={{ ...lineTd, color: T.muted }}>{i + 1}</td>
                  <td style={lineTd}>{row.labour_description ?? '—'}</td>
                  <td style={{ ...lineTd, fontFamily: T.mono, fontSize: 11 }}>{row.labour_code ?? '—'}</td>
                  <td style={{ ...lineTd, textAlign: 'right', fontFamily: T.mono }}>{amount(row.labour_charges)}</td>
                  <td style={{ ...lineTd, textAlign: 'right' }}>{row.tax_percentage != null ? `${row.tax_percentage}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bill summary with GST — same shape as main invoice UI */}
      {t && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Bill summary (GST)
          </div>
          <div style={{ overflowX: 'auto', border: `1px solid ${T.border}`, borderRadius: 8 }}>
            <table style={{ borderCollapse: 'collapse', minWidth: 320, width: '100%', marginLeft: 'auto', fontFamily: T.font }}>
              <thead>
                <tr>
                  <th style={{ ...sumLabel, background: T.rail, fontWeight: 600 }} />
                  <th style={{ ...sumCell, background: T.rail, fontSize: 10, fontWeight: 700, color: T.muted, textTransform: 'uppercase' }}>Parts</th>
                  <th style={{ ...sumCell, background: T.rail, fontSize: 10, fontWeight: 700, color: T.muted, textTransform: 'uppercase' }}>Labour</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={sumLabel}>Sub Total</td>
                  <td style={sumCell}>{amount(t.parts_total)}</td>
                  <td style={sumCell}>{amount(t.labour_total)}</td>
                </tr>
                <tr>
                  <td style={sumLabel}>Less Discount</td>
                  <td style={sumCell}>{amount(t.parts_discount)}</td>
                  <td style={sumCell}>{amount(t.labour_discount ?? (t.labour_total === 0 ? 0 : null))}</td>
                </tr>
                {showGst && !hasIgst && (
                  <>
                    <tr>
                      <td style={sumLabel}>
                        CGST{t.parts_cgst_rate != null ? ` @ ${t.parts_cgst_rate}%` : ''}
                      </td>
                      <td style={sumCell}>{amount(t.parts_cgst_amount)}</td>
                      <td style={sumCell}>{amount(t.labour_cgst_amount ?? (t.labour_total === 0 ? 0 : null))}</td>
                    </tr>
                    <tr>
                      <td style={sumLabel}>
                        SGST{t.parts_sgst_rate != null ? ` @ ${t.parts_sgst_rate}%` : ''}
                      </td>
                      <td style={sumCell}>{amount(t.parts_sgst_amount)}</td>
                      <td style={sumCell}>{amount(t.labour_sgst_amount ?? (t.labour_total === 0 ? 0 : null))}</td>
                    </tr>
                  </>
                )}
                {showGst && hasIgst && (
                  <tr>
                    <td style={sumLabel}>
                      IGST{t.parts_igst_rate != null ? ` @ ${t.parts_igst_rate}%` : ''}
                    </td>
                    <td style={sumCell}>{amount(t.parts_igst_amount)}</td>
                    <td style={sumCell}>{amount(t.labour_igst_amount)}</td>
                  </tr>
                )}
                <tr>
                  <td style={{ ...sumLabel, fontWeight: 600, color: T.text }}>Sub Total (after discount &amp; tax)</td>
                  <td style={{ ...sumCell, fontWeight: 600 }}>
                    {amount(
                      (t.parts_total ?? 0) - (t.parts_discount ?? 0) - (t.parts_special_discount ?? 0)
                      + (t.parts_cgst_amount ?? 0) + (t.parts_sgst_amount ?? 0) + (t.parts_igst_amount ?? 0),
                    )}
                  </td>
                  <td style={{ ...sumCell, fontWeight: 600 }}>
                    {amount(
                      (t.labour_total ?? 0) - (t.labour_discount ?? 0) - (t.labour_special_discount ?? 0)
                      + (t.labour_cgst_amount ?? 0) + (t.labour_sgst_amount ?? 0) + (t.labour_igst_amount ?? 0),
                    )}
                  </td>
                </tr>
                {showExtras && (hasDeductibles || hasSalvage) && (
                  <>
                    <tr>
                      <td style={{ ...sumLabel, color: T.muted }}>Adjustments</td>
                      <td style={sumCell}>—</td>
                      <td style={sumCell}>—</td>
                    </tr>
                    {hasDeductibles && (
                      <tr>
                        <td style={sumLabel}>Deductibles</td>
                        <td colSpan={2} style={{ ...sumCell, textAlign: 'right' }}>{amount(t.deductibles)}</td>
                      </tr>
                    )}
                    {hasSalvage && (
                      <tr>
                        <td style={sumLabel}>Salvage</td>
                        <td colSpan={2} style={{ ...sumCell, textAlign: 'right' }}>{amount(t.salvage)}</td>
                      </tr>
                    )}
                  </>
                )}
                <tr>
                  <td style={{ ...sumLabel, fontWeight: 700, color: T.text, borderTop: `2px solid ${T.border}`, borderBottom: 'none', paddingTop: 10 }}>
                    Net Bill Amount (Rounded)
                  </td>
                  <td
                    colSpan={2}
                    style={{ ...sumCell, fontSize: 14, fontWeight: 700, color: T.accent, borderTop: `2px solid ${T.border}`, borderBottom: 'none', paddingTop: 10 }}
                  >
                    {amount(t.grand_total_invoice)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {(hasDeductibles || hasSalvage) && (
            <div style={{ textAlign: 'right', marginTop: 6 }}>
              <button
                type="button"
                onClick={() => setShowExtras((v) => !v)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontFamily: T.font,
                  fontSize: 11, fontWeight: 600, color: T.muted, textDecoration: 'underline',
                }}
              >
                {showExtras ? 'Hide deductibles / salvage' : 'Show deductibles / salvage'}
              </button>
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: T.muted, fontFamily: T.mono }}>
            Reconcile calc: {amount(attempt.calculated_total)}
            {attempt.difference != null && !attempt.reconciliation_matched && (
              <span style={{ color: T.red, fontWeight: 700 }}> · diff ₹{attempt.difference.toLocaleString('en-IN')}</span>
            )}
            {attempt.reconciliation_matched && <span style={{ color: T.green, fontWeight: 700 }}> · matched</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function LinesComparePanel({ history }: { history: NonNullable<Invoice['fallbackHistory']> }) {
  const withData = history.filter((h) => h.parsed_snapshot || h.error);
  if (withData.length === 0) {
    return (
      <div style={{ fontSize: 12, color: T.muted, padding: 8 }}>
        No line snapshots stored. Click <strong>Re-extract</strong> to capture.
      </div>
    );
  }

  const cols = Math.min(withData.length, 3);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14 }}>
      {withData.map((h, i) => (
        <div key={h.level} style={{
          border: `1px solid ${h.reconciliation_matched ? '#c3e6cb' : i === 0 ? '#f5c6cb' : '#fde2b3'}`,
          borderRadius: 8, padding: 12, minWidth: 0,
          background: h.reconciliation_matched ? '#f8fdf9' : i === 0 ? '#fef8f8' : '#fffcf5',
        }}>
          <AttemptLinesView attempt={h} title={`${h.label} — ${h.model}`} />
        </div>
      ))}
    </div>
  );
}

function moneyCell(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `₹${n.toLocaleString('en-IN')}`;
}

function ReconStatus({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok == null) return <span style={{ color: T.muted }}>—</span>;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
      background: ok ? T.successSoft : T.dangerSoft,
      color: ok ? T.green : T.red,
    }}>{label}</span>
  );
}


export function FallbackComparePanel({
  history,
  compact = false,
}: {
  history: NonNullable<Invoice['fallbackHistory']>;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [section, setSection] = useState<'overview' | 'recon' | 'lines'>('overview');
  const winner = [...history].reverse().find((h) => h.reconciliation_matched) ?? history[history.length - 1];
  const primary = history[0];
  const missNotes = buildMissSummary(primary, winner);
  const hasSnapshots = history.some((h) => h.parsed_snapshot || h.summary || h.recon_breakdown);
  const totalCost = history.reduce((s, h) => s + (h.cost_usd ?? 0), 0);
  const matched = winner?.reconciliation_matched;

  const pill: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
    display: 'inline-flex', alignItems: 'center',
  };

  return (
    <div style={{
      margin: compact ? 0 : '12px 30px 0',
      background: T.panel,
      border: `1px solid ${matched ? '#c3e6cb' : '#fde2b3'}`,
      borderRadius: 10,
      overflow: 'hidden',
      fontFamily: T.font,
    }}>
      {/* Compact banner — always visible */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '12px 18px',
          background: matched ? '#f0faf3' : '#fffbf0',
          cursor: 'pointer', userSelect: 'none',
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        <span style={{ ...pill, background: matched ? T.green : T.amber, color: '#fff' }}>
          {matched ? '✓ MATCHED' : 'FALLBACK'}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
          via <strong>{winner?.model ?? '—'}</strong>
          <span style={{ color: T.muted, fontWeight: 400 }}> ({winner?.label})</span>
        </span>
        <span style={{ fontSize: 11, color: T.muted, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>{history.length} models</span>
          {totalCost > 0 && <span style={{ fontFamily: T.mono }}>{costFmt(totalCost)}</span>}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: T.accent, fontWeight: 600 }}>
          {expanded ? '▾ Hide' : '▸ Compare'}
        </span>
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${T.border}` }}>
          <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, background: T.rail }}>
            {([['overview', 'Overview'], ['recon', 'Reconciliation'], ['lines', 'Side-by-side']] as const).map(([key, lbl]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key)}
                style={{
                  padding: '10px 18px', border: 'none', cursor: 'pointer', fontFamily: T.font,
                  fontSize: 12, fontWeight: 600, background: 'transparent',
                  color: section === key ? T.accent : T.muted,
                  borderBottom: section === key ? `2px solid ${T.accent}` : '2px solid transparent',
                }}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div style={{ padding: '16px 18px' }}>
            {section === 'overview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Attempt rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {history.map((h, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                      padding: '8px 12px', borderRadius: 8, fontSize: 12,
                      background: h.reconciliation_matched ? '#f0faf3' : h.error ? '#fef2f2' : '#fffbf0',
                      border: `1px solid ${h.reconciliation_matched ? '#c3e6cb' : h.error ? '#f5c6cb' : '#fde2b3'}`,
                    }}>
                      <span style={{ ...pill, background: h.reconciliation_matched ? T.green : h.error ? T.red : T.amber, color: '#fff' }}>
                        {h.label}
                      </span>
                      <span style={{ fontWeight: 600 }}>{h.model}</span>
                      <span style={{ color: T.muted }}>
                        {h.error ? 'API error' : h.reconciliation_matched ? '✓ Matched — saved' : `Diff ₹${h.difference?.toLocaleString('en-IN') ?? '?'}`}
                      </span>
                      {h.cost_usd > 0 && (
                        <span style={{ marginLeft: 'auto', fontFamily: T.mono, fontSize: 11, color: T.muted }}>{costFmt(h.cost_usd)}</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Side-by-side field + recon comparison table */}
                <SideBySideFieldsRecon history={history} />

                {missNotes.length > 0 && (
                  <div style={{ background: T.rail, borderRadius: 8, padding: '12px 16px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                      What changed
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.8, color: T.text }}>
                      {missNotes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                  </div>
                )}

                {!hasSnapshots && (
                  <div style={{ fontSize: 12, color: T.amber, background: '#fffbf0', borderRadius: 8, padding: '10px 14px', border: `1px solid #fde2b3` }}>
                    Click <strong>Re-extract</strong> to capture recon snapshots.
                  </div>
                )}
              </div>
            )}

            {section === 'recon' && (
              <ReconDetailTable history={history} />
            )}

            {section === 'lines' && (
              <LinesComparePanel history={history} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Combined side-by-side: fields + recon in one table — both models visible at once */
function SideBySideFieldsRecon({ history }: { history: NonNullable<Invoice['fallbackHistory']> }) {
  const cellH: React.CSSProperties = {
    padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.muted,
    textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: `2px solid ${T.border}`,
    background: T.rail,
  };
  const cellL: React.CSSProperties = {
    padding: '7px 10px', fontSize: 12, fontWeight: 600, color: T.muted,
    borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap',
  };
  const cellV: React.CSSProperties = {
    padding: '7px 10px', fontSize: 12, fontFamily: T.mono, color: T.text,
    borderBottom: `1px solid ${T.border}`, wordBreak: 'break-word',
  };

  type Row = { label: string; vals: (string | ReactNode)[] };

  const fieldRows: Row[] = [];
  const reconRows: Row[] = [];

  const fieldChecks: [string, (h: FallbackHist) => string][] = [
    ['Company', (h) => fmtVal(h.parsed_snapshot?.company_name ?? h.summary?.company_name)],
    ['Invoice #', (h) => fmtVal(h.parsed_snapshot?.invoice_number ?? h.summary?.invoice_number)],
    ['GSTIN', (h) => fmtVal(h.parsed_snapshot?.gstin ?? h.summary?.gstin)],
    ['PAN', (h) => fmtVal(h.parsed_snapshot?.pan)],
    ['Invoice date', (h) => fmtVal(h.parsed_snapshot?.invoice_date)],
    ['Registration', (h) => fmtVal(h.parsed_snapshot?.vehicle_details?.registration_number)],
    ['Parts lines', (h) => String(h.parsed_snapshot?.parts_line_items?.length ?? h.summary?.parts_count ?? '—')],
    ['Labour lines', (h) => String(h.parsed_snapshot?.labour_service_line_items?.length ?? h.summary?.labour_count ?? '—')],
  ];

  for (const [label, getter] of fieldChecks) {
    const vals = history.map(getter);
    const allSame = vals.every((v) => v === vals[0]);
    fieldRows.push({ label, vals: vals.map((v, i) => allSame ? v : <strong style={{ color: i === 0 ? T.red : T.green }}>{v}</strong>) });
  }

  const reconChecks: [string, (h: FallbackHist) => string | ReactNode][] = [
    ['Parts base (Σ lines)', (h) => moneyCell(h.recon_breakdown?.parts_base)],
    ['Parts total (printed)', (h) => moneyCell(h.recon_breakdown?.parts_total ?? h.summary?.parts_total)],
    ['Parts match', (h) => {
      const b = h.recon_breakdown;
      if (!b) return '—';
      return <ReconStatus ok={b.parts_base_ok} label={b.parts_base_ok ? 'OK' : `FAIL ₹${b.parts_base_diff}`} />;
    }],
    ['Labour base (Σ lines)', (h) => moneyCell(h.recon_breakdown?.labour_base)],
    ['Labour total (printed)', (h) => moneyCell(h.recon_breakdown?.labour_total ?? h.summary?.labour_total)],
    ['Labour match', (h) => {
      const b = h.recon_breakdown;
      if (!b) return '—';
      return <ReconStatus ok={b.labour_base_ok} label={b.labour_base_ok ? 'OK' : `FAIL ₹${b.labour_base_diff}`} />;
    }],
    ['Grand total (printed)', (h) => moneyCell(h.recon_breakdown?.grand_total_invoice ?? h.grand_total_invoice ?? h.summary?.grand_total)],
    ['Calculated total', (h) => moneyCell(h.recon_breakdown?.calculated_total ?? h.calculated_total)],
    ['Final verdict', (h) => {
      if (h.error) return <ReconStatus ok={false} label="API ERROR" />;
      if (h.reconciliation_matched) return <ReconStatus ok={true} label="MATCHED" />;
      const d = h.recon_breakdown?.difference ?? h.difference;
      return <ReconStatus ok={false} label={d != null ? `FAIL ₹${d.toLocaleString('en-IN')}` : 'FAIL'} />;
    }],
  ];

  for (const [label, getter] of reconChecks) {
    reconRows.push({ label, vals: history.map(getter) });
  }

  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${T.border}`, borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: T.font }}>
        <thead>
          <tr>
            <th style={{ ...cellH, textAlign: 'left', minWidth: 140 }}>Field</th>
            {history.map((h) => (
              <th key={h.level} style={{ ...cellH, textAlign: 'left' }}>
                {h.label}
                <span style={{ fontWeight: 500, textTransform: 'none', marginLeft: 6 }}>{h.model}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fieldRows.map((r) => (
            <tr key={r.label}>
              <td style={cellL}>{r.label}</td>
              {r.vals.map((v, i) => <td key={i} style={cellV}>{v}</td>)}
            </tr>
          ))}
          <tr>
            <td colSpan={1 + history.length} style={{ padding: '10px 10px 4px', fontSize: 10, fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.04em', background: T.rail, borderBottom: `1px solid ${T.border}` }}>
              Reconciliation
            </td>
          </tr>
          {reconRows.map((r) => (
            <tr key={r.label}>
              <td style={cellL}>{r.label}</td>
              {r.vals.map((v, i) => <td key={i} style={cellV}>{v}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReconDetailTable({ history }: { history: NonNullable<Invoice['fallbackHistory']> }) {
  const withRecon = history.filter((h) => h.recon_breakdown || h.difference != null);
  if (withRecon.length === 0) {
    return <div style={{ fontSize: 12, color: T.muted }}>No reconciliation data. Click <strong>Re-extract</strong> to capture.</div>;
  }

  const thS: React.CSSProperties = {
    padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: T.muted,
    textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: `2px solid ${T.border}`, background: T.rail,
  };
  const tdL: React.CSSProperties = { padding: '8px 10px', fontSize: 12, fontWeight: 600, color: T.muted, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' };
  const tdV: React.CSSProperties = { padding: '8px 10px', fontSize: 12, fontFamily: T.mono, color: T.text, borderBottom: `1px solid ${T.border}` };

  type Row = { label: string; hint: string; get: (h: FallbackHist) => ReactNode };
  const rows: Row[] = [
    { label: 'Parts base (Σ lines)', hint: 'Sum of qty × rate', get: (h) => moneyCell(h.recon_breakdown?.parts_base) },
    { label: 'Parts total (printed)', hint: 'On invoice header', get: (h) => moneyCell(h.recon_breakdown?.parts_total ?? h.summary?.parts_total) },
    { label: 'Parts match', hint: 'Within ₹2?', get: (h) => {
      const b = h.recon_breakdown; if (!b) return '—';
      return <ReconStatus ok={b.parts_base_ok} label={b.parts_base_ok ? 'OK' : `FAIL ₹${b.parts_base_diff}`} />;
    }},
    { label: 'Labour base (Σ lines)', hint: 'Sum of charges', get: (h) => moneyCell(h.recon_breakdown?.labour_base) },
    { label: 'Labour total (printed)', hint: 'On invoice header', get: (h) => moneyCell(h.recon_breakdown?.labour_total ?? h.summary?.labour_total) },
    { label: 'Labour match', hint: 'Within ₹2?', get: (h) => {
      const b = h.recon_breakdown; if (!b) return '—';
      return <ReconStatus ok={b.labour_base_ok} label={b.labour_base_ok ? 'OK' : `FAIL ₹${b.labour_base_diff}`} />;
    }},
    { label: 'Line counts', hint: 'Parts / labour', get: (h) => `${h.recon_breakdown?.parts_count ?? h.summary?.parts_count ?? '—'} / ${h.recon_breakdown?.labour_count ?? h.summary?.labour_count ?? '—'}` },
    { label: 'Calculated total', hint: 'Lines + tax + deductibles', get: (h) => moneyCell(h.recon_breakdown?.calculated_total ?? h.calculated_total) },
    { label: 'Printed grand total', hint: 'grand_total_invoice', get: (h) => moneyCell(h.recon_breakdown?.grand_total_invoice ?? h.grand_total_invoice ?? h.summary?.grand_total) },
    { label: 'Final verdict', hint: 'Calc vs printed ≤ ₹2', get: (h) => {
      if (h.error) return <ReconStatus ok={false} label="API ERROR" />;
      if (h.reconciliation_matched) return <ReconStatus ok={true} label="MATCHED" />;
      const d = h.recon_breakdown?.difference ?? h.difference;
      return <ReconStatus ok={false} label={d != null ? `FAIL ₹${d.toLocaleString('en-IN')}` : 'FAIL'} />;
    }},
  ];

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ fontSize: 11, color: T.muted, marginBottom: 10 }}>
        Parts base = Σ line amounts. Parts total = printed on invoice. Large diff = missed/misread lines.
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: T.font }}>
        <thead>
          <tr>
            <th style={{ ...thS, minWidth: 160 }}>Check</th>
            {history.map((h) => (
              <th key={h.level} style={thS}>
                {h.label} <span style={{ fontWeight: 500, textTransform: 'none' }}>({h.model})</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td style={tdL}>
                <div>{row.label}</div>
                <div style={{ fontSize: 10, fontWeight: 400, color: T.faint }}>{row.hint}</div>
              </td>
              {history.map((h) => (
                <td key={h.level} style={tdV}>{h.error && !h.recon_breakdown && row.label !== 'Final verdict' ? '—' : row.get(h)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
