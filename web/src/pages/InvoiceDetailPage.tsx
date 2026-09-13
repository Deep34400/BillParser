import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import type { Invoice, AppConfig } from '../types/index.js';
import { money } from '../lib/format.js';
import { Toast } from '../components/Toast.js';
import { usePolling } from '../hooks/usePolling.js';
import { CompareOverlay } from '../overlays/CompareOverlay.js';
import { BakeoffOverlay } from '../overlays/BakeoffOverlay.js';
import { Button } from '@/components/ui/button.js';
import { Badge } from '@/components/ui/badge.js';
import { InvoiceHeader } from '../components/invoice/InvoiceHeader.js';
import { InvoiceToolbar } from '../components/invoice/InvoiceToolbar.js';
import { StatusTimeline } from '../components/invoice/StatusTimeline.js';
import { ApprovalBar } from '../components/invoice/ApprovalBar.js';
import { InvoiceFieldGrid } from '../components/invoice/InvoiceFieldGrid.js';
import { PartsTable } from '../components/invoice/PartsTable.js';
import { LabourTable } from '../components/invoice/LabourTable.js';
import { CostBreakdown } from '../components/invoice/CostBreakdown.js';
import { OcrCostPanel } from '../components/invoice/OcrCostPanel.js';
import { FallbackComparePanel } from '../components/invoice/FallbackComparePanel.js';
import { InvoiceEditForm } from '../components/invoice/InvoiceEditForm.js';
import { InvoicePdfSplit } from '../components/invoice/InvoicePdfSplit.js';
import { resolveInvoiceData } from '../components/invoice/invoiceData.js';
import { buildFinalOcrJson } from '../components/invoice/rawOcr.js';
import {
  toEditItems, toEditCols, blankEditItem, blankSummaryCol, parseNum,
  type EditLineItem, type EditSummaryColumn,
} from '../components/invoice/editTypes.js';

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [inv, setInv] = useState<Invoice | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [reProvider, setReProvider] = useState('');
  const [processing, setProcessing] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [bakeoffOpen, setBakeoffOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [comparePane, setComparePane] = useState<'fields' | 'models' | 'raw'>('fields');
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
  const [showRaw, setShowRaw] = useState(false);
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

  usePolling(
    reload,
    () => processing || (inv?.status === 'PENDING' || inv?.status === 'PROCESSING'),
    3000,
  );

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

  if (loading) {
    return (
      <div className="min-h-screen bg-background px-8 py-8">
        <p className="text-sm text-muted-foreground">Loading invoice…</p>
      </div>
    );
  }

  if (!inv) {
    return (
      <div className="min-h-screen bg-background px-8 py-8">
        <p className="text-sm text-destructive">Invoice not found.</p>
      </div>
    );
  }

  const parsedData = resolveInvoiceData(inv);

  return (
    <div className="min-h-screen bg-background">
      <div className="px-8 pt-5">
        <Button variant="link" className="h-auto p-0 text-primary" onClick={() => navigate('/invoices')}>
          ← All invoices
        </Button>
      </div>

      <StatusTimeline ocrStatus={inv.status} approvalStatus={inv.approvalStatus} />

      <InvoiceHeader
        inv={inv}
        editMode={editMode}
        onEdit={enterEdit}
        onDelete={() => void handleDelete()}
        onSave={() => void saveEdit()}
        onCancel={() => setEditMode(false)}
      />

      <InvoiceToolbar
        inv={inv}
        config={config}
        editMode={editMode}
        processing={processing}
        pdfOpen={pdfOpen}
        reProvider={reProvider}
        onReProviderChange={setReProvider}
        onReextract={() => void handleReextract()}
        onCompare={() => setCompareOpen(true)}
        onBakeoff={() => setBakeoffOpen(true)}
        onTogglePdf={() => setPdfOpen((v) => !v)}
      />

      {!editMode && (
        <ApprovalBar inv={inv} onToast={setToast} onReload={() => void reload()} />
      )}

      {!editMode && inv.status === 'NEEDS_REVIEW' && (
        <ReviewWarning inv={inv} />
      )}

      {inv.fallbackHistory && inv.fallbackHistory.length > 1 && (
        <FallbackComparePanel history={inv.fallbackHistory} />
      )}

      {inv.status === 'FAILED' && inv.error && (
        <div className="mx-[30px] mt-3 rounded-md border-l-4 border-destructive bg-danger-soft px-4 py-3.5 font-mono text-sm text-destructive">
          {inv.error}
        </div>
      )}

      <div className="px-8 py-4 pb-10">
        {editMode ? (
          <InvoiceEditForm
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
            editSummaryColumns={editSummaryColumns}
            updateSummaryCol={updateSummaryCol}
            removeSummaryCol={removeSummaryCol}
            addSummaryCol={addSummaryCol}
          />
        ) : pdfOpen ? (
          <InvoicePdfSplit
            inv={inv}
            comparePane={comparePane}
            setComparePane={setComparePane}
            narrow={narrow}
          />
        ) : (
          <>
            <InvoiceFieldGrid inv={inv} />
            <OcrCostPanel inv={inv} />
            {parsedData && (
              <>
                <PartsTable items={parsedData.parts_line_items ?? []} />
                <LabourTable items={parsedData.labour_service_line_items ?? []} />
                <CostBreakdown data={parsedData} inv={inv} />
              </>
            )}
            <div className="mt-6">
              <Button variant="outline" size="sm" onClick={() => setShowRaw((v) => !v)}>
                {showRaw ? 'Hide raw OCR' : 'Show raw OCR'}
              </Button>
              {showRaw && (
                <div className="mt-2.5">
                  <RawOcrBlock rawText={buildFinalOcrJson(inv)} />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {compareOpen && <CompareOverlay invoice={inv} onClose={() => setCompareOpen(false)} />}
      {bakeoffOpen && (
        <BakeoffOverlay
          invoice={inv}
          onClose={() => setBakeoffOpen(false)}
          onApplied={() => { setBakeoffOpen(false); void reload(); }}
        />
      )}
      {toast && <Toast message={toast} actionLabel="Dismiss" onAction={() => setToast('')} />}
    </div>
  );
}

function ReviewWarning({ inv }: { inv: Invoice }) {
  return (
    <div className="mx-[30px] mt-3 rounded-md border-l-4 border-warning bg-warning-soft px-4 py-3.5 text-sm text-[#7a5a00]">
      <p className="mb-1.5 font-bold">⚠ Needs review — please verify these fields against the document</p>
      {(inv.reviewCodes?.length ?? 0) > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {inv.reviewCodes!.map((code) => (
            <Badge key={code} variant="danger">{code}</Badge>
          ))}
        </div>
      )}
      {(inv.reviewReasons?.length ?? 0) > 0 ? (
        <ul className="m-0 list-disc pl-5">
          {inv.reviewReasons!.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      ) : (
        <p className="mb-1">Missing GSTIN and PAN — confirm vendor tax IDs.</p>
      )}
      {inv.totalReconciliation && !inv.totalReconciliation.matched && (
        <div className="mt-2.5 rounded-md bg-danger-soft p-3 text-xs leading-relaxed">
          <p className="mb-1 font-semibold">Total reconciliation</p>
          <p>Parts base: {money(inv.totalReconciliation.parts_base)} | Labour base: {money(inv.totalReconciliation.labour_base)}</p>
          {(inv.totalReconciliation.deductibles > 0 || inv.totalReconciliation.salvage > 0) && (
            <p>Deductibles: {money(inv.totalReconciliation.deductibles)} | Salvage: {money(inv.totalReconciliation.salvage)}</p>
          )}
          <p className="mt-1 font-semibold">
            Calculated: {money(inv.totalReconciliation.calculated_total)} vs Printed: {money(inv.totalReconciliation.grand_total_invoice ?? 0)} (diff: {money(inv.totalReconciliation.difference ?? 0)})
          </p>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Use <strong>Edit</strong> to correct, then <strong>Save &amp; verify</strong> to clear this warning.
      </p>
    </div>
  );
}

function RawOcrBlock({ rawText }: { rawText: string | null }) {
  if (!rawText) {
    return <p className="text-sm italic text-muted-foreground">No OCR text</p>;
  }
  return (
    <pre className="m-0 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#1c1a17] p-4 font-mono text-xs leading-relaxed text-[#e8e4dc]">
      {rawText}
    </pre>
  );
}
