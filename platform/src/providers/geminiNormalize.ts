/**
 * Gemini normalization — maps raw OCR markdown to ParsedInvoiceData.
 * Auth: API key (Settings/env) OR Vertex AI + ADC (Cloud Run service account).
 */
import { STRUCTURING_PROMPT } from '../parsing/prompt.js';
import { structureFromLlmResponse } from '../parsing/index.js';
import type { ParsedInvoiceData } from '../parsing/types.js';
import type { OcrStepCost } from './types.js';
import { resolveProviderKey } from './resolveKey.js';
import { geminiGenerateContent, toGeminiStepCost } from './geminiClient.js';

export interface GeminiNormalizeResult {
  parsed: ParsedInvoiceData;
  cost: OcrStepCost;
}

export async function geminiNormalize(rawOcr: string): Promise<ParsedInvoiceData>;
export async function geminiNormalize(rawOcr: string, returnCost: true): Promise<GeminiNormalizeResult>;
export async function geminiNormalize(rawOcr: string, returnCost?: boolean): Promise<ParsedInvoiceData | GeminiNormalizeResult> {
  const { apiKey, model } = await resolveProviderKey('gemini');

  const r = await geminiGenerateContent({
    model,
    apiKey: apiKey || undefined,
    parts: [{ text: `${STRUCTURING_PROMPT}\n\n${rawOcr}` }],
  });

  const cost = toGeminiStepCost(r);
  const structured = structureFromLlmResponse(r.text, rawOcr);
  if (!structured.parsedData) throw new Error('Gemini returned no parsed_data');

  if (returnCost) return { parsed: structured.parsedData, cost };
  return structured.parsedData;
}
