import type { LineItem, SummaryColumn } from '../../types/index.js';

export interface EditLineItem {
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

export interface EditSummaryColumn {
  label: string;
  subtotal: string;
  discount: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
}

export function toEditItems(items: LineItem[]): EditLineItem[] {
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

export function blankEditItem(lineNumber: number): EditLineItem {
  return { lineNumber, description: '', sku: '', hsnSac: '', quantity: '', unitPrice: '', amount: '', labourAmount: '', taxRate: '' };
}

export function toEditCols(cols: SummaryColumn[]): EditSummaryColumn[] {
  const s = (n?: number | null) => (n != null ? String(n) : '');
  return cols.map((c) => ({
    label: c.label ?? '', subtotal: s(c.subtotal), discount: s(c.discount),
    cgst: s(c.cgst), sgst: s(c.sgst), igst: s(c.igst), total: s(c.total),
  }));
}

export function blankSummaryCol(): EditSummaryColumn {
  return { label: '', subtotal: '', discount: '', cgst: '', sgst: '', igst: '', total: '' };
}

export function parseNum(s: string): number | null {
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
