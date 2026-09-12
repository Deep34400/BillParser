/**
 * Export Service — generates CSV files from invoice data.
 *
 * Separated from route.ts so export logic is testable independently
 * and controllers stay thin.
 */
import { listBills } from '../repository.js';

const MAX_EXPORT_ROWS = 5000;

/** Generate a CSV string of all invoices (up to 5000). */
export async function exportInvoicesCsv(): Promise<string> {
  const bills = await listBills({ limit: MAX_EXPORT_ROWS });

  const header = 'Invoice #,Vendor,Date,GSTIN,Parts Total,Labour Total,CGST,SGST,IGST,Grand Total,Status\n';

  const rows = bills.map((b) => {
    const t = b.parsed_data?.totals_and_tax_summary;
    return [
      b.invoice_number ?? '',
      b.vendor_name ?? '',
      b.invoice_date ?? '',
      b.vendor_gstin ?? '',
      t?.parts_total ?? '',
      t?.labour_total ?? '',
      ((t?.parts_cgst_amount ?? 0) + (t?.labour_cgst_amount ?? 0)) || '',
      ((t?.parts_sgst_amount ?? 0) + (t?.labour_sgst_amount ?? 0)) || '',
      ((t?.parts_igst_amount ?? 0) + (t?.labour_igst_amount ?? 0)) || '',
      b.grand_total_amount ?? '',
      b.ocr_status,
    ].join(',');
  }).join('\n');

  return header + rows;
}

/** Generate a CSV string of all line items (parts + labour). */
export async function exportLineItemsCsv(): Promise<string> {
  const bills = await listBills({ limit: MAX_EXPORT_ROWS });

  const header = 'Invoice #,Vendor,Type,Name,HSN/SAC,Qty,Rate,Amount,Tax %\n';
  const rows: string[] = [];

  for (const b of bills) {
    for (const p of b.parsed_data?.parts_line_items ?? []) {
      rows.push([
        b.invoice_number ?? '', b.vendor_name ?? '', 'PART',
        p.item_name_description ?? '', p.hsn_sac_code ?? '',
        p.quantity ?? '', p.rate ?? '', p.taxable_amount ?? '', p.tax_percentage ?? '',
      ].join(','));
    }
    for (const l of b.parsed_data?.labour_service_line_items ?? []) {
      rows.push([
        b.invoice_number ?? '', b.vendor_name ?? '', 'LABOUR',
        l.labour_description ?? '', l.hsn_sac_code ?? '',
        '1', l.labour_charges ?? '', l.labour_charges ?? '', l.tax_percentage ?? '',
      ].join(','));
    }
  }

  return header + rows.join('\n');
}
