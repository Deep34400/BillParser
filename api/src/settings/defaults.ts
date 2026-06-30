// Out-of-the-box defaults: Google Gemini (API key in Settings). Ollama remains available
// for fully local runs. Precedence: saved Setting > env var seeded on first boot > here.
export const DEFAULTS = {
  // Mistral OCR = one API call; Gemini only for JSON structuring (faster than multi-page Gemini OCR).
  extraction_provider: 'mistral',
  structuring_provider: 'gemini',
  structuring_model: 'gemini-2.5-flash',
} as const;

export const DEFAULT_GEMINI = {
  model: 'gemini-2.5-flash',
} as const;

// Default Ollama connection seeded so the local provider is "configured" on first boot.
// host.docker.internal reaches the host's Ollama from inside the API container.
export const DEFAULT_OLLAMA = {
  baseUrl: 'http://host.docker.internal:11434',
  model: 'glm-ocr',
} as const;
