// Suggested structuring models per provider. Used to populate the model field's
// autocomplete and to auto-correct the model when the provider changes, so a model
// name can't be paired with the wrong provider (e.g. "qwen2.5:3b" sent to Mistral,
// which rejects it with an opaque 400). The field stays free-text — custom local
// Ollama models are still allowed.
export const STRUCTURING_MODEL_SUGGESTIONS: Record<string, string[]> = {
  gemini: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-flash-latest'],
  anthropic: ['claude-sonnet-4-6'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  mistral: ['mistral-large-latest', 'mistral-small-latest'],
  ollama: ['qwen2.5:3b', 'qwen2.5:7b'],
};

// Decide which model to use when the structuring provider changes:
// - keep it if it's already a known model for the new provider;
// - reset to the provider's default if it's empty or clearly a *different* provider's
//   model (the mismatch we want to prevent);
// - otherwise leave an unknown/custom string alone (it may be a valid custom model).
export function normalizeGeminiModel(model: string): string {
  const deprecated = new Set([
    'gemini-2.0-flash', 'gemini-2.0-flash-lite',
    'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash-8b',
  ]);
  return deprecated.has(model) ? 'gemini-2.5-flash' : model;
}

export function modelForProvider(provider: string, currentModel: string): string {
  const normalized = provider === 'gemini' ? normalizeGeminiModel(currentModel) : currentModel;
  const own = STRUCTURING_MODEL_SUGGESTIONS[provider] ?? [];
  if (own.includes(normalized)) return normalized;
  const isForeign = Object.entries(STRUCTURING_MODEL_SUGGESTIONS).some(
    ([p, list]) => p !== provider && list.includes(normalized),
  );
  if (isForeign || !normalized) return own[0] ?? normalized;
  return normalized;
}
