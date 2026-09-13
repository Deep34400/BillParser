import type { EditLineItem, EditSummaryColumn } from './editTypes.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { Button } from '@/components/ui/button.js';
import { Card, CardContent, CardHeader } from '@/components/ui/card.js';

interface InvoiceEditFormProps {
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
  editSummaryColumns: EditSummaryColumn[];
  updateSummaryCol: (idx: number, field: keyof EditSummaryColumn, value: string) => void;
  removeSummaryCol: (idx: number) => void;
  addSummaryCol: () => void;
}

export function InvoiceEditForm(props: InvoiceEditFormProps) {
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
    editSummaryColumns, updateSummaryCol, removeSummaryCol, addSummaryCol,
  } = props;

  const summaryFields: { key: keyof EditSummaryColumn; label: string; type: string }[] = [
    { key: 'label', label: 'Label', type: 'text' },
    { key: 'subtotal', label: 'Sub total', type: 'number' },
    { key: 'discount', label: 'Discount', type: 'number' },
    { key: 'cgst', label: 'CGST', type: 'number' },
    { key: 'sgst', label: 'SGST', type: 'number' },
    { key: 'igst', label: 'IGST', type: 'number' },
    { key: 'total', label: 'Sub total (incl. tax)', type: 'number' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader className="border-b border-border bg-muted px-4 py-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Edit invoice fields</span>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Vendor name" value={editVendorName} onChange={setEditVendorName} />
          <Field label="Vendor address" value={editVendorAddress} onChange={setEditVendorAddress} />
          <Field label="Vendor tax ID" value={editVendorTaxId} onChange={setEditVendorTaxId} />
          <Field label="Invoice #" value={editInvoiceNumber} onChange={setEditInvoiceNumber} />
          <Field label="PO #" value={editPoNumber} onChange={setEditPoNumber} />
          <Field label="Currency" value={editCurrency} onChange={setEditCurrency} />
          <Field label="Payment terms" value={editPaymentTerms} onChange={setEditPaymentTerms} />
          <Field label="Invoice date" type="date" value={editInvoiceDate} onChange={setEditInvoiceDate} />
          <Field label="Due date" type="date" value={editDueDate} onChange={setEditDueDate} />
          <Field label="Sub total" type="number" value={editSubtotal} onChange={setEditSubtotal} />
          <Field label="Less discounts" type="number" value={editDiscountAmount} onChange={setEditDiscountAmount} />
          <Field label="CGST amount" type="number" value={editCgstAmount} onChange={setEditCgstAmount} />
          <Field label="SGST amount" type="number" value={editSgstAmount} onChange={setEditSgstAmount} />
          <Field label="IGST amount" type="number" value={editIgstAmount} onChange={setEditIgstAmount} />
          <Field label="Tax amount (total GST)" type="number" value={editTaxAmount} onChange={setEditTaxAmount} />
          <Field label="Sub total (incl. tax)" type="number" value={editTotalAmount} onChange={setEditTotalAmount} />
          <Field label="Net bill amount" type="number" value={editNetAmount} onChange={setEditNetAmount} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border bg-muted px-4 py-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Line items</span>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5 p-4">
          {editItems.map((it, idx) => (
            <div key={idx} className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/50 p-2.5 lg:grid-cols-[2fr_repeat(7,1fr)_40px] lg:items-center">
              <Input placeholder="Description" value={it.description} onChange={(e) => updateEditItem(idx, 'description', e.target.value)} />
              <Input placeholder="SKU" value={it.sku} onChange={(e) => updateEditItem(idx, 'sku', e.target.value)} />
              <Input placeholder="HSN/SAC" value={it.hsnSac} onChange={(e) => updateEditItem(idx, 'hsnSac', e.target.value)} />
              <Input type="number" placeholder="Qty" value={it.quantity} onChange={(e) => updateEditItem(idx, 'quantity', e.target.value)} />
              <Input type="number" placeholder="Unit price" value={it.unitPrice} onChange={(e) => updateEditItem(idx, 'unitPrice', e.target.value)} />
              <Input type="number" placeholder="Amount" value={it.amount} onChange={(e) => updateEditItem(idx, 'amount', e.target.value)} />
              <Input type="number" placeholder="Labour" value={it.labourAmount} onChange={(e) => updateEditItem(idx, 'labourAmount', e.target.value)} />
              <Input type="number" placeholder="Tax %" value={it.taxRate} onChange={(e) => updateEditItem(idx, 'taxRate', e.target.value)} />
              <Button variant="outline" size="icon" className="text-destructive" onClick={() => removeEditItem(idx)} title="Remove line">×</Button>
            </div>
          ))}
          <Button variant="outline" className="self-start border-dashed text-primary" onClick={addEditItem}>+ Add line</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border bg-muted px-4 py-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Summary columns (Parts / Labour / …)</span>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5 p-4">
          {editSummaryColumns.length === 0 && (
            <p className="text-sm italic text-muted-foreground">No columnwise summary. Add a column to split totals (e.g. Parts, Labour).</p>
          )}
          {editSummaryColumns.map((c, idx) => (
            <div key={idx} className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/50 p-2.5 lg:grid-cols-[1.2fr_repeat(6,1fr)_40px] lg:items-center">
              {summaryFields.map((f) => (
                <Input
                  key={f.key}
                  type={f.type}
                  step={f.type === 'number' ? '0.01' : undefined}
                  placeholder={f.label}
                  value={c[f.key]}
                  onChange={(e) => updateSummaryCol(idx, f.key, e.target.value)}
                />
              ))}
              <Button variant="outline" size="icon" className="text-destructive" onClick={() => removeSummaryCol(idx)} title="Remove column">×</Button>
            </div>
          ))}
          <Button variant="outline" className="self-start border-dashed text-primary" onClick={addSummaryCol}>+ Add column</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <Label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input type={type} step={type === 'number' ? '0.01' : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
