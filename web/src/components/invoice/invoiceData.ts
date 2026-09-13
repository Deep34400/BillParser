import type { Invoice, ParsedInvoiceData } from '../../types/index.js';
import { enrichInvoiceSummary } from '../../lib/summaryFromMarkdown.js';

function sum(nums: (number | null | undefined)[]): number {
  return nums.reduce<number>((a, n) => a + (n ?? 0), 0);
}

function buildFromLineItems(inv: Invoice): ParsedInvoiceData | null {
  const items = inv.lineItems ?? [];
  const parts = items.filter((it) => it.amount != null && it.labourAmount == null);
  const labour = items.filter((it) => it.labourAmount != null);
  if (parts.length === 0 && labour.length === 0) return null;
  const cols = inv.summaryColumns ?? [];
  const partsCol = cols.find((c) => /part/i.test(c.label ?? ''));
  const labourCol = cols.find((c) => /labou?r/i.test(c.label ?? ''));
  return {
    company_name: inv.vendorName,
    gstin: inv.vendorTaxId,
    invoice_number: inv.invoiceNumber,
    parts_line_items: parts.map((it) => ({
      item_name_description: it.description,
      part_number_item_code: it.sku,
      hsn_sac_code: it.hsnSac,
      quantity: it.quantity,
      rate: it.unitPrice,
      taxable_amount: it.amount,
      tax_percentage: it.taxRate,
    })),
    labour_service_line_items: labour.map((it) => ({
      labour_description: it.description,
      labour_code: it.sku,
      hsn_sac_code: it.hsnSac,
      labour_charges: it.labourAmount,
      tax_percentage: it.taxRate,
    })),
    totals_and_tax_summary: {
      parts_total: partsCol?.subtotal ?? (parts.length ? sum(parts.map((p) => p.amount)) : null),
      labour_total: labourCol?.subtotal ?? (labour.length ? sum(labour.map((l) => l.labourAmount)) : null),
      parts_discount: partsCol?.discount ?? null,
      labour_discount: labourCol?.discount ?? null,
      parts_cgst_amount: partsCol?.cgst ?? null,
      parts_sgst_amount: partsCol?.sgst ?? null,
      parts_igst_amount: partsCol?.igst ?? null,
      labour_cgst_amount: labourCol?.cgst ?? null,
      labour_sgst_amount: labourCol?.sgst ?? null,
      labour_igst_amount: labourCol?.igst ?? null,
      sub_total_calculated: inv.subtotal,
      grand_total_invoice: inv.totalAmount ?? inv.netAmount,
    },
  };
}

function enrichFromInvoice(data: ParsedInvoiceData, inv: Invoice): ParsedInvoiceData {
  const enriched = enrichInvoiceSummary(data, inv.rawText);
  const t = enriched.totals_and_tax_summary ?? {};
  if (t.grand_total_invoice == null) t.grand_total_invoice = inv.netAmount ?? inv.totalAmount ?? null;
  return { ...enriched, totals_and_tax_summary: t };
}

export function resolveInvoiceData(inv: Invoice): ParsedInvoiceData | null {
  const raw = inv.parsedData ?? buildFromLineItems(inv);
  if (!raw) return null;
  return enrichFromInvoice(raw, inv);
}
