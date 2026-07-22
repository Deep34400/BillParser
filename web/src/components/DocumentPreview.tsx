/**
 * Document preview panel — shows selected invoice fields with OCR-style bounding boxes.
 * Orange (--box) is used ONLY here for extraction UI.
 */
import type { Invoice } from '../types/index.js';
import { T, STATUS } from '../theme.js';
import { money } from '../lib/format.js';

interface FieldRow {
  key: string;
  label: string;
  tag: string;
  value: string | null | undefined;
}

function displayStatus(inv: Invoice): string {
  if (inv.status === 'COMPLETED' && !inv.verified) {
    if ((inv.confidence ?? 1) < 0.75) return 'NEEDS_REVIEW';
    if ((inv.reviewReasons?.length ?? 0) > 0) return 'NEEDS_REVIEW';
  }
  return inv.status;
}

function CornerIcon() {
  return (
    <span style={{
      display: 'inline-block', width: 10, height: 10, position: 'relative', flexShrink: 0,
    }}>
      <span style={{
        position: 'absolute', top: 0, left: 0, width: 6, height: 6,
        borderTop: `1.5px solid ${T.box}`, borderLeft: `1.5px solid ${T.box}`,
      }} />
    </span>
  );
}

export function DocumentPreview({ invoice }: { invoice: Invoice | null }) {
  if (!invoice) {
    return (
      <aside className="inv-preview" style={panelStyle}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: T.inkFaint, textTransform: 'uppercase' }}>
          Source document
        </div>
        <div style={{
          marginTop: 24, padding: '40px 16px', textAlign: 'center',
          color: T.inkFaint, fontSize: 13, border: `1px dashed ${T.border}`, borderRadius: 8,
        }}>
          Select an invoice to preview extracted fields
        </div>
      </aside>
    );
  }

  const statusKey = displayStatus(invoice);
  const statusInfo = STATUS[statusKey] ?? { label: invoice.status, color: T.inkFaint };

  const fields: FieldRow[] = [
    { key: 'vendor', label: 'Vendor', tag: 'VENDOR', value: invoice.vendorName },
    { key: 'invoice', label: 'Invoice #', tag: 'INVOICE #', value: invoice.invoiceNumber },
    { key: 'gstin', label: 'GSTIN', tag: 'GSTIN', value: invoice.gstin ?? invoice.vendorTaxId },
    { key: 'pan', label: 'PAN', tag: 'PAN', value: invoice.pan },
    { key: 'reg', label: 'Reg no', tag: 'REG NO', value: invoice.registrationNumber },
    {
      key: 'total',
      label: 'Total',
      tag: 'TOTAL',
      value: invoice.netAmount != null || invoice.totalAmount != null
        ? money(invoice.netAmount ?? invoice.totalAmount, invoice.currency ?? 'INR')
        : null,
    },
  ];

  return (
    <aside className="inv-preview" style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: T.inkFaint, textTransform: 'uppercase' }}>
          Source document
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: statusInfo.color }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusInfo.color }} />
          {statusInfo.label}
        </span>
      </div>

      {/* Review warnings banner */}
      {invoice.reviewReasons && invoice.reviewReasons.length > 0 && (
        <div style={{
          background: invoice.reviewReasons.some((r) => r.startsWith('Duplicate:')) ? '#FEF3CD' : '#FFF8E1',
          border: `1px solid ${invoice.reviewReasons.some((r) => r.startsWith('Duplicate:')) ? '#F0C040' : '#FFE082'}`,
          borderRadius: 6, padding: '10px 12px', marginBottom: 12, fontSize: 12, lineHeight: 1.6,
        }}>
          {invoice.reviewReasons.map((r, i) => (
            <div key={i} style={{
              color: r.startsWith('Duplicate:') ? '#8B6914' : '#F57F17',
              fontWeight: r.startsWith('Duplicate:') ? 600 : 400,
            }}>
              {r.startsWith('Duplicate:') ? '⚠ ' : '• '}{r}
            </div>
          ))}
        </div>
      )}

      {/* Mock document with bounding boxes */}
      <div style={{
        background: '#F3F2EC', borderRadius: 8, padding: 16, marginBottom: 16,
        minHeight: 200, position: 'relative', border: `1px solid ${T.border}`,
      }}>
        <div style={{ fontSize: 11, color: T.inkFaint, marginBottom: 12, fontFamily: T.mono }}>
          {invoice.fileName || 'invoice.pdf'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map((f) => (
            <div key={f.key} style={{
              border: `1.5px dashed ${T.box}`,
              borderRadius: 4,
              padding: '8px 10px 8px 10px',
              background: T.boxSoft,
              position: 'relative',
            }}>
              <span style={{
                position: 'absolute', top: -8, left: 8,
                background: T.box, color: '#fff',
                fontSize: 9, fontWeight: 600, letterSpacing: '0.04em',
                padding: '1px 6px', borderRadius: 3, fontFamily: T.font,
              }}>
                {f.tag}
              </span>
              <div style={{
                fontFamily: T.mono, fontSize: 12, color: f.value ? T.ink : T.inkFaint,
                marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {f.value || '—'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Key / value list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {fields.map((f) => (
          <div key={f.key} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '9px 0', borderBottom: `1px solid ${T.border}`, gap: 12,
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: T.inkSoft }}>
              <CornerIcon />
              {f.label}
            </span>
            <span style={{
              fontFamily: T.mono, fontSize: 12, textAlign: 'right',
              color: f.value ? T.ink : T.inkFaint,
              maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {f.value || '— not found'}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

const panelStyle: React.CSSProperties = {
  width: 380,
  flexShrink: 0,
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  padding: 18,
  position: 'sticky',
  top: 16,
  alignSelf: 'flex-start',
  maxHeight: 'calc(100vh - 40px)',
  overflow: 'auto',
};
