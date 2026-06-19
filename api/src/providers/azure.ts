import type { ExtractionProvider, CanonicalResult } from './types.js';
const num = (f: any): number | undefined =>
  f?.valueCurrency?.amount ?? f?.valueNumber ?? (f?.content ? Number(String(f.content).replace(/[^0-9.\-]/g, '')) : undefined);
const str = (f: any): string | undefined => f?.content ?? f?.valueString ?? undefined;

export function mapAzure(json: any): Omit<CanonicalResult, 'rawText' | 'rawJson' | 'costEstimate' | 'latencyMs' | 'pageCount'> {
  const f = json?.documents?.[0]?.fields ?? {};
  const items = (f.Items?.valueArray ?? []).map((it: any, i: number) => {
    const o = it.valueObject ?? {};
    return { lineNumber: i + 1, description: str(o.Description), sku: str(o.ProductCode),
      quantity: num(o.Quantity), unitPrice: num(o.UnitPrice), amount: num(o.Amount), taxRate: num(o.TaxRate) };
  });
  const confs = Object.values(f).map((x: any) => x?.confidence).filter((c: any) => typeof c === 'number');
  return {
    vendorName: str(f.VendorName), vendorAddress: str(f.VendorAddress), vendorTaxId: str(f.VendorTaxId),
    invoiceNumber: str(f.InvoiceId), poNumber: str(f.PurchaseOrder),
    invoiceDate: str(f.InvoiceDate), dueDate: str(f.DueDate),
    currency: f.InvoiceTotal?.valueCurrency?.currencyCode ?? str(f.Currency),
    subtotal: num(f.SubTotal), taxAmount: num(f.TotalTax), totalAmount: num(f.InvoiceTotal),
    paymentTerms: str(f.PaymentTerm),
    confidence: confs.length ? confs.reduce((a: number, b: number) => a + b, 0) / confs.length : undefined,
    lineItems: items,
  };
}

export const azureProvider: ExtractionProvider = {
  name: 'azure', displayName: 'Azure Document Intelligence', kind: 'structured',
  requiredCredentials: ['endpoint', 'apiKey'],
  isConfigured: (c) => !!c?.endpoint && !!c?.apiKey,
  async extract(file, creds) {
    const base = creds.endpoint.replace(/\/$/, '');
    // GA Document Intelligence version; override with an `apiVersion` credential if needed.
    const apiVersion = creds.apiVersion || '2024-11-30';
    const url = `${base}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=${apiVersion}`;
    const submit = await fetch(url, { method: 'POST',
      headers: { 'content-type': 'application/pdf', 'ocp-apim-subscription-key': creds.apiKey }, body: file as unknown as BodyInit });
    if (!submit.ok) {
      const detail = (await submit.text().catch(() => '')).slice(0, 500);
      throw new Error(
        `Azure analyze HTTP ${submit.status} (api-version ${apiVersion}). ` +
          `Check the endpoint is your Document Intelligence resource URL and the key/region are correct. ${detail}`,
      );
    }
    const opLoc = submit.headers.get('operation-location');
    if (!opLoc) throw new Error('Azure: missing operation-location header');
    let result: any;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const poll = await fetch(opLoc, { headers: { 'ocp-apim-subscription-key': creds.apiKey } });
      if (!poll.ok) {
        const detail = (await poll.text().catch(() => '')).slice(0, 300);
        throw new Error(`Azure poll HTTP ${poll.status}. ${detail}`);
      }
      const j: any = await poll.json();
      if (j.status === 'succeeded') { result = j.analyzeResult; break; }
      if (j.status === 'failed') throw new Error(`Azure analysis failed: ${JSON.stringify(j.error ?? {}).slice(0, 300)}`);
    }
    if (!result) throw new Error('Azure analysis timed out');
    const mapped = mapAzure(result);
    return { ...mapped, rawText: result.content ?? '', rawJson: result };
  },
};
