import type { CanonicalResult } from '../providers/types.js';
import type { StructuringModel } from './types.js';
import { getSetting, getCredentials } from '../settings/store.js';
import { anthropicModel } from './anthropic.js';
import { openaiModel } from './openai.js';
import { mistralStructModel } from './mistral.js';
import { ollamaStructModel } from './ollama.js';

const toNum = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};
const toStr = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v));

export function normalizeStructured(raw: string): Omit<CanonicalResult, 'rawText' | 'rawJson'> {
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  const json = start >= 0 && end >= 0 ? raw.slice(start, end + 1) : raw;
  const o = JSON.parse(json) as Record<string, unknown>;
  const items = Array.isArray(o.lineItems) ? o.lineItems : [];
  return {
    vendorName: toStr(o.vendorName), vendorAddress: toStr(o.vendorAddress), vendorTaxId: toStr(o.vendorTaxId),
    invoiceNumber: toStr(o.invoiceNumber), poNumber: toStr(o.poNumber),
    invoiceDate: toStr(o.invoiceDate), dueDate: toStr(o.dueDate),
    currency: toStr(o.currency), subtotal: toNum(o.subtotal), taxAmount: toNum(o.taxAmount),
    totalAmount: toNum(o.totalAmount), paymentTerms: toStr(o.paymentTerms),
    confidence: toNum(o.confidence),
    lineItems: items.map((it: any, i: number) => ({
      lineNumber: i + 1, description: toStr(it.description), sku: toStr(it.sku),
      quantity: toNum(it.quantity), unitPrice: toNum(it.unitPrice), amount: toNum(it.amount), taxRate: toNum(it.taxRate),
    })),
  };
}

export async function getStructuringModel(): Promise<{ model: StructuringModel; creds: Record<string, string> }> {
  const provider = await getSetting('structuring_provider', 'anthropic');
  const model = await getSetting('structuring_model', 'claude-sonnet-4-6');
  const creds = (await getCredentials(`structuring_${provider}`)) ?? (await getCredentials(provider)) ?? {};
  const impl: Record<string, (m: string) => StructuringModel> = {
    anthropic: anthropicModel, openai: openaiModel, mistral: mistralStructModel,
    ollama: ollamaStructModel,
  };
  const factory = impl[provider];
  if (!factory) throw new Error(`Unknown structuring provider: ${provider}`);
  return { model: factory(model), creds };
}
