import type { ExtractionProvider, CanonicalResult } from './types.js';
import { getStructuringModel } from '../structuring/index.js';
import { rasterizePdf } from '../lib/rasterize.js';
import { geminiGenerate } from './clients/gemini.js';
import { stripCodeFences } from './ollama.js';
import { DEFAULT_GEMINI } from '../settings/defaults.js';
import { getSetting } from '../settings/store.js';
import { normalizeGeminiModel } from '../settings/migrate.js';
import { OCR_PROMPT } from '../parsing/prompt.js';
import { isPdf } from '../lib/pdf.js';

/** One Gemini call on the whole PDF — much faster than per-page image OCR. */
async function ocrPdfDirect(
  file: Buffer, apiKey: string, model: string, signal?: AbortSignal,
): Promise<string | null> {
  if (!isPdf(file)) return null;
  try {
    const { text } = await geminiGenerate(
      apiKey, model, OCR_PROMPT,
      [{ inlineData: { data: file.toString('base64'), mimeType: 'application/pdf' } }],
      signal,
      { temperature: 0 },
    );
    const md = stripCodeFences(text);
    return md.length > 50 ? md : null;
  } catch {
    return null;
  }
}

/** Fallback: OCR each rasterized page in parallel (no extra header pass — page 1 has the letterhead). */
async function ocrPdfRasterized(
  file: Buffer, apiKey: string, model: string, signal?: AbortSignal,
): Promise<string> {
  const images = await rasterizePdf(file, { dpi: 120, maxPages: 5 });
  const parts = await Promise.all(
    images.map((img) =>
      geminiGenerate(
        apiKey, model, OCR_PROMPT,
        [{ inlineData: { data: img, mimeType: 'image/png' } }],
        signal,
        { temperature: 0 },
      ).then((r) => stripCodeFences(r.text)),
    ),
  );
  return parts.join('\n\n');
}

export const geminiProvider: ExtractionProvider = {
  name: 'gemini',
  displayName: 'Google Gemini',
  kind: 'markdown',
  requiredCredentials: ['apiKey'],
  isConfigured: (c) => !!c?.apiKey,
  async extract(file, creds, ctx) {
    const signal = ctx.signal;
    const ocrModel = normalizeGeminiModel(await getSetting('extraction_model', DEFAULT_GEMINI.model));
    const apiKey = creds.apiKey;

    // Run OCR and load structuring credentials in parallel.
    const [markdown, structuring] = await Promise.all([
      (async () => {
        const direct = await ocrPdfDirect(file, apiKey, ocrModel, signal);
        if (direct) return direct;
        return ocrPdfRasterized(file, apiKey, ocrModel, signal);
      })(),
      getStructuringModel(),
    ]);

    const fields = await structuring.model.structure(markdown, structuring.creds);
    const out: CanonicalResult = { ...fields, rawText: markdown, rawJson: { ocr: 'gemini', model: ocrModel } };
    return out;
  },
};
