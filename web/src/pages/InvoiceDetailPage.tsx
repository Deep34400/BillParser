import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import type { Invoice, AppConfig, LineItem, SummaryColumn, ParsedInvoiceData } from '../types/index.js';
import { T } from '../theme.js';
import { money, dateFmt, confLabel, costFmt, amount } from '../lib/format.js';
import { StatusDot } from '../components/StatusDot.js';
import { Toast } from '../components/Toast.js';
import { usePolling } from '../hooks/usePolling.js';
import { CompareOverlay } from '../overlays/CompareOverlay.js';
import { BakeoffOverlay } from '../overlays/BakeoffOverlay.js';
import { InvoiceBreakdown } from '../components/InvoiceBreakdown.js';

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
  labourAmount: string;
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
    labourAmount: it.labourAmount != null ? String(it.labourAmount) : '',
    taxRate: it.taxRate != null ? String(it.taxRate) : '',
  }));
}

function blankEditItem(lineNumber: number): EditLineItem {
  return { lineNumber, description: '', sku: '', hsnSac: '', quantity: '', unitPrice: '', amount: '', labourAmount: '', taxRate: '' };
}

// ---------------------------------------------------------------------------
// Editable summary column shape
// ---------------------------------------------------------------------------
interface EditSummaryColumn {
  label: string; subtotal: string; discount: string; cgst: string; sgst: string; igst: string; total: string;
}

function toEditCols(cols: SummaryColumn[]): EditSummaryColumn[] {
  const s = (n?: number | null) => (n != null ? String(n) : '');
  return cols.map((c) => ({
    label: c.label ?? '', subtotal: s(c.subtotal), discount: s(c.discount),
    cgst: s(c.cgst), sgst: s(c.sgst), igst: s(c.igst), total: s(c.total),
  }));
}

function blankSummaryCol(): EditSummaryColumn {
  return { label: '', subtotal: '', discount: '', cgst: '', sgst: '', igst: '', total: '' };
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
  const [comparePane, setComparePane] = useState<'fields' | 'models' | 'raw'>('fields');

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
  const [editSummaryColumns, setEditSummaryColumns] = useState<EditSummaryColumn[]>([]);

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
    if (processing && inv && (inv.status === 'COMPLETED' || inv.status === 'NEEDS_REVIEW' || inv.status === 'FAILED')) {
      setProcessing(false);
      setToast(
        inv.status === 'FAILED'
          ? 'Re-extraction failed'
          : inv.status === 'NEEDS_REVIEW'
            ? 'Re-extraction complete — needs review'
            : 'Re-extraction complete',
      );
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
    setEditSummaryColumns(toEditCols(inv.summaryColumns ?? []));
    setEditMode(true);
  }

  function cancelEdit() {
    setEditMode(false);
  }

  async function saveEdit() {
    if (!id) return;
    const cols = editSummaryColumns
      .map((c) => ({
        label: c.label || null,
        subtotal: parseNum(c.subtotal), discount: parseNum(c.discount),
        cgst: parseNum(c.cgst), sgst: parseNum(c.sgst), igst: parseNum(c.igst), total: parseNum(c.total),
      }))
      .filter((c) => [c.subtotal, c.discount, c.cgst, c.sgst, c.igst, c.total].some((v) => v != null) || c.label);
    const body = {
      summaryColumns: cols.length ? cols : null,
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
        labourAmount: parseNum(it.labourAmount),
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

  function updateSummaryCol(idx: number, field: keyof EditSummaryColumn, value: string) {
    setEditSummaryColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  }
  function removeSummaryCol(idx: number) {
    setEditSummaryColumns((prev) => prev.filter((_, i) => i !== idx));
  }
  function addSummaryCol() {
    setEditSummaryColumns((prev) => [...prev, blankSummaryCol()]);
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

  const currency = inv.currency ?? 'INR';

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

      {/* Review warnings — shown when DB status is NEED_REVIEW */}
      {!editMode && inv.status === 'NEEDS_REVIEW' && (
        <div style={{
          margin: '12px 30px 0',
          padding: '14px 18px',
          background: '#fff8ec',
          borderLeft: `4px solid ${T.amber}`,
          borderRadius: 6,
          fontSize: 13,
          color: '#7a5a00',
          fontFamily: T.font,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            ⚠ Needs review — please verify these fields against the document
          </div>
          {(inv.reviewCodes?.length ?? 0) > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {inv.reviewCodes!.map((code) => (
                <span key={code} style={{
                  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                  background: '#FDE8E4', color: '#B42318', border: '1px solid #F9CBBE',
                }}>
                  {code}
                </span>
              ))}
            </div>
          )}
          {(inv.reviewReasons?.length ?? 0) > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {inv.reviewReasons!.map((r, i) => (
                <li key={i} style={{ marginBottom: 2 }}>{r}</li>
              ))}
            </ul>
          ) : (
            <div style={{ marginBottom: 4 }}>Missing GSTIN and PAN — confirm vendor tax IDs.</div>
          )}
          {inv.totalReconciliation && !inv.totalReconciliation.matched && (
            <div style={{ marginTop: 10, padding: '10px 14px', background: '#fff3f0', borderRadius: 6, fontSize: 12, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Total reconciliation</div>
              <div>Parts base: {money(inv.totalReconciliation.parts_base)} | Labour base: {money(inv.totalReconciliation.labour_base)}</div>
              {(inv.totalReconciliation.deductibles > 0 || inv.totalReconciliation.salvage > 0) && (
                <div>Deductibles: {money(inv.totalReconciliation.deductibles)} | Salvage: {money(inv.totalReconciliation.salvage)}</div>
              )}
              <div style={{ fontWeight: 600, marginTop: 4 }}>
                Calculated: {money(inv.totalReconciliation.calculated_total)} vs Printed: {money(inv.totalReconciliation.grand_total_invoice ?? 0)} (diff: {money(inv.totalReconciliation.difference ?? 0)})
              </div>
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 12, color: T.muted }}>
            Use <b>Edit fields</b> to correct, then <b>Save &amp; verify</b> to clear this warning.
          </div>
        </div>
      )}

      {/* Fallback compare — Primary vs Secondary vs Tertiary */}
      {inv.fallbackHistory && inv.fallbackHistory.length > 1 && (
        <FallbackComparePanel history={inv.fallbackHistory} />
      )}

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
          <SummaryColumnsEditor
            columns={editSummaryColumns}
            updateCol={updateSummaryCol}
            removeCol={removeSummaryCol}
            addCol={addSummaryCol}
          />
          </div>
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

            {/* Unified cost breakdown */}
            <CostBreakdown inv={inv} />

            {/* Parts / labour breakdown */}
            <InvoiceBreakdown inv={inv} currency={currency} />

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
                  <RawOcrBlock rawText={buildFinalOcrJson(inv)} />
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
// FallbackComparePanel — Primary vs Secondary vs Tertiary OCR results
// ---------------------------------------------------------------------------

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


function FallbackComparePanel({
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

// ---------------------------------------------------------------------------
// CostBreakdown sub-component — unified cost display
// ---------------------------------------------------------------------------
function CostBreakdown({ inv }: { inv: Invoice }) {
  if (inv.costEstimate == null) return null;

  const isSingle = inv.pipelineMode === 'single';
  const model = inv.extractionModel ?? inv.structuringModel ?? '—';
  const latency = ((inv.totalLatencyMs ?? 0) / 1000).toFixed(1);
  const usedFallback = (inv.fallbackAttempts ?? 0) > 1;
  const winner = usedFallback && inv.fallbackHistory
    ? [...inv.fallbackHistory].reverse().find((h) => h.reconciliation_matched)
      ?? inv.fallbackHistory[inv.fallbackHistory.length - 1]
    : null;

  const hasBreakdown = inv.totalInputTokens != null && inv.totalOutputTokens != null;
  const inputTokens = inv.totalInputTokens ?? 0;
  const outputTokens = inv.totalOutputTokens ?? 0;
  // Thinking = Gemini reasoning tokens (billed at output $/1M). Derive gap for older bills.
  const thinkingTokens =
    inv.totalThinkingTokens != null
      ? inv.totalThinkingTokens
      : hasBreakdown
        ? Math.max(0, (inv.totalTokens ?? 0) - inputTokens - outputTokens)
        : 0;
  const billedOutputTokens = outputTokens + thinkingTokens;
  const displayTotalTokens = hasBreakdown
    ? inputTokens + billedOutputTokens
    : (inv.totalTokens ?? 0);
  const inputCost = inv.totalInputCostUsd ?? 0;
  const outputCost = inv.totalOutputCostUsd ?? 0;
  const totalCost = inv.costEstimate ?? 0;

  const rowStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 0', fontSize: 12, color: T.text,
  };
  const dimStyle: React.CSSProperties = { color: T.muted, fontSize: 11 };
  const boldStyle: React.CSSProperties = { fontWeight: 700, fontSize: 13 };

  return (
    <div style={{
      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10,
      overflow: 'hidden', marginBottom: 20,
    }}>
      <div style={{
        padding: '10px 16px', borderBottom: `1px solid ${T.border}`,
        fontSize: 11, fontWeight: 700, color: T.muted,
        letterSpacing: '0.06em', textTransform: 'uppercase', background: T.rail,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>Cost Breakdown</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: T.text, textTransform: 'none', letterSpacing: 0 }}>
          {isSingle ? 'Single' : 'Split'} · {model} · {latency}s
          {usedFallback && winner && (
            <span style={{ marginLeft: 6, color: T.amber }}>via {winner.label}</span>
          )}
        </span>
      </div>

      <div style={{ padding: '12px 16px' }}>
        {hasBreakdown ? (
          <>
            <div style={rowStyle}>
              <span>Input <span style={dimStyle}>(prompt · input $/1M of {model})</span></span>
              <span>
                <span style={{ fontFamily: T.mono }}>{inputTokens.toLocaleString()}</span>
                <span style={dimStyle}> tokens</span>
                <span style={{ margin: '0 8px', color: T.border }}>→</span>
                <span style={{ fontFamily: T.mono, fontWeight: 600 }}>{costFmt(inputCost)}</span>
              </span>
            </div>
            <div style={rowStyle}>
              <span>
                Output <span style={dimStyle}>(answer{thinkingTokens > 0 ? ' + thinking' : ''} · output $/1M)</span>
              </span>
              <span>
                <span style={{ fontFamily: T.mono }}>{billedOutputTokens.toLocaleString()}</span>
                <span style={dimStyle}> tokens</span>
                <span style={{ margin: '0 8px', color: T.border }}>→</span>
                <span style={{ fontFamily: T.mono, fontWeight: 600 }}>{costFmt(outputCost)}</span>
              </span>
            </div>
            {thinkingTokens > 0 && (
              <div style={{ ...rowStyle, paddingTop: 0, color: T.muted, fontSize: 11 }}>
                <span style={{ paddingLeft: 12 }}>↳ answer {outputTokens.toLocaleString()} + thinking {thinkingTokens.toLocaleString()}</span>
                <span />
              </div>
            )}
            <div style={{
              borderTop: `1px solid ${T.border}`, marginTop: 6, paddingTop: 8,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={boldStyle}>Total cost</span>
              <span>
                <span style={{ fontFamily: T.mono, ...boldStyle }}>{costFmt(totalCost)}</span>
                <span style={{ ...dimStyle, marginLeft: 8 }}>
                  {displayTotalTokens.toLocaleString()} tokens
                  {' '}(= {inputTokens.toLocaleString()} + {billedOutputTokens.toLocaleString()})
                </span>
              </span>
            </div>
          </>
        ) : (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={boldStyle}>Total cost</span>
            <span>
              <span style={{ fontFamily: T.mono, ...boldStyle }}>{costFmt(totalCost)}</span>
              <span style={{ ...dimStyle, marginLeft: 8 }}>
                {displayTotalTokens.toLocaleString()} tokens
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldGrid sub-component
// ---------------------------------------------------------------------------
function FieldGrid({ inv, currency }: { inv: Invoice; currency: string }) {
  const isSingle = inv.pipelineMode === 'single';
  const usedFallback = (inv.fallbackAttempts ?? 0) > 1;
  const winner = usedFallback && inv.fallbackHistory
    ? [...inv.fallbackHistory].reverse().find((h) => h.reconciliation_matched)
      ?? inv.fallbackHistory[inv.fallbackHistory.length - 1]
    : null;
  const primaryAttempt = usedFallback ? inv.fallbackHistory?.[0] : null;

  const pipelineValue = isSingle
    ? `Single — ${inv.extractionProvider ?? inv.provider ?? '—'} (${inv.extractionModel ?? '—'})`
    : (inv.extractionProvider || inv.structuringProvider)
      ? `Split — ${inv.extractionProvider ?? '—'} (OCR) + ${inv.structuringProvider ?? inv.provider ?? '—'} (parse)`
      : (inv.provider ?? '—');

  const fields: { label: string; value: React.ReactNode }[] = [
    { label: 'Invoice #', value: inv.invoiceNumber ?? '—' },
    { label: 'PO #', value: inv.poNumber ?? '—' },
    { label: 'Invoice date', value: dateFmt(inv.invoiceDate) },
    { label: 'Due date', value: dateFmt(inv.dueDate) },
    { label: 'Currency', value: inv.currency ?? '—' },
    {
      label: 'Pipeline',
      value: usedFallback && winner ? (
        <span>
          {pipelineValue}
          <span style={{
            display: 'inline-block', marginLeft: 8, fontSize: 10, fontWeight: 700,
            padding: '2px 8px', borderRadius: 10, background: T.warnSoft, color: T.amber,
          }}>
            VIA {winner.label.toUpperCase()}
          </span>
        </span>
      ) : pipelineValue,
    },
    ...(usedFallback && winner
      ? [{
          label: 'Result model',
          value: `${winner.model} (${winner.label}) — Primary was ${primaryAttempt?.model ?? '—'}`,
        }]
      : []),
    ...(usedFallback
      ? [{ label: 'Fallback attempts', value: `${inv.fallbackAttempts} models tried` }]
      : inv.fallbackReason
        ? [{ label: 'Fallback', value: inv.fallbackReason }]
        : []),
    ...(isSingle ? [] : [
      {
        label: 'Extraction cost',
        value: inv.extractionCost != null
          ? `${costFmt(inv.extractionCost)} · ${(inv.extractionTokens ?? 0).toLocaleString()} tokens · ${inv.extractionModel ?? '—'}`
          : '—',
      },
      {
        label: 'Structuring cost',
        value: inv.structuringCost != null
          ? `${costFmt(inv.structuringCost)} · ${(inv.structuringTokens ?? 0).toLocaleString()} tokens · ${inv.structuringModel ?? '—'}`
          : '—',
      },
    ]),
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
                gridTemplateColumns: '2fr 1fr 1fr 80px 100px 100px 100px 80px 40px',
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
                placeholder="Labour"
                value={it.labourAmount}
                onChange={(e) => updateEditItem(idx, 'labourAmount', e.target.value)}
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
// SummaryColumnsEditor — edit the columnwise totals (Parts/Labour/…)
// ---------------------------------------------------------------------------
function SummaryColumnsEditor({
  columns,
  updateCol,
  removeCol,
  addCol,
}: {
  columns: EditSummaryColumn[];
  updateCol: (idx: number, field: keyof EditSummaryColumn, value: string) => void;
  removeCol: (idx: number) => void;
  addCol: () => void;
}) {
  const fields: { key: keyof EditSummaryColumn; label: string; type: string }[] = [
    { key: 'label', label: 'Label', type: 'text' },
    { key: 'subtotal', label: 'Sub total', type: 'number' },
    { key: 'discount', label: 'Discount', type: 'number' },
    { key: 'cgst', label: 'CGST', type: 'number' },
    { key: 'sgst', label: 'SGST', type: 'number' },
    { key: 'igst', label: 'IGST', type: 'number' },
    { key: 'total', label: 'Sub total (incl. tax)', type: 'number' },
  ];
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{
        padding: '10px 16px', borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 700,
        color: T.muted, letterSpacing: '0.06em', textTransform: 'uppercase', background: T.rail,
      }}>
        Summary columns (Parts / Labour / …)
      </div>
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {columns.length === 0 && (
          <div style={{ fontSize: 13, color: T.muted, fontStyle: 'italic' }}>
            No columnwise summary. Add a column to split totals (e.g. Parts, Labour).
          </div>
        )}
        {columns.map((c, idx) => (
          <div
            key={idx}
            style={{
              display: 'grid', gridTemplateColumns: '1.2fr repeat(6, 1fr) 40px', gap: 8, alignItems: 'center',
              padding: '10px 12px', background: T.rail, borderRadius: 7, border: `1px solid ${T.border}`,
            }}
          >
            {fields.map((f) => (
              <input
                key={f.key}
                type={f.type}
                step={f.type === 'number' ? '0.01' : undefined}
                style={inputStyle}
                placeholder={f.label}
                value={c[f.key]}
                onChange={(e) => updateCol(idx, f.key, e.target.value)}
              />
            ))}
            <button
              onClick={() => removeCol(idx)}
              style={{
                background: 'none', border: `1px solid ${T.border}`, borderRadius: 6, color: T.red,
                fontSize: 16, cursor: 'pointer', padding: '4px 8px', lineHeight: 1, fontFamily: T.font,
              }}
              title="Remove column"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={addCol}
          style={{
            alignSelf: 'flex-start', padding: '7px 16px', border: `1px dashed ${T.border}`, borderRadius: 7,
            background: 'none', color: T.accent, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: T.font,
          }}
        >
          + Add column
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RawOcrBlock — final OCR JSON (parsed + review + reconciliation) or raw text
// ---------------------------------------------------------------------------
function buildFinalOcrJson(inv: Invoice): string | null {
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
  comparePane: 'fields' | 'models' | 'raw';
  setComparePane: (v: 'fields' | 'models' | 'raw') => void;
  narrow: boolean;
}) {
  const pdfUrl = api.fileUrl(inv.id);
  const hasFallbackCompare = (inv.fallbackHistory?.length ?? 0) > 1;
  const tabs = (
    hasFallbackCompare
      ? (['fields', 'models', 'raw'] as const)
      : (['fields', 'raw'] as const)
  );

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

      {/* RIGHT — Fields | Model compare | Raw OCR */}
      <div>
        <div style={{
          display: 'inline-flex',
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          overflow: 'hidden',
          marginBottom: 14,
          flexWrap: 'wrap',
        }}>
          {tabs.map((key) => (
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
              {key === 'fields' ? 'Fields' : key === 'models' ? 'Model compare' : 'Raw OCR'}
              {key === 'models' && (
                <span style={{
                  marginLeft: 6, fontSize: 10, fontWeight: 700,
                  padding: '1px 6px', borderRadius: 8,
                  background: comparePane === key ? 'rgba(255,255,255,0.25)' : T.warnSoft,
                  color: comparePane === key ? '#fff' : T.amber,
                }}>
                  {inv.fallbackHistory!.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {comparePane === 'fields' ? (
          <>
            {hasFallbackCompare && (
              <button
                type="button"
                onClick={() => setComparePane('models')}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', marginBottom: 12,
                  padding: '10px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: T.font,
                  border: `1px solid ${T.amber}`, background: T.warnSoft, color: T.text,
                }}
              >
                <span style={{ fontWeight: 700, color: T.amber }}>Fallback used</span>
                <span style={{ fontSize: 12, color: T.muted, marginLeft: 8 }}>
                  See why Primary failed and what Secondary fixed →
                </span>
              </button>
            )}
            <FieldGrid inv={inv} currency={currency} />
            <InvoiceBreakdown inv={inv} currency={currency} />
          </>
        ) : comparePane === 'models' && hasFallbackCompare ? (
          <FallbackComparePanel history={inv.fallbackHistory!} compact />
        ) : (
          <RawOcrBlock rawText={buildFinalOcrJson(inv)} maxHeight="calc(100vh - 260px)" />
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
