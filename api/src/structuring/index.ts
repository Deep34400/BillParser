import type { CanonicalResult } from '../providers/types.js';
import type { StructuringModel } from './types.js';
import { getSetting, getCredentials } from '../settings/store.js';
import { DEFAULTS } from '../settings/defaults.js';
import { anthropicModel } from './anthropic.js';
import { openaiModel } from './openai.js';
import { mistralStructModel } from './mistral.js';
import { ollamaStructModel } from './ollama.js';
import { geminiModel } from './gemini.js';

export { normalizeStructured } from '../parsing/index.js';

export async function getStructuringModel(): Promise<{ model: StructuringModel; creds: Record<string, string> }> {
  const provider = await getSetting('structuring_provider', DEFAULTS.structuring_provider);
  const model = await getSetting('structuring_model', DEFAULTS.structuring_model);
  const creds = (await getCredentials(`structuring_${provider}`)) ?? (await getCredentials(provider)) ?? {};
  const impl: Record<string, (m: string) => StructuringModel> = {
    anthropic: anthropicModel, openai: openaiModel, mistral: mistralStructModel,
    ollama: ollamaStructModel, gemini: geminiModel,
  };
  const factory = impl[provider];
  if (!factory) throw new Error(`Unknown structuring provider: ${provider}`);
  return { model: factory(model), creds };
}

type Structurer = (markdown: string) => Promise<Omit<CanonicalResult, 'rawText' | 'rawJson'>>;
export async function enrichStructured(base: CanonicalResult, structurer?: Structurer): Promise<CanonicalResult> {
  if (!base.rawText) return base;
  try {
    const run: Structurer = structurer ?? (async (md) => {
      const { model, creds } = await getStructuringModel();
      return model.structure(md, creds);
    });
    const s = await run(base.rawText);
    const ident = <K extends keyof CanonicalResult>(k: K) => base[k] ?? (s as any)[k];
    const gstField = <K extends keyof typeof s>(k: K) => (s[k] ?? (base as any)[k]);
    return {
      ...base,
      vendorName: ident('vendorName'), vendorAddress: ident('vendorAddress'), vendorTaxId: ident('vendorTaxId'),
      invoiceNumber: ident('invoiceNumber'), poNumber: ident('poNumber'),
      invoiceDate: ident('invoiceDate'), dueDate: ident('dueDate'),
      currency: ident('currency'), paymentTerms: ident('paymentTerms'),
      subtotal: gstField('subtotal'), discountAmount: s.discountAmount,
      cgstAmount: s.cgstAmount, sgstAmount: s.sgstAmount, igstAmount: s.igstAmount,
      taxAmount: gstField('taxAmount'), totalAmount: gstField('totalAmount'), netAmount: gstField('netAmount'),
      summaryColumns: s.summaryColumns,
      lineItems: s.lineItems && s.lineItems.length ? s.lineItems : base.lineItems,
      confidence: base.confidence ?? s.confidence,
      structuringCost: s.structuringCost,
      parsedData: s.parsedData ?? base.parsedData,
    };
  } catch {
    return base;
  }
}
