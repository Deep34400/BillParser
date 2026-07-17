/**
 * OCR pipeline orchestrator.
 * Reads settings from DB to decide pipeline mode and providers.
 * Supports: Mistral, Gemini, Claude, OpenAI — any model for structuring.
 */
import { getSettings } from '../../models/settings.js';
import { llmNormalize, SUPPORTED_PROVIDERS } from '../../providers/llmNormalize.js';
import { mistralOcr } from '../../providers/mistralOcr.js';
import { geminiSingle } from '../../providers/geminiSingle.js';
import type { ParsedInvoiceData } from '../../models/types.js';
import type { OcrStepCost, OcrCostInfo } from '../../providers/types.js';

export interface PipelineResult {
  parsed: ParsedInvoiceData;
  rawOcr: string;
  costInfo: OcrCostInfo;
  providers: { extraction: string; structuring: string; mode: 'split' | 'single' };
  fallbackReason?: string;
}

/**
 * Run the full OCR pipeline based on DB settings.
 * - split: Mistral OCR → any LLM for structuring
 * - single: Gemini does both in one call
 */
export async function runPipeline(buf: Buffer, contextId = 'ocr'): Promise<PipelineResult> {
  const settings = await getSettings();
  const mode = settings.pipelineMode ?? 'split';
  console.log(`[OCR] ${contextId} — settings: mode=${mode}, structProv=${settings.structuringProvider}, structModel=${settings.structuringModel}, singleProv=${settings.singleProvider}`);

  if (mode === 'single') {
    return runSingleMode(buf, settings.singleProvider ?? 'gemini', contextId);
  }

  return runSplitMode(
    buf,
    settings.structuringProvider ?? 'mistral',
    settings.structuringModel,
    contextId,
  );
}

async function runSingleMode(buf: Buffer, provider: string, contextId: string): Promise<PipelineResult> {
  console.log(`[OCR] ${contextId} — single mode using ${provider}...`);

  if (provider === 'gemini') {
    try {
      const r = await geminiSingle(buf);
      console.log(`[OCR] ${contextId} — Gemini single done (${r.cost.latency_ms}ms, ${r.cost.usage.total_tokens} tokens, $${r.cost.cost_usd.toFixed(4)})`);
      const zeroCost: OcrStepCost = { ...r.cost, cost_usd: 0, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
      return {
        parsed: r.parsed,
        rawOcr: r.rawOcr,
        costInfo: { extraction: r.cost, structuring: zeroCost, total_cost_usd: r.cost.cost_usd, total_tokens: r.cost.usage.total_tokens },
        providers: { extraction: 'gemini', structuring: 'gemini', mode: 'single' },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[OCR] ${contextId} — Gemini single FAILED: ${msg}`);
      console.warn(`[OCR] ${contextId} — falling back to split mode (Mistral OCR + Mistral structure)...`);
      const result = await runSplitMode(buf, 'mistral', undefined, contextId);
      return { ...result, fallbackReason: `Gemini single failed: ${msg}` };
    }
  }

  console.warn(`[OCR] ${contextId} — single mode only supports gemini, falling back to split mode`);
  return runSplitMode(buf, 'mistral', undefined, contextId);
}

async function runSplitMode(
  buf: Buffer,
  structuringProvider: string,
  structuringModel: string | undefined,
  contextId: string,
): Promise<PipelineResult> {
  console.log(`[OCR] ${contextId} — split mode: extract=mistral, structure=${structuringProvider}`);

  console.log(`[OCR] ${contextId} — calling Mistral OCR...`);
  const ocrResult = await mistralOcr(buf, true);
  const rawOcr = ocrResult.markdown;
  const extractionCost = ocrResult.cost;
  console.log(`[OCR] ${contextId} — Mistral OCR done (${extractionCost.latency_ms}ms, $${extractionCost.cost_usd.toFixed(4)})`);

  const structResult = await runStructuring(rawOcr, structuringProvider, structuringModel, contextId);

  const costInfo: OcrCostInfo = {
    extraction: extractionCost,
    structuring: structResult.cost,
    total_cost_usd: extractionCost.cost_usd + structResult.cost.cost_usd,
    total_tokens: extractionCost.usage.total_tokens + structResult.cost.usage.total_tokens,
  };

  return {
    parsed: structResult.parsed,
    rawOcr,
    costInfo,
    providers: { extraction: 'mistral', structuring: structResult.actualProvider, mode: 'split' },
    fallbackReason: structResult.fallbackReason,
  };
}

interface StructResult {
  parsed: ParsedInvoiceData;
  cost: OcrStepCost;
  actualProvider: string;
  fallbackReason?: string;
}

async function runStructuring(
  rawOcr: string,
  provider: string,
  model: string | undefined,
  contextId: string,
): Promise<StructResult> {
  try {
    console.log(`[OCR] ${contextId} — calling ${provider} for structuring (model=${model ?? 'default'})...`);
    const r = await llmNormalize(rawOcr, provider, model);
    console.log(`[OCR] ${contextId} — ${provider} structuring done (${r.cost.latency_ms}ms, $${r.cost.cost_usd.toFixed(4)})`);
    return { parsed: r.parsed, cost: r.cost, actualProvider: provider };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (provider === 'mistral') {
      throw err;
    }

    console.error(`[OCR] ${contextId} — ${provider} structuring FAILED: ${msg}`);
    console.warn(`[OCR] ${contextId} — falling back to Mistral for structuring...`);
    const r = await llmNormalize(rawOcr, 'mistral');
    console.log(`[OCR] ${contextId} — Mistral fallback structuring done (${r.cost.latency_ms}ms, $${r.cost.cost_usd.toFixed(4)})`);
    return { parsed: r.parsed, cost: r.cost, actualProvider: 'mistral', fallbackReason: `${provider} failed: ${msg}` };
  }
}

export { SUPPORTED_PROVIDERS };
