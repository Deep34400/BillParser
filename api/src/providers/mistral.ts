import type { ExtractionProvider, CanonicalResult } from './types.js';
import { getStructuringModel } from '../structuring/index.js';
import { httpErrorBody } from '../lib/http.js';

export const mistralProvider: ExtractionProvider = {
  name: 'mistral', displayName: 'Mistral OCR', kind: 'markdown',
  requiredCredentials: ['apiKey'],
  isConfigured: (c) => !!c?.apiKey,
  async extract(file, creds) {
    const res = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${creds.apiKey}` },
      body: JSON.stringify({
        model: 'mistral-ocr-latest',
        document: { type: 'document_url', document_url: `data:application/pdf;base64,${file.toString('base64')}` },
      }),
    });
    if (!res.ok) throw new Error(`Mistral OCR HTTP ${res.status}${await httpErrorBody(res)}`);
    const ocr: any = await res.json();
    const markdown = (ocr.pages ?? []).map((p: any) => p.markdown ?? '').join('\n\n');
    const { model, creds: sCreds } = await getStructuringModel();
    const fields = await model.structure(markdown, sCreds);
    const out: CanonicalResult = { ...fields, rawText: markdown, rawJson: ocr };
    return out;
  },
};
