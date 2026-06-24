import type { Invoice } from '../types.js';
import { T } from '../theme.js';
import { money, dateFmt, confLabel } from '../format.js';
import { SummaryBreakdown } from '../components/SummaryBreakdown.js';

// ---------------------------------------------------------------------------
// CompareOverlay — Source ⇄ extraction
// Pure render from props; calls nothing on mount.
// ---------------------------------------------------------------------------
export function CompareOverlay({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const currency = invoice.currency ?? 'USD';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(16,18,21,.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.bg,
          borderRadius: 12,
          width: '100%',
          maxWidth: 1140,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,.22)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 24px',
          borderBottom: `1px solid ${T.border}`,
          background: T.panel,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>Source ⇄ extraction</div>
            <div style={{ fontSize: 13, color: T.muted, marginTop: 3 }}>
              {invoice.vendorName} · {invoice.fileName}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: `1px solid ${T.border}`,
              borderRadius: 7,
              width: 30,
              height: 30,
              cursor: 'pointer',
              fontSize: 16,
              color: T.muted,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontFamily: T.font,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Two-column body */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 0,
        }}>
          {/* LEFT — Source document */}
          <div style={{ padding: '20px 24px', borderRight: `1px solid ${T.border}` }}>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              color: T.muted,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: 14,
            }}>
              Source document
            </div>

            {/* Paper card */}
            <div style={{
              background: '#fff',
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: '20px 22px',
              fontFamily: T.font,
              boxShadow: '0 2px 10px rgba(0,0,0,.06)',
            }}>
              {/* Vendor block + INVOICE label */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>
                    {invoice.vendorName ?? '—'}
                  </div>
                  {invoice.vendorAddress && (
                    <div style={{ fontSize: 12, color: T.muted, marginTop: 3, whiteSpace: 'pre-line' }}>
                      {invoice.vendorAddress}
                    </div>
                  )}
                  {invoice.vendorTaxId && (
                    <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>
                      Tax ID: {invoice.vendorTaxId}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: T.text, letterSpacing: '0.04em' }}>
                    INVOICE
                  </div>
                  {invoice.invoiceNumber && (
                    <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                      #{invoice.invoiceNumber}
                    </div>
                  )}
                </div>
              </div>

              {/* Date/PO/Terms row */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 8,
                marginBottom: 18,
                padding: '10px 0',
                borderTop: `1px solid ${T.border}`,
                borderBottom: `1px solid ${T.border}`,
              }}>
                {[
                  { label: 'Date', value: dateFmt(invoice.invoiceDate) },
                  { label: 'Due', value: dateFmt(invoice.dueDate) },
                  { label: 'PO #', value: invoice.poNumber ?? '—' },
                  { label: 'Terms', value: invoice.paymentTerms ?? '—' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.muted, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 2 }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Line-item table */}
              {invoice.lineItems && invoice.lineItems.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                      {['Description', 'HSN/SAC', 'Qty', 'Unit', 'Amount'].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: '6px 6px 6px 0',
                            textAlign: h === 'Description' || h === 'HSN/SAC' ? 'left' : 'right',
                            fontSize: 10,
                            fontWeight: 700,
                            color: T.muted,
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.lineItems.map((it, i) => (
                      <tr key={it.id ?? i} style={{ borderBottom: `1px solid ${T.border}` }}>
                        <td style={{ padding: '7px 6px 7px 0', color: T.text }}>{it.description ?? '—'}</td>
                        <td style={{ padding: '7px 6px 7px 0', color: T.muted, fontFamily: T.mono }}>{it.hsnSac ?? '—'}</td>
                        <td style={{ padding: '7px 0', textAlign: 'right', color: T.muted }}>{it.quantity ?? '—'}</td>
                        <td style={{ padding: '7px 0', textAlign: 'right', color: T.muted, fontFamily: T.mono }}>
                          {money(it.unitPrice, currency)}
                        </td>
                        <td style={{ padding: '7px 0', textAlign: 'right', fontWeight: 600, color: T.text, fontFamily: T.mono }}>
                          {money(it.amount, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ fontSize: 12, color: T.muted, fontStyle: 'italic', marginBottom: 16, padding: '10px 0' }}>
                  No structured line items were extracted.
                </div>
              )}

              {/* GST breakdown summary */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <SummaryBreakdown inv={invoice} currency={currency} />
              </div>
            </div>
          </div>

          {/* RIGHT — Raw OCR output */}
          <div style={{ padding: '20px 24px' }}>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              color: T.muted,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: 14,
            }}>
              Raw OCR output
            </div>

            {/* OCR meta badge */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12,
              flexWrap: 'wrap',
            }}>
              {invoice.provider && (
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: T.accent,
                  background: T.accentSoft,
                  border: `1px solid #c7c2ff`,
                  borderRadius: 20,
                  padding: '2px 9px',
                }}>
                  {invoice.provider}
                </span>
              )}
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                color: T.muted,
                background: T.rail,
                border: `1px solid ${T.border}`,
                borderRadius: 20,
                padding: '2px 9px',
              }}>
                {confLabel(invoice.confidence)}
              </span>
            </div>

            {/* Raw text or placeholder */}
            {invoice.rawText ? (
              <pre style={{
                fontFamily: T.mono,
                fontSize: 11,
                background: '#1c1a17',
                color: '#e8e4dc',
                padding: '16px 18px',
                borderRadius: 8,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: 0,
                lineHeight: 1.6,
                maxHeight: '60vh',
              }}>
                {invoice.rawText}
              </pre>
            ) : (
              <div style={{
                padding: '24px 20px',
                background: T.rail,
                border: `1px solid ${T.border}`,
                borderRadius: 8,
                fontSize: 13,
                color: T.muted,
                fontStyle: 'italic',
                textAlign: 'center',
              }}>
                No OCR text — extraction did not complete.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
