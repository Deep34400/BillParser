/**
 * Vertex AI Gemini via Application Default Credentials (ADC).
 * On Cloud Run the runtime service account is used automatically.
 * Locally: `gcloud auth application-default login` or GOOGLE_APPLICATION_CREDENTIALS.
 */
import { GoogleAuth } from 'google-auth-library';
import { env } from '../../config/env.js';
import type { LlmUsage, OcrStepCost } from '../types/provider.js';

/**
 * Per-model $/1K token pricing (converted from ai.google.dev/gemini-api/docs/pricing,
 * checked 2026-07). Only the ≤200k-token input/output tier is used — Pro models charge
 * more above 200k context, which isn't tracked separately here.
 */
const GEMINI_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-3.5-flash':       { input: 0.0015,  output: 0.009  },
  'gemini-3.1-flash-lite':  { input: 0.00025, output: 0.0015 },
  'gemini-3.1-pro-preview': { input: 0.002,   output: 0.012  },
  'gemini-3-flash-preview': { input: 0.0005,  output: 0.003  },
  'gemini-2.5-pro':         { input: 0.00125, output: 0.01   },
  'gemini-2.5-flash':       { input: 0.0003,  output: 0.0025 },
  'gemini-2.5-flash-lite':  { input: 0.0001,  output: 0.0004 },
};

/**
 * "-latest" aliases get hot-swapped by Google without notice.
 * Map to the newest stable model in each tier (update when Google promotes a new release).
 */
const GEMINI_ALIAS_PRICING: Record<string, string> = {
  'gemini-flash-latest': 'gemini-3.5-flash',
};

const TIMEOUT_MS = 120_000;

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

export function geminiPricing(model: string): { input: number; output: number } {
  const resolved = GEMINI_MODEL_PRICING[model] ?? GEMINI_MODEL_PRICING[GEMINI_ALIAS_PRICING[model]];
  if (!resolved) {
    console.warn(`[gemini] no pricing entry for model "${model}" — falling back to gemini-2.5-pro rate (conservative overestimate)`);
  }
  return resolved ?? GEMINI_MODEL_PRICING['gemini-2.5-pro'];
}

export function estimateGeminiCostUsd(usage: LlmUsage, model: string): number {
  const p = geminiPricing(model);
  return (
    (usage.prompt_tokens / 1000) * p.input +
    (usage.completion_tokens / 1000) * p.output
  );
}

export interface GeminiGenerateResult {
  text: string;
  usage: LlmUsage;
  latency_ms: number;
  model: string;
  authMode: 'api_key' | 'adc';
}

/**
 * ALL Gemini models use the Vertex **global** endpoint + ADC.
 * Regional us-central1 returns 404 for Gemini 3.x; using global for 2.5 as well
 * keeps one consistent path and higher availability.
 */
export function resolveGeminiVertexLocation(_model: string): string {
  return 'global';
}

function vertexUrl(model: string): string {
  const project = env.projectId;
  const location = resolveGeminiVertexLocation(model);
  // Global endpoint uses aiplatform.googleapis.com (not global-aiplatform.googleapis.com)
  if (location === 'global') {
    return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`;
  }
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

function parseGeminiResponse(json: any): { text: string; usage: LlmUsage } {
  const text = extractGeminiText(json);
  const meta = json.usageMetadata;
  const usage: LlmUsage = {
    prompt_tokens: meta?.promptTokenCount ?? 0,
    completion_tokens: meta?.candidatesTokenCount ?? 0,
    total_tokens: meta?.totalTokenCount ?? 0,
  };
  return { text, usage };
}

/**
 * Gemini 3.x thinking models put reasoning in parts with `thought: true`
 * (or as the first part). We must skip thoughts and pick the JSON answer.
 */
export function extractGeminiText(json: any): string {
  const parts: Array<{ text?: string; thought?: boolean }> =
    json?.candidates?.[0]?.content?.parts ?? [];
  const answerParts: string[] = [];
  const allParts: string[] = [];
  for (const p of parts) {
    if (!p?.text) continue;
    allParts.push(p.text);
    if (p.thought === true) continue;
    answerParts.push(p.text);
  }
  const candidates = answerParts.length > 0 ? answerParts : allParts;
  if (candidates.length === 0) return '';
  // Prefer a part that looks like invoice JSON
  const jsonish = candidates.find((t) => {
    const s = t.trim();
    return (
      s.startsWith('{') ||
      s.startsWith('[') ||
      s.includes('"parsed_data"') ||
      s.includes('"company_name"') ||
      s.includes('"output"')
    );
  });
  return (jsonish ?? candidates.join('\n')).trim();
}

function isGemini3Family(model: string): boolean {
  return /^gemini-3/i.test(model) || /^gemini-(flash|pro)-latest$/i.test(model);
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
  const gemini3 = isGemini3Family(opts.model);
  const generationConfig: Record<string, unknown> = {
    temperature: 0,
    // Thinking models consume output budget for reasoning — give headroom for the JSON.
    maxOutputTokens: gemini3 ? 65536 : 16384,
    responseMimeType: 'application/json',
  };
  // Keep thinking minimal so the JSON answer isn't truncated / buried in thought parts.
  if (gemini3) {
    generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
  }

  const body = {
    contents: [{ role: 'user', parts: opts.parts.map((p) => {
      if (p.inlineData) {
        return { inline_data: { mime_type: p.inlineData.mimeType, data: p.inlineData.data } };
      }
      return { text: p.text ?? '' };
    }) }],
    generationConfig,
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
    let hint = '';
    if (res.status === 403) {
      hint = ' — grant your ADC user roles/aiplatform.user on this GCP project (Vertex AI User)';
    } else if (res.status === 404 && /^gemini-3/i.test(opts.model)) {
      hint = ' — Gemini 3.x models require the Vertex global endpoint (auto-routed); check model ID spelling and project access';
    }
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
