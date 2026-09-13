/**
 * OCR models barrel — re-exports Bill, BillPart, and InvoiceComment models.
 */
export { Bill, type BillAttributes, initBillModel } from './bill.js';
export { BillPart, type BillPartAttributes, initBillPartModel } from './billPart.js';
export { InvoiceComment, type InvoiceCommentAttributes, initInvoiceCommentModel } from './invoiceComment.js';
