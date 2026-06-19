import { readFile } from 'node:fs/promises';
import { prisma } from '../db.js';
import type { CanonicalResult, ExtractionProvider } from '../providers/types.js';
import { allProviders, getProvider } from '../providers/registry.js';
import { getCredentials, getProviderCredsOrThrow, getSetting } from '../settings/store.js';
import { deriveConfidence, estimateCost } from './confidence.js';
import { pageCount } from '../lib/pdf.js';

function headerData(r: CanonicalResult) {
  return {
    vendorName: r.vendorName ?? null, vendorAddress: r.vendorAddress ?? null, vendorTaxId: r.vendorTaxId ?? null,
    invoiceNumber: r.invoiceNumber ?? null, poNumber: r.poNumber ?? null,
    invoiceDate: r.invoiceDate ? new Date(r.invoiceDate) : null, dueDate: r.dueDate ? new Date(r.dueDate) : null,
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
    name = providerName ?? (await getSetting('extraction_provider', 'mistral'));
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
