/**
 * Split OCR mode — Mistral OCR (markdown) then a second LLM call to structure JSON.
 * On failure → gemini-2.5-flash single retry (never Mistral-only fallback).
 */
import { mistralOcr } from '../providers/mistralOcr.js';
import { llmNormalize } from '../providers/llmNormalize.js';
import { llmSingle } from '../providers/llmSingle.js';
import { GEMINI_SINGLE_FALLBACK_MODEL } from './single.js';
import type { ParsedInvoiceData } from '../types/invoice.js';
import type { OcrStepCost, OcrCostInfo } from '../types/provider.js';
import type { PipelineResult } from '../process.js';

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
    if (provider !== 'gemini' || model !== GEMINI_SINGLE_FALLBACK_MODEL) {
      console.error(`[OCR] ${contextId} — ${provider} structuring FAILED: ${msg}`);
      console.warn(`[OCR] ${contextId} — retrying structure with ${GEMINI_SINGLE_FALLBACK_MODEL}...`);
      const r = await llmNormalize(rawOcr, 'gemini', GEMINI_SINGLE_FALLBACK_MODEL);
      console.log(`[OCR] ${contextId} — gemini structuring fallback done (${r.cost.latency_ms}ms, $${r.cost.cost_usd.toFixed(4)})`);
      return {
        parsed: r.parsed,
        cost: r.cost,
        actualProvider: 'gemini',
        fallbackReason: `${provider} structure failed → ${GEMINI_SINGLE_FALLBACK_MODEL}: ${msg}`,
      };
    }
    throw err;
  }
}

function toSingleResult(
  r: Awaited<ReturnType<typeof llmSingle>>,
  provider: string,
  fallbackReason?: string,
): PipelineResult {
  return {
    parsed: r.parsed,
    rawOcr: r.rawOcr,
    costInfo: {
      extraction: r.cost,
      structuring: null,
      total_cost_usd: r.cost.cost_usd,
      total_tokens: r.cost.usage.total_tokens,
    },
    providers: { extraction: provider, structuring: provider, mode: 'single' },
    fallbackReason,
  };
}

export async function runSplitMode(
  buf: Buffer,
  structuringProvider: string,
  structuringModel: string | undefined,
  contextId: string,
): Promise<PipelineResult> {
  console.log(`[OCR] ${contextId} — split mode: extract=mistral, structure=${structuringProvider}`);

  try {
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[OCR] ${contextId} — split FAILED: ${msg}`);
    console.warn(
      `[OCR] ${contextId} — falling back to Gemini single (${GEMINI_SINGLE_FALLBACK_MODEL}) — not Mistral-only...`,
    );
    const r = await llmSingle(buf, 'gemini', GEMINI_SINGLE_FALLBACK_MODEL);
    console.log(
      `[OCR] ${contextId} — gemini single fallback done (${r.cost.latency_ms}ms, $${r.cost.cost_usd.toFixed(4)})`,
    );
    return toSingleResult(r, 'gemini', `split failed → ${GEMINI_SINGLE_FALLBACK_MODEL} single: ${msg}`);
  }
}
