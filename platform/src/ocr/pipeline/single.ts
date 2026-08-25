/**
 * Single OCR mode — one multimodal API call (extract + structure together).
 * On failure → gemini-2.5-flash single retry (never falls back to split).
 */
import { llmSingle } from '../providers/llmSingle.js';
import type { PipelineResult } from '../process.js';

export const GEMINI_SINGLE_FALLBACK_MODEL = 'gemini-2.5-flash';

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
      total_input_tokens: r.cost.usage.prompt_tokens,
      total_output_tokens: r.cost.usage.completion_tokens,
      total_thinking_tokens: r.cost.usage.thinking_tokens ?? 0,
      total_input_cost_usd: r.cost.input_cost_usd,
      total_output_cost_usd: r.cost.output_cost_usd,
    },
    providers: { extraction: provider, structuring: provider, mode: 'single' },
    fallbackReason,
  };
}

export async function runSingleMode(
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
