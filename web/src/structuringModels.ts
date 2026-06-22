// Suggested structuring models per provider. Used to populate the model field's
// autocomplete and to auto-correct the model when the provider changes, so a model
// name can't be paired with the wrong provider (e.g. "qwen2.5:3b" sent to Mistral,
// which rejects it with an opaque 400). The field stays free-text — custom local
// Ollama models are still allowed.
export const STRUCTURING_MODEL_SUGGESTIONS: Record<string, string[]> = {
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
export function modelForProvider(provider: string, currentModel: string): string {
  const own = STRUCTURING_MODEL_SUGGESTIONS[provider] ?? [];
  if (own.includes(currentModel)) return currentModel;
  const isForeign = Object.entries(STRUCTURING_MODEL_SUGGESTIONS).some(
    ([p, list]) => p !== provider && list.includes(currentModel),
  );
  if (isForeign || !currentModel) return own[0] ?? currentModel;
  return currentModel;
}
