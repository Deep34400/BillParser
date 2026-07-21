/**
 * OCR pipeline entry point.
 * Reads settings from DB to decide pipeline mode and providers.
 *
 * Modes:
 *   SINGLE — one multimodal API call (extract + structure together). Preferred.
 *   SPLIT  — Mistral OCR (markdown) then a second LLM call to structure JSON.
 *
 * Fallback (both modes): if the Settings model fails → gemini-2.5-flash SINGLE.
 * Never falls back to Mistral split when the user chose Single.
 */
import { getSettings } from '../shared/settings.js';
import type { ParsedInvoiceData } from './types/invoice.js';
import type { OcrCostInfo } from './types/provider.js';
import { runSingleMode, GEMINI_SINGLE_FALLBACK_MODEL } from './pipeline/single.js';
import { runSplitMode } from './pipeline/split.js';
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
 * Run the full OCR pipeline based on DB settings.
 * - single: one multimodal LLM (Gemini / Claude / OpenAI / Mistral) does both
 * - split: Mistral OCR → any LLM for structuring
 * On failure of either path → retry with Gemini 2.5 Flash single (never Mistral-only split fallback).
 */
export async function runPipeline(buf: Buffer, contextId = 'ocr'): Promise<PipelineResult> {
  const settings = await getSettings();
  const mode = settings.pipelineMode ?? 'single';
  console.log(
    `[OCR] ${contextId} — settings: mode=${mode}, structProv=${settings.structuringProvider}, ` +
    `structModel=${settings.structuringModel}, singleProv=${settings.singleProvider}, singleModel=${settings.singleModel}`,
  );

  if (mode === 'single') {
    return runSingleMode(
      buf,
      settings.singleProvider ?? 'gemini',
      settings.singleModel,
      contextId,
    );
  }

  return runSplitMode(
    buf,
    settings.structuringProvider ?? 'mistral',
    settings.structuringModel,
    contextId,
  );
}

export { GEMINI_SINGLE_FALLBACK_MODEL, SUPPORTED_PROVIDERS, SINGLE_PROVIDERS };
