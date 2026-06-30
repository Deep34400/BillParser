// Approximate token pricing for the cloud structuring models, USD per 1,000,000 tokens
// as [input, output]. Used to price the structuring (LLM) step from its reported token
// usage. These are estimates and drift over time — adjust as provider pricing changes.
// Local models (Ollama) and anything not listed are treated as free / un-priceable (0).
const PRICING_PER_1M: Record<string, [number, number]> = {
  'mistral-large-latest': [2, 6],
  'mistral-small-latest': [0.2, 0.6],
  'gpt-4o': [2.5, 10],
  'gpt-4o-mini': [0.15, 0.6],
  'claude-sonnet-4-6': [3, 15],
  'gemini-2.5-flash': [0.15, 0.60],
  'gemini-2.5-flash-lite': [0.075, 0.30],
  'gemini-2.5-pro': [1.25, 5.00],
  'gemini-flash-latest': [0.15, 0.60],
};

// USD cost of a structuring call given the model and its input/output token counts.
// Returns 0 for unknown/local models or missing usage, so a missing price never inflates totals.
export function structuringTokenCost(
  model: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number {
  const price = PRICING_PER_1M[model];
  if (!price) return 0;
  const inTok = inputTokens ?? 0;
  const outTok = outputTokens ?? 0;
  return (inTok * price[0] + outTok * price[1]) / 1_000_000;
}
