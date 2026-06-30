import type { CanonicalResult } from '../providers/types.js';
import { allProviders, getProvider } from '../providers/registry.js';
import { getCredentials, getProviderCredsOrThrow, getSetting } from '../settings/store.js';
import { DEFAULTS } from '../settings/defaults.js';
import { enrichStructured } from '../structuring/index.js';
import { deriveConfidence } from './confidence.js';
import { pageCount } from '../lib/pdf.js';

async function isConfigured(name: string): Promise<boolean> {
  try { return getProvider(name).isConfigured(await getCredentials(name)); } catch { return false; }
}

/**
 * Choose the extraction provider for a one-off parse: a caller-requested provider (if it has
 * credentials), else the configured default, else any configured provider. Mirrors the picker
 * in run.ts but needs no invoice row.
 */
async function resolveProviderName(preferred?: string): Promise<string> {
  if (preferred && (await isConfigured(preferred))) return preferred;
  const def = await getSetting('extraction_provider', DEFAULTS.extraction_provider);
  if (await isConfigured(def)) return def;
  for (const p of allProviders()) if (await isConfigured(p.name)) return p.name;
  return preferred ?? def;
}

/**
 * Run the full extraction pipeline on PDF bytes and return the structured result WITHOUT
 * persisting anything. Used by the stateless POST /api/parse endpoint so the same OCR +
 * structuring + footer logic can be consumed from anywhere via a single request.
 */
export async function parseInvoiceBuffer(
  file: Buffer,
  opts: { fileName?: string; provider?: string } = {},
): Promise<{ provider: string; pageCount: number; result: CanonicalResult }> {
  const name = await resolveProviderName(opts.provider);
  const provider = getProvider(name);
  const creds = await getProviderCredsOrThrow(name, provider);
  const pages = await pageCount(file);
  const structuring = {
    provider: await getSetting('structuring_provider', DEFAULTS.structuring_provider),
    model: await getSetting('structuring_model', DEFAULTS.structuring_model),
  };
  let result = await provider.extract(file, creds, { fileName: opts.fileName ?? 'invoice.pdf', structuring });
  // Structured providers (Azure/Textract) miss the GST/discount/summary footer — enrich them.
  if (provider.kind === 'structured') result = await enrichStructured(result);
  result.confidence = result.confidence ?? deriveConfidence(result);
  result.pageCount = pages;
  return { provider: name, pageCount: pages, result };
}
