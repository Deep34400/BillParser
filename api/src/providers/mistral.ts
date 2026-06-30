import type { ExtractionProvider, CanonicalResult } from './types.js';
import { getStructuringModel } from '../structuring/index.js';
import { httpErrorBody } from '../lib/http.js';
import { getCredentials, getSetting } from '../settings/store.js';
import { DEFAULT_GEMINI } from '../settings/defaults.js';
import { normalizeGeminiModel } from '../settings/migrate.js';
import { geminiProvider } from './gemini.js';
import { footerMissingInMarkdown } from '../billing/footerExtract.js';
import { geminiFooterSupplement } from '../billing/footerSupplement.js';

export const mistralProvider: ExtractionProvider = {
  name: 'mistral', displayName: 'Mistral OCR', kind: 'markdown',
  requiredCredentials: ['apiKey'],
  isConfigured: (c) => !!c?.apiKey,
  async extract(file, creds, ctx) {
    const [ocrRes, structuring] = await Promise.all([
      fetch('https://api.mistral.ai/v1/ocr', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${creds.apiKey}` },
        body: JSON.stringify({
          model: 'mistral-ocr-latest',
          document: { type: 'document_url', document_url: `data:application/pdf;base64,${file.toString('base64')}` },
        }),
        signal: ctx?.signal,
      }),
      getStructuringModel(),
    ]);
    if (!ocrRes.ok) throw new Error(`Mistral OCR HTTP ${ocrRes.status}${await httpErrorBody(ocrRes)}`);
    const ocr: any = await ocrRes.json();
    let markdown = (ocr.pages ?? []).map((p: any) => p.markdown ?? '').join('\n\n');

    // Mistral often skips the SUMMARY footer — recover it with a focused Gemini PDF pass.
    if (footerMissingInMarkdown(markdown)) {
      try {
        const geminiCreds = await getCredentials('gemini');
        if (geminiProvider.isConfigured(geminiCreds)) {
          const ocrModel = normalizeGeminiModel(await getSetting('extraction_model', DEFAULT_GEMINI.model));
          const supplement = await geminiFooterSupplement(file, geminiCreds!.apiKey, ocrModel, ctx?.signal);
          if (supplement) {
            markdown = `${markdown}\n\n## Bill Summary\n\n${supplement}`;
          }
        }
      } catch {
        /* optional footer supplement */
      }
    }

    const fields = await structuring.model.structure(markdown, structuring.creds);
    const out: CanonicalResult = { ...fields, rawText: markdown, rawJson: ocr };
    return out;
  },
};
