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
    const prompt = `${STRUCTURING_PROMPT}\n\nOCR markdown:\n${markdown}`;
    // Unlike the per-page OCR call, structuring receives every page's markdown at once,
    // which routinely exceeds the 8192 default. If num_ctx is too small Ollama silently
    // truncates the input — the model then "structures" a fragment and returns empty
    // fields with no error. Size the window to the full prompt (dense numeric invoice
    // text tokenizes ~2 chars/token) plus headroom for the JSON output, capped to keep
    // the KV cache bounded.
    const numCtx = Math.min(32_768, Math.max(8192, Math.ceil(prompt.length / 2) + 4096));
    // temperature 0 (greedy) makes structuring deterministic — at the default 0.8 the same
    // OCR markdown yields wildly different results run-to-run (e.g. 0 vs 10 line items).
    const { content } = await ollamaChat(baseUrl, useModel, prompt, { json: true, numCtx, temperature: 0 });
    return normalizeStructured(content);
  },
});
