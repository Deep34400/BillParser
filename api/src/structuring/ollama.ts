import type { StructuringModel } from './types.js';
import { STRUCTURING_PROMPT } from './types.js';
import { normalizeStructured } from './index.js';
import { ollamaChat } from '../lib/ollama.js';

const DEFAULT_BASE_URL = 'http://host.docker.internal:11434';

// Local structuring via Ollama. Reuses the shared STRUCTURING_PROMPT and normalizer.
// Prefers the model from the saved Ollama credentials, falling back to the configured
// structuring_model setting passed in by the factory.
export const ollamaStructModel = (model: string): StructuringModel => ({
  provider: 'ollama',
  model,
  async structure(markdown, creds) {
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;
    // The structuring model is the configured structuring_model, independent of the OCR
    // provider's model: glm-ocr does OCR; a general LLM (local Ollama model or cloud) does
    // structuring. We never fall back to the OCR provider's vision model here — it cannot
    // follow text instructions, so sending structuring to it produces garbage.
    const useModel = model;
    const { content } = await ollamaChat(
      baseUrl,
      useModel,
      `${STRUCTURING_PROMPT}\n\nOCR markdown:\n${markdown}`,
      { json: true },
    );
    return normalizeStructured(content);
  },
});
