/**
 * Vertex AI Gemini via Application Default Credentials (ADC).
 * On Cloud Run the runtime service account is used automatically.
 * Locally: `gcloud auth application-default login` or GOOGLE_APPLICATION_CREDENTIALS.
 */
import { GoogleAuth } from 'google-auth-library';
import { env } from '../config/env.js';
import type { LlmUsage, OcrStepCost } from './types.js';

const GEMINI_PRICING = { input: 0.00015, output: 0.0006 };

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

export function estimateGeminiCostUsd(usage: LlmUsage): number {
  return (
    (usage.prompt_tokens / 1000) * GEMINI_PRICING.input +
    (usage.completion_tokens / 1000) * GEMINI_PRICING.output
  );
}

export interface GeminiGenerateResult {
  text: string;
  usage: LlmUsage;
  latency_ms: number;
  model: string;
  authMode: 'api_key' | 'adc';
}

function vertexUrl(model: string): string {
  const project = env.projectId;
  const location = env.vertexLocation;
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

function aiStudioUrl(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

function parseGeminiResponse(json: any): { text: string; usage: LlmUsage } {
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const meta = json.usageMetadata;
  const usage: LlmUsage = {
    prompt_tokens: meta?.promptTokenCount ?? 0,
    completion_tokens: meta?.candidatesTokenCount ?? 0,
    total_tokens: meta?.totalTokenCount ?? 0,
  };
  return { text, usage };
}

/**
 * Prefer API key when provided (local/dev Settings).
 * Otherwise use Vertex AI + ADC (production Cloud Run).
 */
export async function geminiGenerateContent(opts: {
  model: string;
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
  apiKey?: string;
}): Promise<GeminiGenerateResult> {
  const t0 = Date.now();
  const body = {
    contents: [{ role: 'user', parts: opts.parts.map((p) => {
      if (p.inlineData) {
        return { inline_data: { mime_type: p.inlineData.mimeType, data: p.inlineData.data } };
      }
      return { text: p.text ?? '' };
    }) }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
    },
  };

  let url: string;
  let headers: Record<string, string>;
  let authMode: 'api_key' | 'adc';

  if (opts.apiKey) {
    url = aiStudioUrl(opts.model, opts.apiKey);
    headers = { 'content-type': 'application/json' };
    authMode = 'api_key';
  } else {
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) throw new Error('ADC failed — no access token for Vertex Gemini');
    url = vertexUrl(opts.model);
    headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${token.token}`,
    };
    authMode = 'adc';
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const latency_ms = Date.now() - t0;

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini (${authMode}) HTTP ${res.status}: ${err.slice(0, 300)}`);
  }

  const json = await res.json();
  const { text, usage } = parseGeminiResponse(json);
  if (!text) throw new Error(`Gemini (${authMode}) returned empty response`);

  return { text, usage, latency_ms, model: opts.model, authMode };
}

export function toGeminiStepCost(r: GeminiGenerateResult): OcrStepCost {
  return {
    provider: 'gemini',
    model: r.model,
    usage: r.usage,
    cost_usd: estimateGeminiCostUsd(r.usage),
    latency_ms: r.latency_ms,
  };
}
