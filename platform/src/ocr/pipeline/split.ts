/**
 * Split OCR mode — Mistral OCR (markdown) then a second LLM call to structure JSON.
 * Single-attempt only. Fallback logic lives in fallbackChain.ts.
 */
import { mistralOcr } from '../providers/mistralOcr.js';
import { llmNormalize } from '../providers/llmNormalize.js';
import type { OcrCostInfo } from '../types/provider.js';
import type { PipelineResult } from '../process.js';

export async function runSplitMode(
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

  console.log(`[OCR] ${contextId} — calling ${structuringProvider} for structuring (model=${structuringModel ?? 'default'})...`);
  const structResult = await llmNormalize(rawOcr, structuringProvider, structuringModel);
  console.log(`[OCR] ${contextId} — ${structuringProvider} structuring done (${structResult.cost.latency_ms}ms, $${structResult.cost.cost_usd.toFixed(4)})`);

  const costInfo: OcrCostInfo = {
    extraction: extractionCost,
    structuring: structResult.cost,
    total_cost_usd: extractionCost.cost_usd + structResult.cost.cost_usd,
    total_tokens: extractionCost.usage.total_tokens + structResult.cost.usage.total_tokens,
    total_input_tokens: extractionCost.usage.prompt_tokens + structResult.cost.usage.prompt_tokens,
    total_output_tokens: extractionCost.usage.completion_tokens + structResult.cost.usage.completion_tokens,
    total_thinking_tokens: (extractionCost.usage.thinking_tokens ?? 0) + (structResult.cost.usage.thinking_tokens ?? 0),
    total_input_cost_usd: extractionCost.input_cost_usd + structResult.cost.input_cost_usd,
    total_output_cost_usd: extractionCost.output_cost_usd + structResult.cost.output_cost_usd,
  };

  return {
    parsed: structResult.parsed,
    rawOcr,
    costInfo,
    providers: { extraction: 'mistral', structuring: structuringProvider, mode: 'split' },
  };
}
