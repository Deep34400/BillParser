/**
 * Gemini normalization — maps raw OCR markdown to ParsedInvoiceData.
 * Uses Google Generative AI SDK.
 */
import { env } from '../config/env.js';
import { STRUCTURING_PROMPT } from '../parsing/prompt.js';
import { structureFromLlmResponse } from '../parsing/index.js';
import type { ParsedInvoiceData } from '../parsing/types.js';
import type { LlmUsage, OcrStepCost } from './types.js';

/** Per-1K token pricing (USD) — Gemini 2.5 Flash. */
const GEMINI_PRICING = { input: 0.00015, output: 0.0006 };

function estimateCostUsd(usage: LlmUsage): number {
  return (
    (usage.prompt_tokens / 1000) * GEMINI_PRICING.input +
    (usage.completion_tokens / 1000) * GEMINI_PRICING.output
  );
}

export interface GeminiNormalizeResult {
  parsed: ParsedInvoiceData;
  cost: OcrStepCost;
}

export async function geminiNormalize(rawOcr: string): Promise<ParsedInvoiceData>;
export async function geminiNormalize(rawOcr: string, returnCost: true): Promise<GeminiNormalizeResult>;
export async function geminiNormalize(rawOcr: string, returnCost?: boolean): Promise<ParsedInvoiceData | GeminiNormalizeResult> {
  const apiKey = env.geminiApiKey;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const model = env.geminiModel;
  const t0 = Date.now();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: `${STRUCTURING_PROMPT}\n\n${rawOcr}` }] },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
      },
    }),
  });

  const latency_ms = Date.now() - t0;

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  };

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) throw new Error('Gemini returned empty response');

  const meta = json.usageMetadata;
  const usage: LlmUsage = {
    prompt_tokens: meta?.promptTokenCount ?? 0,
    completion_tokens: meta?.candidatesTokenCount ?? 0,
    total_tokens: meta?.totalTokenCount ?? 0,
  };

  const cost: OcrStepCost = {
    provider: 'gemini',
    model,
    usage,
    cost_usd: estimateCostUsd(usage),
    latency_ms,
  };

  const structured = structureFromLlmResponse(text, rawOcr);
  if (!structured.parsedData) throw new Error('Gemini returned no parsed_data');

  if (returnCost) return { parsed: structured.parsedData, cost };
  return structured.parsedData;
}
