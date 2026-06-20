import { readFile } from 'node:fs/promises';
import { prisma } from '../db.js';
import type { CanonicalResult, ExtractionProvider } from '../providers/types.js';
import { allProviders, getProvider } from '../providers/registry.js';
import { getCredentials, getProviderCredsOrThrow, getSetting } from '../settings/store.js';

// Pick a sensible extraction provider when the caller didn't specify one. The configured
// default (extraction_provider) is only honored if it actually has credentials — otherwise
// re-extraction would fail with "No credentials configured" for a provider the user never set
// up (e.g. the seed default 'mistral'). Falls back to the invoice's own last-used provider,
// then any configured provider, and finally the raw default so the failure message is clear.
async function resolveProvider(invoiceId: string): Promise<string> {
  const isConfigured = async (name: string): Promise<boolean> => {
    try { return getProvider(name).isConfigured(await getCredentials(name)); } catch { return false; }
  };
  const def = await getSetting('extraction_provider', 'mistral');
  if (await isConfigured(def)) return def;
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (inv?.provider && (await isConfigured(inv.provider))) return inv.provider;
  for (const p of allProviders()) if (await isConfigured(p.name)) return p.name;
  return def;
}
import { deriveConfidence, estimateCost } from './confidence.js';
import { pageCount } from '../lib/pdf.js';

// Parse a date string safely — an unparseable date (e.g. "29.01.2026") must never
// crash the whole extraction; store null instead of an Invalid Date that Prisma rejects.
export function toDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function headerData(r: CanonicalResult) {
  return {
    vendorName: r.vendorName ?? null, vendorAddress: r.vendorAddress ?? null, vendorTaxId: r.vendorTaxId ?? null,
    invoiceNumber: r.invoiceNumber ?? null, poNumber: r.poNumber ?? null,
    invoiceDate: toDate(r.invoiceDate), dueDate: toDate(r.dueDate),
    currency: r.currency ?? null, subtotal: r.subtotal ?? null, taxAmount: r.taxAmount ?? null,
    totalAmount: r.totalAmount ?? null, paymentTerms: r.paymentTerms ?? null,
    rawText: r.rawText ?? null, rawJson: (r.rawJson ?? null) as any,
  };
}

export async function runExtractionWith(invoiceId: string, provider: ExtractionProvider, creds: Record<string, string>): Promise<void> {
  await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'PROCESSING', error: null, provider: provider.name } });
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const started = Date.now();
  try {
    const file = await readFile(inv.storedPath);
    const pages = await pageCount(file);
    const structuring = { provider: await getSetting('structuring_provider', 'anthropic'), model: await getSetting('structuring_model', 'claude-sonnet-4-6') };
    const result = await provider.extract(file, creds, { fileName: inv.fileName, structuring });
    const confidence = deriveConfidence(result);
    const costEstimate = result.costEstimate ?? estimateCost(provider.name, pages);
    const latencyMs = Date.now() - started;
    await prisma.$transaction(async (tx) => {
      const run = await tx.extractionRun.create({ data: {
        invoiceId, provider: provider.name, structuringModel: provider.kind === 'markdown' ? structuring.model : null,
        status: 'COMPLETED', confidence, costEstimate, latencyMs, pageCount: pages,
        rawText: result.rawText, rawJson: result.rawJson as any, error: null,
        fieldsSnapshot: headerData(result) as any, itemsSnapshot: result.lineItems as any,
      } });
      await tx.lineItem.deleteMany({ where: { invoiceId } });
      await tx.lineItem.createMany({ data: (result.lineItems.map((li) => ({ invoiceId, ...li }))) as any });
      await tx.invoice.update({ where: { id: invoiceId }, data: {
        status: 'COMPLETED', confidence, provider: provider.name, error: null, activeRunId: run.id, ...headerData(result),
      } });
    });
  } catch (e: any) {
    const latencyMs = Date.now() - started;
    await prisma.extractionRun.create({ data: { invoiceId, provider: provider.name, status: 'FAILED', latencyMs, error: String(e?.message ?? e) } });
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'FAILED', error: String(e?.message ?? e), provider: provider.name } });
  }
}

export async function runExtraction(invoiceId: string, providerName?: string): Promise<void> {
  let name = providerName ?? 'mistral';
  try {
    name = providerName ?? (await resolveProvider(invoiceId));
    const provider = getProvider(name);
    const creds = await getProviderCredsOrThrow(name, provider);
    await runExtractionWith(invoiceId, provider, creds);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    await prisma.extractionRun.create({ data: { invoiceId, provider: name, status: 'FAILED', error: msg } });
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'FAILED', error: msg, provider: name } });
  }
}

export async function runOneForBakeoff(invoiceId: string, provider: ExtractionProvider, creds: Record<string, string>) {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const started = Date.now();
  try {
    const file = await readFile(inv.storedPath);
    const pages = await pageCount(file);
    const structuring = { provider: await getSetting('structuring_provider', 'anthropic'), model: await getSetting('structuring_model', 'claude-sonnet-4-6') };
    const result = await provider.extract(file, creds, { fileName: inv.fileName, structuring });
    return prisma.extractionRun.create({ data: { invoiceId, provider: provider.name,
      structuringModel: provider.kind === 'markdown' ? structuring.model : null, status: 'COMPLETED',
      confidence: deriveConfidence(result), costEstimate: result.costEstimate ?? estimateCost(provider.name, pages),
      latencyMs: Date.now() - started, pageCount: pages, rawText: result.rawText, rawJson: result.rawJson as any,
      fieldsSnapshot: headerData(result) as any, itemsSnapshot: result.lineItems as any } });
  } catch (e: any) {
    return prisma.extractionRun.create({ data: { invoiceId, provider: provider.name, status: 'FAILED',
      latencyMs: Date.now() - started, error: String(e?.message ?? e) } });
  }
}

export async function bakeoffInvoice(invoiceId: string) {
  const runs = [];
  for (const p of allProviders()) {
    const creds = await getCredentials(p.name);
    if (!p.isConfigured(creds)) continue;
    runs.push(await runOneForBakeoff(invoiceId, p, creds!));
  }
  return runs;
}
