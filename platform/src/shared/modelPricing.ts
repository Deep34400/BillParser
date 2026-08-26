/**
 * Default model pricing — $/1M tokens (input & output).
 * Source: https://ai.google.dev/gemini-api/docs/pricing (checked Aug 2026)
 *
 * Stored as per-1M-token USD price for clarity. Internally converted to per-1K
 * when needed (÷1000). UI shows per-1M for readability.
 *
 * Users can override any model's pricing via Settings UI; overrides are
 * persisted in Postgres. Defaults here are used when no override exists.
 */

export interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
  /**
   * Some models charge more once the prompt exceeds a threshold (Google's is
   * 200k tokens). Omitted = flat pricing at any size.
   */
  longContext?: {
    thresholdTokens: number;
    inputPer1M: number;
    outputPer1M: number;
  };
}

export const DEFAULT_MODEL_PRICING: Record<string, ModelPrice> = {
  // ─── Gemini 3.x ──────────────────────────────────────────────
  // ⚠️ 3.7/3.6-flash introductory pricing ends 2026-12-31; from 2027-01-01 the
  // rates double to 1.50 / 7.50. Update here or costs silently halve.
  'gemini-3.7-flash':        { inputPer1M: 0.75,  outputPer1M: 3.75 },
  'gemini-3.6-flash':        { inputPer1M: 0.75,  outputPer1M: 3.75 },
  'gemini-3.5-flash':        { inputPer1M: 1.50,  outputPer1M: 9.00 },
  'gemini-3.5-flash-lite':   { inputPer1M: 0.30,  outputPer1M: 2.50 },
  'gemini-3.1-pro-preview':  { inputPer1M: 2.00,  outputPer1M: 12.00,
    longContext: { thresholdTokens: 200_000, inputPer1M: 4.00, outputPer1M: 18.00 } },

  // ─── Gemini 2.5 ──────────────────────────────────────────────
  'gemini-2.5-pro':          { inputPer1M: 1.25,  outputPer1M: 10.00,
    longContext: { thresholdTokens: 200_000, inputPer1M: 2.50, outputPer1M: 15.00 } },
  'gemini-2.5-flash':        { inputPer1M: 0.30,  outputPer1M: 2.50 },
  'gemini-2.5-flash-lite':   { inputPer1M: 0.10,  outputPer1M: 0.40 },

  // ─── Claude ──────────────────────────────────────────────────
  'claude-sonnet-4-20250514':    { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-3-5-sonnet-20241022':  { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-3-haiku-20240307':     { inputPer1M: 0.25,  outputPer1M: 1.25 },

  // ─── OpenAI ──────────────────────────────────────────────────
  'gpt-4o':       { inputPer1M: 2.50,  outputPer1M: 10.00 },
  'gpt-4o-mini':  { inputPer1M: 0.15,  outputPer1M: 0.60 },
  'gpt-4-turbo':  { inputPer1M: 10.00, outputPer1M: 30.00 },

  // ─── Mistral ─────────────────────────────────────────────────
  'mistral-small-latest':   { inputPer1M: 1.00, outputPer1M: 3.00 },
  'mistral-medium-latest':  { inputPer1M: 2.70, outputPer1M: 8.10 },
  'mistral-large-latest':   { inputPer1M: 2.00, outputPer1M: 6.00 },
  'pixtral-12b-2409':       { inputPer1M: 1.00, outputPer1M: 3.00 },
  'mistral-ocr-latest':     { inputPer1M: 2.00, outputPer1M: 0.00 },
};

// Deliberately empty. A floating alias like "gemini-flash-latest" cannot be
// priced honestly — Google can repoint it at a model with different rates and the
// cost figures would be silently wrong. Pin an explicit model instead.
const MODEL_ALIASES: Record<string, string> = {};

/**
 * Resolve per-1K-token prices for a model.
 *
 * `promptTokens` selects the long-context tier where a model has one — Google
 * charges roughly double above 200k prompt tokens on the Pro models. Omitting it
 * keeps the base rate, which is correct for anything under the threshold but will
 * understate a very large prompt.
 */
export function resolveModelPricing(
  model: string,
  userOverrides?: Record<string, ModelPrice> | null,
  promptTokens?: number,
): { input: number; output: number } {
  const key = MODEL_ALIASES[model] ?? model;
  const price =
    userOverrides?.[model]
    ?? userOverrides?.[key]
    ?? DEFAULT_MODEL_PRICING[key]
    ?? DEFAULT_MODEL_PRICING[model]
    // Unknown model: fall back to the priciest Gemini so cost is over- rather
    // than under-stated. Add the model above to make this exact.
    ?? DEFAULT_MODEL_PRICING['gemini-2.5-pro'];

  const tier =
    price.longContext && promptTokens != null && promptTokens > price.longContext.thresholdTokens
      ? price.longContext
      : price;

  return { input: tier.inputPer1M / 1000, output: tier.outputPer1M / 1000 };
}

/** Token counts a cost is computed from. Matches LlmUsage's billing-relevant fields. */
export interface CostableUsage {
  prompt_tokens: number;
  completion_tokens: number;
  thinking_tokens?: number;
}

export interface LlmCost {
  cost_usd: number;
  input_cost_usd: number;
  output_cost_usd: number;
  /** Rates actually applied, so the figure stays reproducible after a price edit. */
  input_rate_per_1m: number;
  output_rate_per_1m: number;
}

/**
 * The single implementation of the billing rule. Every provider path must use
 * this — it previously lived in three places (geminiClient, llmSingle,
 * llmNormalize) and they had already drifted: only two applied the long-context
 * tier, so large prompts were billed at the small-prompt rate.
 *
 * Two rules that are easy to get wrong:
 *  - Thinking tokens bill at the OUTPUT rate (Google counts them as output).
 *  - Prompt size selects the pricing tier on models that have one.
 */
export function computeLlmCost(
  usage: CostableUsage,
  model: string,
  overrides?: Record<string, ModelPrice> | null,
): LlmCost {
  const p = resolveModelPricing(model, overrides, usage.prompt_tokens);
  const input_cost_usd = (usage.prompt_tokens / 1000) * p.input;
  const billedOutput = usage.completion_tokens + (usage.thinking_tokens ?? 0);
  const output_cost_usd = (billedOutput / 1000) * p.output;
  return {
    cost_usd: input_cost_usd + output_cost_usd,
    input_cost_usd,
    output_cost_usd,
    input_rate_per_1m: p.input * 1000,
    output_rate_per_1m: p.output * 1000,
  };
}
