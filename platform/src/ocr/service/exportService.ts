/**
 * Export Service — generates CSV and Excel files from invoice data.
 *
 * Separated from route.ts so export logic is testable independently
 * and controllers stay thin.
 */
import ExcelJS from 'exceljs';
import { listBills, fetchBillsForExport, type BillDoc } from '../repository.js';
import type { BillStatus } from '../../shared/types.js';

const MAX_EXPORT_ROWS = 5000;

export interface ExportFilters {
  status?: BillStatus;
  statuses?: BillStatus[];
  needsReview?: boolean;
  reviewCode?: string;
  q?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  minTotal?: number;
}

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

/** Fetch filtered bills and build an Excel workbook buffer. */
export async function exportFilteredInvoicesExcel(filters: ExportFilters): Promise<Buffer> {
  const bills = await fetchBillsForExport({ ...filters, maxDocs: MAX_EXPORT_ROWS });
  return exportToExcel(bills);
}

/** Build an Excel workbook from bill documents. */
export async function exportToExcel(bills: BillDoc[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Invoices');

  ws.columns = [
    { header: 'Invoice Number', key: 'invoice_number', width: 18 },
    { header: 'Company Name', key: 'company_name', width: 24 },
    { header: 'GSTIN', key: 'gstin', width: 18 },
    { header: 'Invoice Date', key: 'invoice_date', width: 14 },
    { header: 'Parts Total', key: 'parts_total', width: 14 },
    { header: 'Labour Total', key: 'labour_total', width: 14 },
    { header: 'Grand Total', key: 'grand_total', width: 14 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Created At', key: 'created_at', width: 22 },
  ];

  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };

  for (const b of bills) {
    ws.addRow({
      invoice_number: b.invoice_number ?? '',
      company_name: b.company_name ?? b.vendor_name ?? '',
      gstin: b.gstin ?? b.vendor_gstin ?? '',
      invoice_date: b.invoice_date ?? '',
      parts_total: b.parts_amount ?? null,
      labour_total: b.labour_amount ?? null,
      grand_total: b.grand_total_amount ?? null,
      status: b.ocr_status,
      created_at: b.created_at,
    });
  }

  const moneyCols = [5, 6, 7];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    for (const col of moneyCols) {
      const cell = row.getCell(col);
      if (cell.value !== null && cell.value !== '') {
        cell.numFmt = '0.00';
      }
    }
  });

  ws.columns.forEach((column) => {
    if (!column) return;
    let maxLength = column.header ? String(column.header).length : 10;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = cell.value != null ? String(cell.value).length : 0;
      if (len > maxLength) maxLength = len;
    });
    column.width = Math.min(maxLength + 2, 50);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
