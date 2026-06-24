import type { CanonicalResult } from '../providers/types.js';
export interface StructuringModel {
  provider: string; model: string;
  structure(markdown: string, creds: Record<string, string>): Promise<Omit<CanonicalResult, 'rawText' | 'rawJson'>>;
}
export const STRUCTURING_PROMPT = `You are an invoice parser. Given OCR markdown of ONE invoice, return ONLY minified JSON matching:
{"vendorName","vendorAddress","vendorTaxId","invoiceNumber","poNumber","invoiceDate","dueDate","currency","subtotal","discountAmount","cgstAmount","sgstAmount","igstAmount","taxAmount","totalAmount","netAmount","paymentTerms","confidence","lineItems":[{"description","sku","hsnSac","quantity","unitPrice","amount","taxRate"}]}
Dates as YYYY-MM-DD. Numbers as numbers (no currency symbols). confidence 0..1 reflecting your certainty. Use null for unknown fields. No prose, no code fences.
GST fields (Indian invoices): subtotal = sub total before discount; discountAmount = any "less discount"; cgstAmount/sgstAmount/igstAmount = the respective GST amounts (SGST and IGST are mutually exclusive — populate whichever the invoice shows, null the other); taxAmount = total of all GST; totalAmount = sub total including tax; netAmount = the final rounded "net bill amount" payable.
Per line item: hsnSac = the code from the HSN/SAC column — a 4 to 8 digit HSN code (goods) or SAC code (services, usually starting with 99, e.g. 998729); it is a CODE, never a percentage. taxRate = the GST tax rate as a percentage number (e.g. 18 for 18%); valid GST rates are between 0 and 28. Never put an HSN/SAC code in taxRate, and never put a tax percentage in hsnSac.`;
