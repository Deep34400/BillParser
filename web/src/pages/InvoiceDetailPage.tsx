import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import type { Invoice, AppConfig, LineItem } from '../types.js';
import { T } from '../theme.js';
import { money, dateFmt, confLabel, costFmt } from '../format.js';
import { StatusDot } from '../components/StatusDot.js';
import { Toast } from '../components/Toast.js';
import { usePolling } from '../hooks/usePolling.js';
import { CompareOverlay } from '../overlays/CompareOverlay.js';
import { BakeoffOverlay } from '../overlays/BakeoffOverlay.js';
import { SummaryBreakdown } from '../components/SummaryBreakdown.js';

// ---------------------------------------------------------------------------
// Editable line item shape
// ---------------------------------------------------------------------------
interface EditLineItem {
  id?: string;
  lineNumber: number;
  description: string;
  sku: string;
  hsnSac: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  taxRate: string;
}

function toEditItems(items: LineItem[]): EditLineItem[] {
  return items.map((it, i) => ({
    id: it.id,
    lineNumber: it.lineNumber ?? i + 1,
    description: it.description ?? '',
    sku: it.sku ?? '',
    hsnSac: it.hsnSac ?? '',
    quantity: it.quantity != null ? String(it.quantity) : '',
    unitPrice: it.unitPrice != null ? String(it.unitPrice) : '',
    amount: it.amount != null ? String(it.amount) : '',
    taxRate: it.taxRate != null ? String(it.taxRate) : '',
  }));
}

function blankEditItem(lineNumber: number): EditLineItem {
  return { lineNumber, description: '', sku: '', hsnSac: '', quantity: '', unitPrice: '', amount: '', taxRate: '' };
}

function parseNum(s: string): number | null {
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// Shared input styles
// ---------------------------------------------------------------------------
const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  fontSize: 13,
  fontFamily: T.font,
  color: T.text,
  background: T.panel,
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: T.muted,
  letterSpacing: '0.04em',
  textTransform: 'uppercase' as const,
  marginBottom: 4,
  display: 'block',
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [inv, setInv] = useState<Invoice | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  // Re-extract state
  const [reProvider, setReProvider] = useState('');
  const [processing, setProcessing] = useState(false);

  // Overlay state
  const [compareOpen, setCompareOpen] = useState(false);
  const [bakeoffOpen, setBakeoffOpen] = useState(false);

  // PDF view / side-by-side state
  const [pdfOpen, setPdfOpen] = useState(false);
  const [comparePane, setComparePane] = useState<'fields' | 'raw'>('fields');

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [editVendorName, setEditVendorName] = useState('');
  const [editVendorAddress, setEditVendorAddress] = useState('');
  const [editVendorTaxId, setEditVendorTaxId] = useState('');
  const [editInvoiceNumber, setEditInvoiceNumber] = useState('');
  const [editPoNumber, setEditPoNumber] = useState('');
  const [editCurrency, setEditCurrency] = useState('');
  const [editPaymentTerms, setEditPaymentTerms] = useState('');
  const [editInvoiceDate, setEditInvoiceDate] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editSubtotal, setEditSubtotal] = useState('');
  const [editDiscountAmount, setEditDiscountAmount] = useState('');
  const [editCgstAmount, setEditCgstAmount] = useState('');
  const [editSgstAmount, setEditSgstAmount] = useState('');
  const [editIgstAmount, setEditIgstAmount] = useState('');
  const [editTaxAmount, setEditTaxAmount] = useState('');
  const [editTotalAmount, setEditTotalAmount] = useState('');
  const [editNetAmount, setEditNetAmount] = useState('');
  const [editItems, setEditItems] = useState<EditLineItem[]>([]);

  // Raw OCR toggle (bottom section, non-split view)
  const [showRaw, setShowRaw] = useState(false);

  // Collapse the PDF split to a single column on narrow viewports
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 900);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const idRef = useRef(id);
  idRef.current = id;

  const reload = useCallback(async () => {
    if (!idRef.current) return;
    try {
      const data = await api.get(idRef.current);
      setInv(data);
      if (!reProvider) setReProvider(data.provider ?? '');
    } catch (_e) {
      // leave existing state
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([api.get(id), api.config()])
      .then(([invData, cfgData]) => {
        setInv(invData);
        setConfig(cfgData);
        setReProvider(invData.provider ?? cfgData.activeProvider ?? '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll while processing or invoice is PENDING/PROCESSING
  usePolling(
    reload,
    () => processing || (inv?.status === 'PENDING' || inv?.status === 'PROCESSING'),
    3000,
  );

  // When invoice status transitions to COMPLETED/FAILED after processing, clear processing flag
  useEffect(() => {
    if (processing && inv && (inv.status === 'COMPLETED' || inv.status === 'FAILED')) {
      setProcessing(false);
      setToast(inv.status === 'COMPLETED' ? 'Re-extraction complete' : 'Re-extraction failed');
    }
  }, [inv?.status, processing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enter edit mode — seed form from current invoice
  function enterEdit() {
    if (!inv) return;
    setEditVendorName(inv.vendorName ?? '');
    setEditVendorAddress(inv.vendorAddress ?? '');
    setEditVendorTaxId(inv.vendorTaxId ?? '');
    setEditInvoiceNumber(inv.invoiceNumber ?? '');
    setEditPoNumber(inv.poNumber ?? '');
    setEditCurrency(inv.currency ?? '');
    setEditPaymentTerms(inv.paymentTerms ?? '');
    setEditInvoiceDate(inv.invoiceDate ?? '');
    setEditDueDate(inv.dueDate ?? '');
    setEditSubtotal(inv.subtotal != null ? String(inv.subtotal) : '');
    setEditDiscountAmount(inv.discountAmount != null ? String(inv.discountAmount) : '');
    setEditCgstAmount(inv.cgstAmount != null ? String(inv.cgstAmount) : '');
    setEditSgstAmount(inv.sgstAmount != null ? String(inv.sgstAmount) : '');
    setEditIgstAmount(inv.igstAmount != null ? String(inv.igstAmount) : '');
    setEditTaxAmount(inv.taxAmount != null ? String(inv.taxAmount) : '');
    setEditTotalAmount(inv.totalAmount != null ? String(inv.totalAmount) : '');
    setEditNetAmount(inv.netAmount != null ? String(inv.netAmount) : '');
    setEditItems(toEditItems(inv.lineItems ?? []));
    setEditMode(true);
  }

  function cancelEdit() {
    setEditMode(false);
  }

  async function saveEdit() {
    if (!id) return;
    const body = {
      vendorName: editVendorName || null,
      vendorAddress: editVendorAddress || null,
      vendorTaxId: editVendorTaxId || null,
      invoiceNumber: editInvoiceNumber || null,
      poNumber: editPoNumber || null,
      currency: editCurrency || null,
      paymentTerms: editPaymentTerms || null,
      invoiceDate: editInvoiceDate || null,
      dueDate: editDueDate || null,
      subtotal: parseNum(editSubtotal),
      discountAmount: parseNum(editDiscountAmount),
      cgstAmount: parseNum(editCgstAmount),
      sgstAmount: parseNum(editSgstAmount),
      igstAmount: parseNum(editIgstAmount),
      taxAmount: parseNum(editTaxAmount),
      totalAmount: parseNum(editTotalAmount),
      netAmount: parseNum(editNetAmount),
      lineItems: editItems.map((it, i) => ({
        id: it.id,
        lineNumber: it.lineNumber ?? i + 1,
        description: it.description || null,
        sku: it.sku || null,
        hsnSac: it.hsnSac || null,
        quantity: parseNum(it.quantity),
        unitPrice: parseNum(it.unitPrice),
        amount: parseNum(it.amount),
        taxRate: parseNum(it.taxRate),
      })),
    };
    try {
      const updated = await api.patch(id, body);
      setInv(updated);
      setEditMode(false);
      setToast('Saved & verified');
    } catch (e) {
      setToast('Save failed: ' + (e instanceof Error ? e.message : 'unknown'));
    }
  }

  async function handleReextract() {
    if (!id) return;
    try {
      await api.reextract(id, reProvider || undefined);
      setProcessing(true);
      setToast('Re-extraction started…');
      await reload();
    } catch (e) {
      setToast('Re-extract failed: ' + (e instanceof Error ? e.message : 'unknown'));
    }
  }

  async function handleDelete() {
    if (!id) return;
    try {
      await api.del(id);
      navigate('/invoices');
    } catch (e) {
      setToast('Delete failed: ' + (e instanceof Error ? e.message : 'unknown'));
    }
  }

  // ---------------------------------------------------------------------------
  // Edit item helpers
  // ---------------------------------------------------------------------------
  function updateEditItem(idx: number, field: keyof EditLineItem, value: string) {
    setEditItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  }

  function removeEditItem(idx: number) {
    setEditItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function addEditItem() {
    setEditItems((prev) => [...prev, blankEditItem(prev.length + 1)]);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div style={{ background: T.bg, minHeight: '100vh', fontFamily: T.font, padding: '32px 30px' }}>
        <div style={{ color: T.muted, fontSize: 14 }}>Loading invoice…</div>
      </div>
    );
  }

  if (!inv) {
    return (
      <div style={{ background: T.bg, minHeight: '100vh', fontFamily: T.font, padding: '32px 30px' }}>
        <div style={{ color: T.red, fontSize: 14 }}>Invoice not found.</div>
      </div>
    );
  }

  const currency = inv.currency ?? 'USD';

  return (
    <div style={{ background: T.bg, minHeight: '100vh', fontFamily: T.font }}>
      {/* Back link */}
      <div style={{ padding: '20px 30px 0' }}>
        <button
          onClick={() => navigate('/invoices')}
          style={{
            background: 'none',
            border: 'none',
            color: T.accent,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            padding: 0,
            fontFamily: T.font,
          }}
        >
          ← All invoices
        </button>
      </div>

      {/* Header card */}
      <div style={{ margin: '16px 30px 0', background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          {/* Left: vendor info + status */}
          <div>
            {/* Status + verified badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <StatusDot status={inv.status} />
              {inv.verified && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: '#e6f7ef', border: `1px solid #a3d9be`, borderRadius: 20,
                  padding: '2px 10px', fontSize: 12, fontWeight: 600, color: T.green,
                }}>
                  ✓ Verified
                </span>
              )}
            </div>
            {/* Vendor name */}
            <div style={{ fontSize: 24, fontWeight: 700, color: T.text, lineHeight: 1.2 }}>
              {inv.vendorName ?? '—'}
            </div>
            {/* Vendor address */}
            {inv.vendorAddress && (
              <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>{inv.vendorAddress}</div>
            )}
            {/* Tax ID · filename */}
            <div style={{ fontSize: 12, color: T.faint, marginTop: 4 }}>
              {[inv.vendorTaxId, inv.fileName].filter(Boolean).join(' · ')}
            </div>
            {/* Manually corrected note */}
            {inv.editedAt && (
              <div style={{ marginTop: 8, fontSize: 12, color: T.green, fontWeight: 500 }}>
                ✓ Manually corrected — marked verified
              </div>
            )}
          </div>

          {/* Right: action row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {!editMode ? (
              <>
                {/* Provider selector */}
                {config && config.providers.length > 0 && (
                  <select
                    value={reProvider}
                    onChange={(e) => setReProvider(e.target.value)}
                    style={{
                      padding: '7px 10px',
                      border: `1px solid ${T.border}`,
                      borderRadius: 7,
                      fontSize: 13,
                      fontFamily: T.font,
                      color: T.text,
                      background: T.panel,
                      cursor: 'pointer',
                    }}
                  >
                    {config.providers.map((p) => (
                      <option key={p.name} value={p.name}>{p.displayName}</option>
                    ))}
                  </select>
                )}

                {/* Re-extract */}
                <button
                  onClick={() => void handleReextract()}
                  disabled={processing}
                  style={{
                    padding: '7px 14px',
                    border: `1px solid ${T.border}`,
                    borderRadius: 7,
                    background: T.panel,
                    color: processing ? T.faint : T.text,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: processing ? 'not-allowed' : 'pointer',
                    fontFamily: T.font,
                  }}
                >
                  {processing ? 'Processing…' : 'Re-extract'}
                </button>

                {/* Compare source */}
                <button
                  onClick={() => setCompareOpen(true)}
                  style={actionBtn}
                >
                  Compare source
                </button>

                {/* Bake-off */}
                <button
                  onClick={() => setBakeoffOpen(true)}
                  style={actionBtn}
                >
                  Bake-off
                </button>

                {/* View PDF toggle — splits the page PDF | parsed */}
                <button
                  onClick={() => setPdfOpen((v) => !v)}
                  style={pdfOpen
                    ? { ...actionBtn, background: T.accentSoft, color: T.accent, border: '1px solid #c7c2ff' }
                    : actionBtn}
                >
                  {pdfOpen ? '✕ Hide PDF' : 'View PDF'}
                </button>

                {/* Edit fields */}
                <button
                  onClick={enterEdit}
                  style={{ ...actionBtn, background: T.accentSoft, color: T.accent, border: `1px solid #c7c2ff` }}
                >
                  Edit fields
                </button>

                {/* Delete */}
                <button
                  onClick={() => void handleDelete()}
                  style={{ ...actionBtn, color: T.red, border: `1px solid #f0b0ac` }}
                >
                  Delete
                </button>
              </>
            ) : (
              <>
                {/* Save & verify */}
                <button
                  onClick={() => void saveEdit()}
                  style={{
                    padding: '7px 16px',
                    border: 'none',
                    borderRadius: 7,
                    background: T.green,
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: T.font,
                  }}
                >
                  Save & verify
                </button>

                {/* Cancel */}
                <button
                  onClick={cancelEdit}
                  style={actionBtn}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Failed error box */}
      {inv.status === 'FAILED' && inv.error && (
        <div style={{
          margin: '12px 30px 0',
          padding: '14px 18px',
          background: '#fff5f5',
          borderLeft: `4px solid ${T.red}`,
          borderRadius: 6,
          fontSize: 13,
          color: T.red,
          fontFamily: T.mono,
        }}>
          {inv.error}
        </div>
      )}

      {/* Main content */}
      <div style={{ padding: '16px 30px 40px' }}>
        {editMode ? (
          /* Edit mode form */
          <EditForm
            editVendorName={editVendorName} setEditVendorName={setEditVendorName}
            editVendorAddress={editVendorAddress} setEditVendorAddress={setEditVendorAddress}
            editVendorTaxId={editVendorTaxId} setEditVendorTaxId={setEditVendorTaxId}
            editInvoiceNumber={editInvoiceNumber} setEditInvoiceNumber={setEditInvoiceNumber}
            editPoNumber={editPoNumber} setEditPoNumber={setEditPoNumber}
            editCurrency={editCurrency} setEditCurrency={setEditCurrency}
            editPaymentTerms={editPaymentTerms} setEditPaymentTerms={setEditPaymentTerms}
            editInvoiceDate={editInvoiceDate} setEditInvoiceDate={setEditInvoiceDate}
            editDueDate={editDueDate} setEditDueDate={setEditDueDate}
            editSubtotal={editSubtotal} setEditSubtotal={setEditSubtotal}
            editDiscountAmount={editDiscountAmount} setEditDiscountAmount={setEditDiscountAmount}
            editCgstAmount={editCgstAmount} setEditCgstAmount={setEditCgstAmount}
            editSgstAmount={editSgstAmount} setEditSgstAmount={setEditSgstAmount}
            editIgstAmount={editIgstAmount} setEditIgstAmount={setEditIgstAmount}
            editTaxAmount={editTaxAmount} setEditTaxAmount={setEditTaxAmount}
            editTotalAmount={editTotalAmount} setEditTotalAmount={setEditTotalAmount}
            editNetAmount={editNetAmount} setEditNetAmount={setEditNetAmount}
            editItems={editItems}
            updateEditItem={updateEditItem}
            removeEditItem={removeEditItem}
            addEditItem={addEditItem}
          />
        ) : pdfOpen ? (
          /* Side-by-side: PDF | parsed output */
          <PdfSplit
            inv={inv}
            currency={currency}
            comparePane={comparePane}
            setComparePane={setComparePane}
            narrow={narrow}
          />
        ) : (
          <>
            {/* Canonical field grid */}
            <FieldGrid inv={inv} currency={currency} />

            {/* Line-item table */}
            <LineItemTable items={inv.lineItems ?? []} currency={currency} inv={inv} />

            {/* Raw OCR section */}
            <div style={{ marginTop: 24 }}>
              <button
                onClick={() => setShowRaw((v) => !v)}
                style={{
                  background: 'none',
                  border: `1px solid ${T.border}`,
                  borderRadius: 7,
                  padding: '6px 14px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: T.muted,
                  cursor: 'pointer',
                  fontFamily: T.font,
                }}
              >
                {showRaw ? 'Hide raw OCR' : 'Show raw OCR'}
              </button>
              {showRaw && (
                <div style={{ marginTop: 10 }}>
                  <RawOcrBlock rawText={inv.rawText} />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Overlays */}
      {compareOpen && (
        <CompareOverlay invoice={inv} onClose={() => setCompareOpen(false)} />
      )}
      {bakeoffOpen && (
        <BakeoffOverlay
          invoice={inv}
          onClose={() => setBakeoffOpen(false)}
          onApplied={() => { setBakeoffOpen(false); void reload(); }}
        />
      )}

      {/* Toast */}
      {toast && (
        <Toast message={toast} actionLabel="Dismiss" onAction={() => setToast('')} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldGrid sub-component
// ---------------------------------------------------------------------------
function FieldGrid({ inv, currency }: { inv: Invoice; currency: string }) {
  const fields: { label: string; value: React.ReactNode }[] = [
    { label: 'Invoice #', value: inv.invoiceNumber ?? '—' },
    { label: 'PO #', value: inv.poNumber ?? '—' },
    { label: 'Invoice date', value: dateFmt(inv.invoiceDate) },
    { label: 'Due date', value: dateFmt(inv.dueDate) },
    { label: 'Currency', value: inv.currency ?? '—' },
    { label: 'Provider', value: inv.provider ?? '—' },
    { label: 'Extraction cost', value: costFmt(inv.extractionCost) },
    { label: 'Structuring cost', value: costFmt(inv.structuringCost) },
    { label: 'Total cost', value: costFmt(inv.costEstimate) },
    { label: 'Confidence', value: confLabel(inv.confidence) },
  ];

  return (
    <div style={{
      background: T.panel,
      border: `1px solid ${T.border}`,
      borderRadius: 10,
      overflow: 'hidden',
      marginBottom: 20,
    }}>
      <div style={{
        padding: '10px 16px',
        borderBottom: `1px solid ${T.border}`,
        fontSize: 11,
        fontWeight: 700,
        color: T.muted,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        background: T.rail,
      }}>
        Invoice fields
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
      }}>
        {fields.map(({ label, value }, i) => (
          <div
            key={label}
            style={{
              padding: '12px 16px',
              borderRight: (i + 1) % 4 !== 0 ? `1px solid ${T.border}` : 'none',
              borderBottom: i < fields.length - (fields.length % 4 === 0 ? 4 : fields.length % 4) ? `1px solid ${T.border}` : 'none',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>
              {label}
            </div>
            <div style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LineItemTable sub-component
// ---------------------------------------------------------------------------
function LineItemTable({ items, currency, inv }: { items: LineItem[]; currency: string; inv: Invoice }) {
  const thS: React.CSSProperties = {
    padding: '9px 12px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: T.muted,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    background: T.rail,
    borderBottom: `1px solid ${T.border}`,
  };
  const tdS: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: 13,
    color: T.text,
    borderBottom: `1px solid ${T.border}`,
    verticalAlign: 'middle',
  };
  const numS: React.CSSProperties = { ...tdS, textAlign: 'right', fontFamily: T.mono };

  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
      <div style={{
        padding: '10px 16px',
        borderBottom: `1px solid ${T.border}`,
        fontSize: 11,
        fontWeight: 700,
        color: T.muted,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        background: T.rail,
      }}>
        Line items
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: T.font }}>
        <thead>
          <tr>
            <th style={thS}>Description</th>
            <th style={thS}>SKU</th>
            <th style={thS}>HSN/SAC</th>
            <th style={{ ...thS, textAlign: 'right' }}>Qty</th>
            <th style={{ ...thS, textAlign: 'right' }}>Unit price</th>
            <th style={{ ...thS, textAlign: 'right' }}>Amount</th>
            <th style={{ ...thS, textAlign: 'right' }}>Tax rate</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ ...tdS, textAlign: 'center', color: T.muted }}>No line items</td>
            </tr>
          ) : (
            items.map((it, i) => (
              <tr key={it.id ?? i}>
                <td style={tdS}>{it.description ?? '—'}</td>
                <td style={{ ...tdS, color: T.muted, fontFamily: T.mono }}>{it.sku ?? '—'}</td>
                <td style={{ ...tdS, color: T.muted, fontFamily: T.mono }}>{it.hsnSac ?? '—'}</td>
                <td style={numS}>{it.quantity ?? '—'}</td>
                <td style={numS}>{money(it.unitPrice, currency)}</td>
                <td style={numS}>{money(it.amount, currency)}</td>
                <td style={numS}>{it.taxRate != null ? `${it.taxRate}%` : '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {/* Summary row — full GST breakdown */}
      <div style={{ borderTop: `2px solid ${T.border}`, padding: '12px 16px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <SummaryBreakdown inv={inv} currency={currency} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditForm sub-component
// ---------------------------------------------------------------------------
interface EditFormProps {
  editVendorName: string; setEditVendorName: (v: string) => void;
  editVendorAddress: string; setEditVendorAddress: (v: string) => void;
  editVendorTaxId: string; setEditVendorTaxId: (v: string) => void;
  editInvoiceNumber: string; setEditInvoiceNumber: (v: string) => void;
  editPoNumber: string; setEditPoNumber: (v: string) => void;
  editCurrency: string; setEditCurrency: (v: string) => void;
  editPaymentTerms: string; setEditPaymentTerms: (v: string) => void;
  editInvoiceDate: string; setEditInvoiceDate: (v: string) => void;
  editDueDate: string; setEditDueDate: (v: string) => void;
  editSubtotal: string; setEditSubtotal: (v: string) => void;
  editDiscountAmount: string; setEditDiscountAmount: (v: string) => void;
  editCgstAmount: string; setEditCgstAmount: (v: string) => void;
  editSgstAmount: string; setEditSgstAmount: (v: string) => void;
  editIgstAmount: string; setEditIgstAmount: (v: string) => void;
  editTaxAmount: string; setEditTaxAmount: (v: string) => void;
  editTotalAmount: string; setEditTotalAmount: (v: string) => void;
  editNetAmount: string; setEditNetAmount: (v: string) => void;
  editItems: EditLineItem[];
  updateEditItem: (idx: number, field: keyof EditLineItem, value: string) => void;
  removeEditItem: (idx: number) => void;
  addEditItem: () => void;
}

function EditForm(props: EditFormProps) {
  const {
    editVendorName, setEditVendorName,
    editVendorAddress, setEditVendorAddress,
    editVendorTaxId, setEditVendorTaxId,
    editInvoiceNumber, setEditInvoiceNumber,
    editPoNumber, setEditPoNumber,
    editCurrency, setEditCurrency,
    editPaymentTerms, setEditPaymentTerms,
    editInvoiceDate, setEditInvoiceDate,
    editDueDate, setEditDueDate,
    editSubtotal, setEditSubtotal,
    editDiscountAmount, setEditDiscountAmount,
    editCgstAmount, setEditCgstAmount,
    editSgstAmount, setEditSgstAmount,
    editIgstAmount, setEditIgstAmount,
    editTaxAmount, setEditTaxAmount,
    editTotalAmount, setEditTotalAmount,
    editNetAmount, setEditNetAmount,
    editItems, updateEditItem, removeEditItem, addEditItem,
  } = props;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header fields panel */}
      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{
          padding: '10px 16px',
          borderBottom: `1px solid ${T.border}`,
          fontSize: 11,
          fontWeight: 700,
          color: T.muted,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          background: T.rail,
        }}>
          Edit invoice fields
        </div>
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px 20px' }}>
          <div>
            <label style={labelStyle}>Vendor name</label>
            <input style={inputStyle} value={editVendorName} onChange={(e) => setEditVendorName(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Vendor address</label>
            <input style={inputStyle} value={editVendorAddress} onChange={(e) => setEditVendorAddress(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Vendor tax ID</label>
            <input style={inputStyle} value={editVendorTaxId} onChange={(e) => setEditVendorTaxId(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Invoice #</label>
            <input style={inputStyle} value={editInvoiceNumber} onChange={(e) => setEditInvoiceNumber(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>PO #</label>
            <input style={inputStyle} value={editPoNumber} onChange={(e) => setEditPoNumber(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Currency</label>
            <input style={inputStyle} value={editCurrency} onChange={(e) => setEditCurrency(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Payment terms</label>
            <input style={inputStyle} value={editPaymentTerms} onChange={(e) => setEditPaymentTerms(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Invoice date</label>
            <input type="date" style={inputStyle} value={editInvoiceDate} onChange={(e) => setEditInvoiceDate(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Due date</label>
            <input type="date" style={inputStyle} value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Sub total</label>
            <input type="number" step="0.01" style={inputStyle} value={editSubtotal} onChange={(e) => setEditSubtotal(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Less discounts</label>
            <input type="number" step="0.01" style={inputStyle} value={editDiscountAmount} onChange={(e) => setEditDiscountAmount(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>CGST amount</label>
            <input type="number" step="0.01" style={inputStyle} value={editCgstAmount} onChange={(e) => setEditCgstAmount(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>SGST amount</label>
            <input type="number" step="0.01" style={inputStyle} value={editSgstAmount} onChange={(e) => setEditSgstAmount(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>IGST amount</label>
            <input type="number" step="0.01" style={inputStyle} value={editIgstAmount} onChange={(e) => setEditIgstAmount(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Tax amount (total GST)</label>
            <input type="number" step="0.01" style={inputStyle} value={editTaxAmount} onChange={(e) => setEditTaxAmount(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Sub total (incl. tax)</label>
            <input type="number" step="0.01" style={inputStyle} value={editTotalAmount} onChange={(e) => setEditTotalAmount(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Net bill amount</label>
            <input type="number" step="0.01" style={inputStyle} value={editNetAmount} onChange={(e) => setEditNetAmount(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Editable line items */}
      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{
          padding: '10px 16px',
          borderBottom: `1px solid ${T.border}`,
          fontSize: 11,
          fontWeight: 700,
          color: T.muted,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          background: T.rail,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span>Line items</span>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {editItems.map((it, idx) => (
            <div
              key={idx}
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 80px 100px 100px 80px 40px',
                gap: 8,
                alignItems: 'center',
                padding: '10px 12px',
                background: T.rail,
                borderRadius: 7,
                border: `1px solid ${T.border}`,
              }}
            >
              <input
                style={inputStyle}
                placeholder="Description"
                value={it.description}
                onChange={(e) => updateEditItem(idx, 'description', e.target.value)}
              />
              <input
                style={inputStyle}
                placeholder="SKU"
                value={it.sku}
                onChange={(e) => updateEditItem(idx, 'sku', e.target.value)}
              />
              <input
                style={inputStyle}
                placeholder="HSN/SAC"
                value={it.hsnSac}
                onChange={(e) => updateEditItem(idx, 'hsnSac', e.target.value)}
              />
              <input
                type="number"
                style={inputStyle}
                placeholder="Qty"
                value={it.quantity}
                onChange={(e) => updateEditItem(idx, 'quantity', e.target.value)}
              />
              <input
                type="number"
                style={inputStyle}
                placeholder="Unit price"
                value={it.unitPrice}
                onChange={(e) => updateEditItem(idx, 'unitPrice', e.target.value)}
              />
              <input
                type="number"
                style={inputStyle}
                placeholder="Amount"
                value={it.amount}
                onChange={(e) => updateEditItem(idx, 'amount', e.target.value)}
              />
              <input
                type="number"
                style={inputStyle}
                placeholder="Tax %"
                value={it.taxRate}
                onChange={(e) => updateEditItem(idx, 'taxRate', e.target.value)}
              />
              <button
                onClick={() => removeEditItem(idx)}
                style={{
                  background: 'none',
                  border: `1px solid ${T.border}`,
                  borderRadius: 6,
                  color: T.red,
                  fontSize: 16,
                  cursor: 'pointer',
                  padding: '4px 8px',
                  lineHeight: 1,
                  fontFamily: T.font,
                }}
                title="Remove line"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={addEditItem}
            style={{
              alignSelf: 'flex-start',
              padding: '7px 16px',
              border: `1px dashed ${T.border}`,
              borderRadius: 7,
              background: 'none',
              color: T.accent,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: T.font,
            }}
          >
            + Add line
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RawOcrBlock — shared monospace raw-OCR renderer (or placeholder)
// ---------------------------------------------------------------------------
function RawOcrBlock({ rawText, maxHeight }: { rawText: string | null | undefined; maxHeight?: number | string }) {
  if (!rawText) {
    return <div style={{ fontSize: 13, color: T.muted, fontStyle: 'italic' }}>No OCR text</div>;
  }
  return (
    <pre style={{
      fontFamily: T.mono,
      fontSize: 12,
      background: '#1c1a17',
      color: '#e8e4dc',
      padding: '16px 18px',
      borderRadius: 8,
      overflow: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      margin: 0,
      lineHeight: 1.6,
      maxHeight,
    }}>
      {rawText}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// PdfSplit — original PDF on the left, parsed output (fields | raw OCR) right
// ---------------------------------------------------------------------------
function PdfSplit({
  inv,
  currency,
  comparePane,
  setComparePane,
  narrow,
}: {
  inv: Invoice;
  currency: string;
  comparePane: 'fields' | 'raw';
  setComparePane: (v: 'fields' | 'raw') => void;
  narrow: boolean;
}) {
  const pdfUrl = api.fileUrl(inv.id);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)',
      gap: 16,
      alignItems: 'start',
    }}>
      {/* LEFT — original PDF */}
      <div style={{
        position: narrow ? 'static' : 'sticky',
        top: 16,
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: `1px solid ${T.border}`,
          background: T.rail,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Source PDF
          </span>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, fontWeight: 600, color: T.accent, textDecoration: 'none' }}
          >
            Open in new tab ↗
          </a>
        </div>
        <iframe
          title="Invoice PDF"
          src={pdfUrl}
          style={{
            width: '100%',
            height: narrow ? '70vh' : 'calc(100vh - 220px)',
            minHeight: 520,
            border: 'none',
            display: 'block',
            background: '#525659',
          }}
        />
      </div>

      {/* RIGHT — parsed output with Fields | Raw OCR toggle */}
      <div>
        <div style={{
          display: 'inline-flex',
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          overflow: 'hidden',
          marginBottom: 14,
        }}>
          {(['fields', 'raw'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setComparePane(key)}
              style={{
                padding: '6px 16px',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: T.font,
                cursor: 'pointer',
                border: 'none',
                background: comparePane === key ? T.accent : T.panel,
                color: comparePane === key ? '#fff' : T.muted,
              }}
            >
              {key === 'fields' ? 'Fields' : 'Raw OCR'}
            </button>
          ))}
        </div>

        {comparePane === 'fields' ? (
          <>
            <FieldGrid inv={inv} currency={currency} />
            <LineItemTable items={inv.lineItems ?? []} currency={currency} inv={inv} />
          </>
        ) : (
          <RawOcrBlock rawText={inv.rawText} maxHeight="calc(100vh - 260px)" />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------
const actionBtn: React.CSSProperties = {
  padding: '7px 14px',
  border: `1px solid ${T.border}`,
  borderRadius: 7,
  background: T.panel,
  color: T.text,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: T.font,
};
