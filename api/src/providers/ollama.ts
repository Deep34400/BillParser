import type { ExtractionProvider, CanonicalResult } from './types.js';
import { getStructuringModel } from '../structuring/index.js';
import { rasterizePdf } from '../lib/rasterize.js';
import { ollamaChat } from '../lib/ollama.js';

const OCR_PROMPT =
  'You are an OCR engine. Transcribe this invoice image to clean GitHub-flavored Markdown. ' +
  'Preserve every line-item table row, number, date, and label exactly as printed. ' +
  'Output only the transcription — no commentary, no code fences.';

export const ollamaProvider: ExtractionProvider = {
  name: 'ollama',
  displayName: 'GLM-OCR (Ollama)',
  kind: 'markdown',
  requiredCredentials: ['baseUrl', 'model'],
  isConfigured: (c) => !!c?.baseUrl && !!c?.model,
  async extract(file, creds) {
    const images = await rasterizePdf(file);
    // OCR one page per request; a single multi-image message can cause local vision
    // models to transcribe only the first image, silently dropping later pages.
    const parts: string[] = [];
    const raws: unknown[] = [];
    for (const img of images) {
      const { content, raw } = await ollamaChat(creds.baseUrl, creds.model, OCR_PROMPT, { images: [img] });
      parts.push(content);
      raws.push(raw);
    }
    const markdown = parts.join('\n\n');
    const { model, creds: sCreds } = await getStructuringModel();
    const fields = await model.structure(markdown, sCreds);
    const out: CanonicalResult = { ...fields, rawText: markdown, rawJson: { pages: raws } };
    return out;
  },
};
