/**
 * Generic LLM normalization — model-based, not provider-based.
 * Supports: Gemini, Mistral, Claude (Anthropic), OpenAI/GPT.
 * Each uses its own API format but the same STRUCTURING_PROMPT.
 */
import { STRUCTURING_PROMPT } from '../parsing/prompt.js';
import { structureFromLlmResponse } from '../parsing/index.js';
import type { ParsedInvoiceData } from '../parsing/types.js';
import type { LlmUsage, OcrStepCost } from './types.js';
import { resolveProviderKey } from './resolveKey.js';
import { geminiGenerateContent, toGeminiStepCost } from './geminiClient.js';

interface ModelDef {
  provider: string;
  apiUrl: string | ((model: string, apiKey: string) => string);
  buildBody: (model: string, prompt: string, ocr: string) => unknown;
  buildHeaders: (apiKey: string) => Record<string, string>;
  extractText: (json: any) => string;
  extractUsage: (json: any) => LlmUsage;
  pricing: { input: number; output: number };
}

const PROVIDERS: Record<string, ModelDef> = {
  gemini: {
    provider: 'gemini',
    apiUrl: (model, key) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    buildHeaders: () => ({ 'content-type': 'application/json' }),
    buildBody: (_model, prompt, ocr) => ({
      contents: [{ role: 'user', parts: [{ text: `${prompt}\n\n${ocr}` }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 16384, responseMimeType: 'application/json' },
    }),
    extractText: (j: any) => j.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
    extractUsage: (j: any) => ({
      prompt_tokens: j.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: j.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: j.usageMetadata?.totalTokenCount ?? 0,
    }),
    pricing: { input: 0.00015, output: 0.0006 },
  },
  mistral: {
    provider: 'mistral',
    apiUrl: 'https://api.mistral.ai/v1/chat/completions',
    buildHeaders: (key) => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
    buildBody: (model, prompt, ocr) => ({
      model,
      messages: [{ role: 'system', content: prompt }, { role: 'user', content: ocr }],
      temperature: 0, response_format: { type: 'json_object' }, max_tokens: 16384,
    }),
    extractText: (j: any) => j.choices?.[0]?.message?.content ?? '',
    extractUsage: (j: any) => ({
      prompt_tokens: j.usage?.prompt_tokens ?? 0,
      completion_tokens: j.usage?.completion_tokens ?? 0,
      total_tokens: j.usage?.total_tokens ?? 0,
    }),
    pricing: { input: 0.001, output: 0.003 },
  },
  claude: {
    provider: 'claude',
    apiUrl: 'https://api.anthropic.com/v1/messages',
    buildHeaders: (key) => ({
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    buildBody: (model, prompt, ocr) => ({
      model,
      system: prompt,
      messages: [{ role: 'user', content: ocr }],
      temperature: 0, max_tokens: 16384,
    }),
    extractText: (j: any) => {
      const blocks = j.content ?? [];
      return blocks.map((b: any) => b.text ?? '').join('');
    },
    extractUsage: (j: any) => ({
      prompt_tokens: j.usage?.input_tokens ?? 0,
      completion_tokens: j.usage?.output_tokens ?? 0,
      total_tokens: (j.usage?.input_tokens ?? 0) + (j.usage?.output_tokens ?? 0),
    }),
    pricing: { input: 0.003, output: 0.015 },
  },
  openai: {
    provider: 'openai',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    buildHeaders: (key) => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
    buildBody: (model, prompt, ocr) => ({
      model,
      messages: [{ role: 'system', content: prompt }, { role: 'user', content: ocr }],
      temperature: 0, response_format: { type: 'json_object' }, max_tokens: 16384,
    }),
    extractText: (j: any) => j.choices?.[0]?.message?.content ?? '',
    extractUsage: (j: any) => ({
      prompt_tokens: j.usage?.prompt_tokens ?? 0,
      completion_tokens: j.usage?.completion_tokens ?? 0,
      total_tokens: j.usage?.total_tokens ?? 0,
    }),
    pricing: { input: 0.0025, output: 0.01 },
  },
};

function estimateCost(usage: LlmUsage, pricing: { input: number; output: number }): number {
  return (usage.prompt_tokens / 1000) * pricing.input + (usage.completion_tokens / 1000) * pricing.output;
}

export interface NormalizeResult {
  parsed: ParsedInvoiceData;
  cost: OcrStepCost;
}

/**
 * Normalize raw OCR markdown → ParsedInvoiceData using any supported model.
 * Gemini uses Vertex AI + ADC when no API key is set.
 */
export async function llmNormalize(rawOcr: string, providerName: string, modelOverride?: string): Promise<NormalizeResult> {
  if (providerName === 'gemini') {
    const { apiKey, model } = await resolveProviderKey('gemini', modelOverride);
    const r = await geminiGenerateContent({
      model,
      apiKey: apiKey || undefined,
      parts: [{ text: `${STRUCTURING_PROMPT}\n\n${rawOcr}` }],
    });
    const cost = toGeminiStepCost(r);
    const structured = structureFromLlmResponse(r.text, rawOcr);
    if (!structured.parsedData) throw new Error('gemini returned no parsed_data');
    return { parsed: structured.parsedData, cost };
  }

  const def = PROVIDERS[providerName];
  if (!def) throw new Error(`Unknown structuring provider: ${providerName}. Supported: ${Object.keys(PROVIDERS).join(', ')}`);

  const { apiKey, model } = await resolveProviderKey(providerName, modelOverride);
  const t0 = Date.now();

  const url = typeof def.apiUrl === 'function' ? def.apiUrl(model, apiKey) : def.apiUrl;
  const headers = def.buildHeaders(apiKey);
  const body = def.buildBody(model, STRUCTURING_PROMPT, rawOcr);

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const latency_ms = Date.now() - t0;

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`${providerName} HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  const json = await res.json();
  const text = def.extractText(json);
  if (!text) throw new Error(`${providerName} returned empty response`);

  const usage = def.extractUsage(json);
  const cost: OcrStepCost = {
    provider: providerName,
    model,
    usage,
    cost_usd: estimateCost(usage, def.pricing),
    latency_ms,
  };

  const structured = structureFromLlmResponse(text, rawOcr);
  if (!structured.parsedData) throw new Error(`${providerName} returned no parsed_data`);

  return { parsed: structured.parsedData, cost };
}

/** List of supported providers for the UI. */
export const SUPPORTED_PROVIDERS = Object.keys(PROVIDERS);
