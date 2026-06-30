import { readFile } from 'node:fs/promises';
import { prisma } from '../config/db.js';
import type { CanonicalResult, ExtractionProvider } from '../providers/types.js';
import { allProviders, getProvider } from '../providers/registry.js';
import { getCredentials, getProviderCredsOrThrow, getSetting } from '../settings/store.js';
import { DEFAULTS } from '../settings/defaults.js';
import { startCancellable, finishCancellable, isCancelError } from './cancel.js';

// Pick a sensible extraction provider when the caller didn't specify one. The configured
// default (extraction_provider) is only honored if it actually has credentials — otherwise
// re-extraction would fail with "No credentials configured" for a provider the user never set
// up (e.g. the seed default 'mistral'). Falls back to the invoice's own last-used provider,
// then any configured provider, and finally the raw default so the failure message is clear.
async function resolveProvider(invoiceId: string): Promise<string> {
  const isConfigured = async (name: string): Promise<boolean> => {
    try { return getProvider(name).isConfigured(await getCredentials(name)); } catch { return false; }
  };
  const def = await getSetting('extraction_provider', DEFAULTS.extraction_provider);
  if (await isConfigured(def)) return def;
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (inv?.provider && (await isConfigured(inv.provider))) return inv.provider;
  for (const p of allProviders()) if (await isConfigured(p.name)) return p.name;
  return def;
}
import { deriveConfidence, estimateCost } from './confidence.js';
import { enrichStructured } from '../structuring/index.js';
import { pageCount } from '../lib/pdf.js';

// Parse a date string safely — an unparseable date (e.g. "29.01.2026") must never
// crash the whole extraction; store null instead of an Invalid Date that Prisma rejects.
export function toDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Record an extraction failure without ever throwing. These run inside fire-and-forget
// background tasks, so an error here (e.g. the invoice was deleted mid-flight, making the
// ExtractionRun foreign key invalid) must not escape as an unhandled rejection that crashes
// the process. Skip silently when the invoice no longer exists; log anything else.
async function recordFailure(invoiceId: string, providerName: string, msg: string, latencyMs?: number): Promise<void> {
  try {
    const exists = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true } });
    if (!exists) return;
    await prisma.extractionRun.create({ data: { invoiceId, provider: providerName, status: 'FAILED', error: msg, latencyMs: latencyMs ?? null } });
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'FAILED', error: msg, provider: providerName } });
  } catch (e) {
    console.error(`[runExtraction] failed to record failure for invoice ${invoiceId}:`, e);
  }
}

function headerData(r: CanonicalResult) {
  return {
    vendorName: r.vendorName ?? null, vendorAddress: r.vendorAddress ?? null, vendorTaxId: r.vendorTaxId ?? null,
    invoiceNumber: r.invoiceNumber ?? null, poNumber: r.poNumber ?? null,
    invoiceDate: toDate(r.invoiceDate), dueDate: toDate(r.dueDate),
    currency: r.currency ?? null, subtotal: r.subtotal ?? null, taxAmount: r.taxAmount ?? null,
    totalAmount: r.totalAmount ?? null, paymentTerms: r.paymentTerms ?? null,
    discountAmount: r.discountAmount ?? null, cgstAmount: r.cgstAmount ?? null, sgstAmount: r.sgstAmount ?? null,
    igstAmount: r.igstAmount ?? null, netAmount: r.netAmount ?? null,
    summaryColumns: (r.summaryColumns ?? null) as any,
    parsedData: (r.parsedData ?? null) as any,
    rawText: r.rawText ?? null, rawJson: (r.rawJson ?? null) as any,
  };
}

export async function runExtractionWith(invoiceId: string, provider: ExtractionProvider, creds: Record<string, string>): Promise<void> {
  await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'PROCESSING', error: null, provider: provider.name } });
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const started = Date.now();
  const controller = startCancellable(invoiceId);
  try {
    const file = await readFile(inv.storedPath);
    const pages = await pageCount(file);
    const structuring = { provider: await getSetting('structuring_provider', DEFAULTS.structuring_provider), model: await getSetting('structuring_model', DEFAULTS.structuring_model) };
    let result = await provider.extract(file, creds, { fileName: inv.fileName, structuring, signal: controller.signal });
    // Structured providers (Azure/Textract) detect headers well but miss the GST breakdown,
    // discount, summary columns and per-line HSN/labour. Enrich with a structuring pass over
    // the OCR text so the bottom summary is complete. Markdown providers already structure.
    if (provider.kind === 'structured') {
      result = await enrichStructured(result);
    }
    // A cancel that lands right as extraction finishes must not overwrite the FAILED/cancelled
    // status with COMPLETED — the cancel endpoint already set it.
    if (controller.signal.aborted) return;
    const confidence = deriveConfidence(result);
    // Total cost = extraction (OCR, per-page estimate) + structuring (LLM, from token usage).
    // The split is re-derived for display from provider + pageCount; here we store the total.
    const extractionCost = result.costEstimate ?? estimateCost(provider.name, pages) ?? 0;
    const costEstimate = extractionCost + (result.structuringCost ?? 0);
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
    const cancelled = controller.signal.aborted || isCancelError(e);
    const msg = cancelled ? 'Cancelled by user' : String(e?.message ?? e);
    await recordFailure(invoiceId, provider.name, msg, latencyMs);
  } finally {
    finishCancellable(invoiceId, controller);
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
    await recordFailure(invoiceId, name, String(e?.message ?? e));
  }
}

export async function runOneForBakeoff(invoiceId: string, provider: ExtractionProvider, creds: Record<string, string>) {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const started = Date.now();
  try {
    const file = await readFile(inv.storedPath);
    const pages = await pageCount(file);
    const structuring = { provider: await getSetting('structuring_provider', DEFAULTS.structuring_provider), model: await getSetting('structuring_model', DEFAULTS.structuring_model) };
    const result = await provider.extract(file, creds, { fileName: inv.fileName, structuring });
    return prisma.extractionRun.create({ data: { invoiceId, provider: provider.name,
      structuringModel: provider.kind === 'markdown' ? structuring.model : null, status: 'COMPLETED',
      confidence: deriveConfidence(result), costEstimate: (result.costEstimate ?? estimateCost(provider.name, pages) ?? 0) + (result.structuringCost ?? 0),
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
