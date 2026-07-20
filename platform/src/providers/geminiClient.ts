/**
 * Vertex AI Gemini via Application Default Credentials (ADC).
 * On Cloud Run the runtime service account is used automatically.
 * Locally: `gcloud auth application-default login` or GOOGLE_APPLICATION_CREDENTIALS.
 */
import { GoogleAuth } from 'google-auth-library';
import { env } from '../config/env.js';
import type { LlmUsage, OcrStepCost } from './types.js';

/**
 * Per-model $/1K token pricing (converted from ai.google.dev/gemini-api/docs/pricing,
 * checked 2026-07). Only the ≤200k-token input/output tier is used — Pro models charge
 * more above 200k context, which isn't tracked separately here.
 */
const GEMINI_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-3.5-flash': { input: 0.0015, output: 0.009 },
  'gemini-3.1-flash-lite': { input: 0.00025, output: 0.0015 },
  'gemini-3.1-pro-preview': { input: 0.002, output: 0.012 },
  'gemini-3-flash-preview': { input: 0.0005, output: 0.003 },
  'gemini-2.5-pro': { input: 0.00125, output: 0.01 },
  'gemini-2.5-flash': { input: 0.0003, output: 0.0025 },
  'gemini-2.5-flash-lite': { input: 0.0001, output: 0.0004 },
};

/**
 * "-latest" aliases get hot-swapped by Google without notice to the exact underlying
 * model, so there's no fixed price for them. Point at today's newest stable model in
 * each tier — update this mapping when Google promotes a new stable release.
 * Note: only "gemini-flash-latest" actually exists — "gemini-pro-latest" 404s on
 * Vertex (confirmed 2026-07), there's no equivalent alias for Pro yet.
 */
const GEMINI_ALIAS_PRICING: Record<string, string> = {
  'gemini-flash-latest': 'gemini-3.5-flash',
};

const TIMEOUT_MS = 120_000;

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

export function estimateGeminiCostUsd(usage: LlmUsage, model: string): number {
  const resolved = GEMINI_MODEL_PRICING[model] ?? GEMINI_MODEL_PRICING[GEMINI_ALIAS_PRICING[model]];
  if (!resolved) {
    console.warn(`[gemini] no pricing entry for model "${model}" — falling back to gemini-2.5-pro rate (conservative overestimate)`);
  }
  const pricing = resolved ?? GEMINI_MODEL_PRICING['gemini-2.5-pro'];
  return (
    (usage.prompt_tokens / 1000) * pricing.input +
    (usage.completion_tokens / 1000) * pricing.output
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
  const location = env.vertexLocation || 'us-central1';
  // Global endpoint uses aiplatform.googleapis.com (not global-aiplatform.googleapis.com)
  if (location === 'global') {
    return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`;
  }
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
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
 * Always Vertex AI + ADC for Gemini (no API key).
 * Model comes from Settings (singleModel / structuringModel).
 */
export async function geminiGenerateContent(opts: {
  model: string;
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
  /** Ignored — Gemini uses ADC only */
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

  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('ADC failed — no access token for Vertex Gemini. Run: gcloud auth application-default login');
  const url = vertexUrl(opts.model);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${token.token}`,
  };
  // Helps user ADC bill/quota against the correct GCP project
  if (env.projectId) headers['x-goog-user-project'] = env.projectId;
  const authMode = 'adc' as const;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  const latency_ms = Date.now() - t0;

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    const hint = res.status === 403
      ? ' — grant your ADC user roles/aiplatform.user on this GCP project (Vertex AI User)'
      : '';
    throw new Error(`Gemini (${authMode}, model=${opts.model}) HTTP ${res.status}${hint}: ${err.slice(0, 400)}`);
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
    cost_usd: estimateGeminiCostUsd(r.usage, r.model),
    latency_ms: r.latency_ms,
  };
}
