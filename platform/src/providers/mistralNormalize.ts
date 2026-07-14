/**
 * Mistral normalization — maps raw OCR markdown to ParsedInvoiceData.
 * Uses Mistral chat completion API.
 */
import { env } from '../config/env.js';
import { STRUCTURING_PROMPT } from '../parsing/prompt.js';
import { structureFromLlmResponse } from '../parsing/index.js';
import type { ParsedInvoiceData } from '../parsing/types.js';
import type { LlmUsage, OcrStepCost } from './types.js';

const MISTRAL_CHAT_URL = 'https://api.mistral.ai/v1/chat/completions';

/** Per-1K token pricing (USD) — Mistral Small. */
const MISTRAL_PRICING = { input: 0.001, output: 0.003 };

function estimateCostUsd(usage: LlmUsage): number {
  return (
    (usage.prompt_tokens / 1000) * MISTRAL_PRICING.input +
    (usage.completion_tokens / 1000) * MISTRAL_PRICING.output
  );
}

export interface MistralNormalizeResult {
  parsed: ParsedInvoiceData;
  cost: OcrStepCost;
}

export async function mistralNormalize(rawOcr: string): Promise<ParsedInvoiceData>;
export async function mistralNormalize(rawOcr: string, returnCost: true): Promise<MistralNormalizeResult>;
export async function mistralNormalize(rawOcr: string, returnCost?: boolean): Promise<ParsedInvoiceData | MistralNormalizeResult> {
  const apiKey = env.mistralApiKey;
  if (!apiKey) throw new Error('MISTRAL_API_KEY is not set');

  const model = env.mistralModel;
  const t0 = Date.now();
  let totalUsage: LlmUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  const res = await fetch(MISTRAL_CHAT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: STRUCTURING_PROMPT },
        { role: 'user', content: rawOcr },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 16384,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Mistral normalize HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  const json = await res.json() as {
    choices?: { message?: { content?: string } }[];
    usage?: LlmUsage;
  };

  if (json.usage) {
    totalUsage.prompt_tokens += json.usage.prompt_tokens;
    totalUsage.completion_tokens += json.usage.completion_tokens;
    totalUsage.total_tokens += json.usage.total_tokens;
  }

  const text = json.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Mistral returned empty response');

  try {
    const structured = structureFromLlmResponse(text, rawOcr);
    if (!structured.parsedData) throw new Error('No parsed_data in Mistral response');

    const latency_ms = Date.now() - t0;
    const cost: OcrStepCost = { provider: 'mistral', model, usage: totalUsage, cost_usd: estimateCostUsd(totalUsage), latency_ms };

    if (returnCost) return { parsed: structured.parsedData, cost };
    return structured.parsedData;
  } catch (e) {
    const retryRes = await fetch(MISTRAL_CHAT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: STRUCTURING_PROMPT },
          { role: 'user', content: rawOcr },
          { role: 'assistant', content: text },
          {
            role: 'user',
            content: `Your JSON was invalid (${(e as Error)?.message ?? e}). Return ONLY valid minified JSON. Numbers must NOT contain commas. No prose.`,
          },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
        max_tokens: 16384,
      }),
    });

    if (!retryRes.ok) throw new Error(`Mistral retry HTTP ${retryRes.status}`);
    const retryJson = await retryRes.json() as typeof json;

    if (retryJson.usage) {
      totalUsage.prompt_tokens += retryJson.usage.prompt_tokens;
      totalUsage.completion_tokens += retryJson.usage.completion_tokens;
      totalUsage.total_tokens += retryJson.usage.total_tokens;
    }

    const retryText = retryJson.choices?.[0]?.message?.content ?? '';
    const structured = structureFromLlmResponse(retryText, rawOcr);
    if (!structured.parsedData) throw new Error('Mistral retry returned no parsed_data');

    const latency_ms = Date.now() - t0;
    const cost: OcrStepCost = { provider: 'mistral', model, usage: totalUsage, cost_usd: estimateCostUsd(totalUsage), latency_ms };

    if (returnCost) return { parsed: structured.parsedData, cost };
    return structured.parsedData;
  }
}
