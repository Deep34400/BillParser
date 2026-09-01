/**
 * Single OCR mode — one multimodal API call (extract + structure together).
 * Single-attempt only. Fallback logic lives in fallbackChain.ts.
 */
import { llmSingle } from '../providers/llmSingle.js';
import type { PipelineResult } from '../process.js';

function toSingleResult(
  r: Awaited<ReturnType<typeof llmSingle>>,
  provider: string,
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
  };
}

export async function runSingleMode(
  buf: Buffer,
  provider: string,
  model: string | undefined,
  contextId: string,
): Promise<PipelineResult> {
  console.log(`[OCR] ${contextId} — single mode using ${provider} (model=${model ?? 'default'})...`);

  const r = await llmSingle(buf, provider, model);
  console.log(
    `[OCR] ${contextId} — ${provider} single done (${r.cost.latency_ms}ms, ` +
    `${r.cost.usage.total_tokens} tokens, $${r.cost.cost_usd.toFixed(4)})`,
  );
  return toSingleResult(r, provider);
}
