/**
 * OCR pipeline orchestrator.
 * Reads settings from DB to decide pipeline mode and providers.
 *
 * Modes:
 *   SINGLE — one multimodal API call (extract + structure together). Preferred.
 *   SPLIT  — Mistral OCR (markdown) then a second LLM call to structure JSON.
 *
 * Fallback (both modes): if the Settings model fails → gemini-2.5-flash SINGLE.
 * Never falls back to Mistral split when the user chose Single.
 */
import { getSettings } from '../../models/settings.js';
import { llmNormalize, SUPPORTED_PROVIDERS } from '../../providers/llmNormalize.js';
import { mistralOcr } from '../../providers/mistralOcr.js';
import { llmSingle, SINGLE_PROVIDERS } from '../../providers/llmSingle.js';
import type { ParsedInvoiceData } from '../../models/types.js';
import type { OcrStepCost, OcrCostInfo } from '../../providers/types.js';

/** Reliable single-call fallback when the Settings model fails. */
export const GEMINI_SINGLE_FALLBACK_MODEL = 'gemini-2.5-flash';

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

/** One multimodal call. On failure → gemini-2.5-flash single (never split). */
async function runSingleMode(
  buf: Buffer,
  provider: string,
  model: string | undefined,
  contextId: string,
): Promise<PipelineResult> {
  const effectiveModel = model ?? (provider === 'gemini' ? GEMINI_SINGLE_FALLBACK_MODEL : undefined);
  console.log(`[OCR] ${contextId} — single mode using ${provider} (model=${effectiveModel ?? 'default'})...`);

  try {
    const r = await llmSingle(buf, provider, effectiveModel);
    console.log(
      `[OCR] ${contextId} — ${provider} single done (${r.cost.latency_ms}ms, ` +
      `${r.cost.usage.total_tokens} tokens, $${r.cost.cost_usd.toFixed(4)})`,
    );
    return toSingleResult(r, provider);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[OCR] ${contextId} — ${provider} single FAILED: ${msg}`);

    const alreadyFallback =
      provider === 'gemini' &&
      (effectiveModel === GEMINI_SINGLE_FALLBACK_MODEL || !effectiveModel);

    if (alreadyFallback) {
      throw err;
    }

    console.warn(
      `[OCR] ${contextId} — retrying with Gemini single (${GEMINI_SINGLE_FALLBACK_MODEL}) — not split...`,
    );
    const r = await llmSingle(buf, 'gemini', GEMINI_SINGLE_FALLBACK_MODEL);
    console.log(
      `[OCR] ${contextId} — gemini single fallback done (${r.cost.latency_ms}ms, $${r.cost.cost_usd.toFixed(4)})`,
    );
    return toSingleResult(r, 'gemini', `${provider}/${effectiveModel} failed → ${GEMINI_SINGLE_FALLBACK_MODEL} single: ${msg}`);
  }
}

async function runSplitMode(
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
    // Prefer Gemini 2.5 for structuring (same OCR markdown) before giving up —
    // still split-shaped (OCR already done), not a full re-run.
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

export { SUPPORTED_PROVIDERS, SINGLE_PROVIDERS };
