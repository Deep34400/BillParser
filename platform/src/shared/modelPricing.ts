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
  // Not on Google's public pricing page as of Aug 2026 — rates unverified.
  'gemini-3.1-flash-lite':   { inputPer1M: 0.25,  outputPer1M: 1.50 },
  'gemini-3.1-pro-preview':  { inputPer1M: 2.00,  outputPer1M: 12.00,
    longContext: { thresholdTokens: 200_000, inputPer1M: 4.00, outputPer1M: 18.00 } },
  // Not on Google's public pricing page as of Aug 2026 — rates unverified.
  'gemini-3-flash-preview':  { inputPer1M: 0.50,  outputPer1M: 3.00 },

  // ─── Gemini 2.5 ──────────────────────────────────────────────
  'gemini-2.5-pro':          { inputPer1M: 1.25,  outputPer1M: 10.00,
    longContext: { thresholdTokens: 200_000, inputPer1M: 2.50, outputPer1M: 15.00 } },
  'gemini-2.5-flash':        { inputPer1M: 0.30,  outputPer1M: 2.50 },
  'gemini-2.5-flash-lite':   { inputPer1M: 0.10,  outputPer1M: 0.40 },

  // ─── Gemini aliases ──────────────────────────────────────────
  'gemini-flash-latest':     { inputPer1M: 1.50,  outputPer1M: 9.00 },

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

/**
 * Resolve pricing for a model — user overrides take priority over defaults.
 * Returns per-1K-token prices (for cost calc: tokens/1000 × rate).
 *
 * Alias: gemini-flash-latest → gemini-3.5-flash rates.
 */
const MODEL_ALIASES: Record<string, string> = {
  'gemini-flash-latest': 'gemini-3.5-flash',
};

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
