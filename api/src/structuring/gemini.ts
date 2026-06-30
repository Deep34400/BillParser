import { GoogleGenerativeAI } from '@google/generative-ai';
import type { StructuringModel } from './types.js';
import { STRUCTURING_PROMPT } from './types.js';
import { structureFromLlmResponse } from '../parsing/index.js';
import { structuringTokenCost } from './pricing.js';

export const geminiModel = (model: string): StructuringModel => ({
  provider: 'gemini', model,
  async structure(markdown, creds) {
    const genAI = new GoogleGenerativeAI(creds.apiKey);
    const m = genAI.getGenerativeModel({
      model,
      systemInstruction: STRUCTURING_PROMPT,
      generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 16384 },
    });
    const res = await m.generateContent(markdown);
    const text = res.response.text();
    const meta = res.response.usageMetadata;
    const structuringCost = structuringTokenCost(model, meta?.promptTokenCount, meta?.candidatesTokenCount);
    try {
      return structureFromLlmResponse(text, markdown, structuringCost);
    } catch (e) {
      // One retry when JSON is malformed (comma numbers, truncation, etc.)
      const retry = await m.generateContent(
        `${markdown}\n\nYour previous JSON was invalid (${String((e as Error)?.message ?? e)}). ` +
        'Return ONLY valid minified JSON. Numbers must NOT contain commas (use 1823.76 not 1,823.76). No prose.',
      );
      const retryMeta = retry.response.usageMetadata;
      const retryCost = structuringTokenCost(model, retryMeta?.promptTokenCount, retryMeta?.candidatesTokenCount);
      return structureFromLlmResponse(retry.response.text(), markdown, structuringCost + retryCost);
    }
  },
});
