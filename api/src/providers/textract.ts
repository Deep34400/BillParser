import { TextractClient, AnalyzeExpenseCommand } from '@aws-sdk/client-textract';
import type { ExtractionProvider, CanonicalResult } from './types.js';

const pick = (groups: any[], type: string): string | undefined =>
  groups?.find((g) => g.Type?.Text === type)?.ValueDetection?.Text;

export function mapTextract(json: any): Omit<CanonicalResult, 'rawText' | 'rawJson' | 'costEstimate' | 'latencyMs' | 'pageCount'> {
  const doc = json?.ExpenseDocuments?.[0] ?? {};
  const summary: any[] = doc.SummaryFields ?? [];
  const fld = (t: string) => summary.find((s) => s.Type?.Text === t)?.ValueDetection?.Text;
  const numFld = (t: string) => { const v = fld(t); return v ? Number(v.replace(/[^0-9.\-]/g, '')) : undefined; };
  const items = (doc.LineItemGroups?.[0]?.LineItems ?? []).map((li: any, i: number) => ({
    lineNumber: i + 1, description: pick(li.LineItemExpenseFields, 'ITEM'),
    quantity: Number(pick(li.LineItemExpenseFields, 'QUANTITY') ?? '') || undefined,
    unitPrice: Number((pick(li.LineItemExpenseFields, 'UNIT_PRICE') ?? '').replace(/[^0-9.\-]/g, '')) || undefined,
    amount: Number((pick(li.LineItemExpenseFields, 'PRICE') ?? '').replace(/[^0-9.\-]/g, '')) || undefined,
  }));
  const confs = summary.map((s) => s.ValueDetection?.Confidence).filter((c) => typeof c === 'number');
  return {
    vendorName: fld('VENDOR_NAME') ?? fld('NAME'), vendorAddress: fld('VENDOR_ADDRESS'), vendorTaxId: fld('TAX_PAYER_ID'),
    invoiceNumber: fld('INVOICE_RECEIPT_ID'), poNumber: fld('PO_NUMBER'),
    invoiceDate: fld('INVOICE_RECEIPT_DATE'), dueDate: fld('DUE_DATE'),
    currency: fld('CURRENCY'), subtotal: numFld('SUBTOTAL'), taxAmount: numFld('TAX'), totalAmount: numFld('TOTAL'),
    confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length / 100 : undefined,
    lineItems: items,
  };
}

export const textractProvider: ExtractionProvider = {
  name: 'textract', displayName: 'AWS Textract', kind: 'structured',
  requiredCredentials: ['accessKeyId', 'secretAccessKey', 'region'],
  isConfigured: (c) => !!c?.accessKeyId && !!c?.secretAccessKey && !!c?.region,
  async extract(file, creds) {
    const client = new TextractClient({ region: creds.region,
      credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey } });
    const out = await client.send(new AnalyzeExpenseCommand({ Document: { Bytes: file } }));
    const mapped = mapTextract(out);
    return { ...mapped, rawText: '', rawJson: out as unknown };
  },
};
