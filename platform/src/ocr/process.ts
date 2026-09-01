/**
 * OCR pipeline entry point.
 * Reads settings from DB, builds fallback chain, and delegates to the chain orchestrator.
 * All model/provider config comes from Settings UI — no hardcoded models.
 */
import { getSettings, buildFallbackChain, type FallbackLevel } from '../shared/settings.js';
import type { ParsedInvoiceData } from './types/invoice.js';
import type { OcrCostInfo } from './types/provider.js';
import { runFallbackChain, type FallbackChainResult } from './pipeline/fallbackChain.js';
import { SUPPORTED_PROVIDERS } from './providers/llmNormalize.js';
import { SINGLE_PROVIDERS } from './providers/llmSingle.js';

export interface PipelineResult {
  parsed: ParsedInvoiceData;
  rawOcr: string;
  costInfo: OcrCostInfo;
  providers: { extraction: string; structuring: string; mode: 'split' | 'single' };
  fallbackReason?: string;
}

/**
 * Run the full OCR pipeline using the fallback chain from DB settings.
 * Each level is tried in order; moves to next on API error or reconciliation mismatch.
 */
export async function runPipeline(buf: Buffer, contextId = 'ocr'): Promise<FallbackChainResult> {
  const settings = await getSettings();
  const chain = buildFallbackChain(settings);

  console.log(
    `[OCR] ${contextId} — fallback chain: ${chain.map((l) => `${l.label}(${l.mode}/${l.provider}/${l.model})`).join(' → ')}`,
  );

  return runFallbackChain(buf, chain, contextId);
}

export { SUPPORTED_PROVIDERS, SINGLE_PROVIDERS };
export type { FallbackLevel, FallbackChainResult };
