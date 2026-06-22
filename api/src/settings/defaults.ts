// Out-of-the-box defaults: fully local (Ollama), so the app runs with no cloud API keys.
// Precedence: a saved Setting (changed in the UI) > the matching env var seeded on first
// boot (see seed.ts) > these constants. Switch to a hosted provider any time in Settings.
export const DEFAULTS = {
  extraction_provider: 'ollama',
  structuring_provider: 'ollama',
  structuring_model: 'qwen2.5:3b',
} as const;

// Default Ollama connection seeded so the local provider is "configured" on first boot.
// host.docker.internal reaches the host's Ollama from inside the API container.
export const DEFAULT_OLLAMA = {
  baseUrl: 'http://host.docker.internal:11434',
  model: 'glm-ocr',
} as const;
