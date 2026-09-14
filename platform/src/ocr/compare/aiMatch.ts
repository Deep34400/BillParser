/**
 * Compare AI — Gemini by default (Settings → Compare model).
 * Step 1: leftover name pairing. Step 2: a separate summary prompt.
 * Keys: Gemini uses Vertex ADC. OpenAI / Mistral need Settings credentials.
 */
import { getSettings } from '../../shared/settings.js';
import { resolveProviderKey } from '../providers/resolveKey.js';
import { geminiGenerateContent } from '../providers/geminiClient.js';

export interface AiNamePair {
  group: 'parts' | 'labour';
  a: number;
  b: number;
  confidence: number;
}

export interface CompareModelInfo {
  provider: string;
  model: string;
  used: boolean;
  error?: string;
}

export function parsePairs(text: string, group: 'parts' | 'labour', leftLen: number, rightLen: number): AiNamePair[] {
  const jsonStart = text.indexOf('[');
  const jsonEnd = text.lastIndexOf(']');
  if (jsonStart < 0 || jsonEnd <= jsonStart) return [];
  try {
    const rows = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Array<{ a?: number; b?: number; same?: boolean; confidence?: number }>;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r) => r.same && typeof r.a === 'number' && typeof r.b === 'number')
      .map((r) => ({
        group,
        a: r.a as number,
        b: r.b as number,
        confidence: typeof r.confidence === 'number' ? r.confidence : 0.7,
      }))
      .filter((r) => r.a >= 0 && r.b >= 0 && r.a < leftLen && r.b < rightLen && r.confidence >= 0.6);
  } catch {
    return [];
  }
}

async function askOpenAiCompatible(provider: 'openai' | 'mistral', model: string, prompt: string): Promise<string | null> {
  const resolved = await resolveProviderKey(provider, model);
  if (!resolved.apiKey) return null;
  const url = provider === 'mistral'
    ? 'https://api.mistral.ai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${resolved.apiKey}`,
    },
    body: JSON.stringify({
      model: resolved.model || model,
      temperature: 0,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) return null;
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? null;
}

export async function resolveCompareModel(override?: { provider?: string; model?: string }): Promise<CompareModelInfo> {
  const settings = await getSettings();
  return {
    provider: override?.provider || settings.compareProvider || 'gemini',
    model: override?.model || settings.compareModel || 'gemini-2.5-flash',
    used: false,
  };
}

export async function askCompareModel(
  prompt: string,
  info: CompareModelInfo,
): Promise<{ text: string | null; info: CompareModelInfo }> {
  try {
    if (info.provider === 'gemini') {
      const result = await geminiGenerateContent({
        model: info.model,
        parts: [{ text: prompt }],
      });
      return { text: result.text, info: { ...info, used: true, model: result.model } };
    }
    if (info.provider === 'openai' || info.provider === 'mistral') {
      const text = await askOpenAiCompatible(info.provider, info.model, prompt);
      return { text, info: { ...info, used: Boolean(text) } };
    }
    return { text: null, info: { ...info, error: `Unsupported compare provider ${info.provider}` } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Compare model failed';
    return { text: null, info: { ...info, used: false, error: message } };
  }
}

function matchPrompt(left: string[], right: string[]): string {
  return [
    'You pair leftover invoice line names. Same part can have different wording',
    '(brake pad vs pads, oil filter vs filter oil).',
    'Return ONLY JSON: {"pairs":[{"a":0,"b":1,"same":true,"confidence":0.86}]}',
    'a is index in list A, b is index in list B. Use each index at most once.',
    'If unsure, omit the pair. Do not invent names.',
    `A: ${JSON.stringify(left)}`,
    `B: ${JSON.stringify(right)}`,
  ].join('\n');
}

export async function aiMatchLeftovers(
  group: 'parts' | 'labour',
  left: string[],
  right: string[],
  info: CompareModelInfo,
): Promise<{ pairs: AiNamePair[]; info: CompareModelInfo }> {
  if (left.length === 0 || right.length === 0) return { pairs: [], info };
  const { text, info: next } = await askCompareModel(matchPrompt(left, right), info);
  if (!text) return { pairs: [], info: next };
  let raw = text;
  try {
    const obj = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? 'null') as { pairs?: unknown } | null;
    if (obj && Array.isArray(obj.pairs)) raw = JSON.stringify(obj.pairs);
  } catch {
    /* use raw text */
  }
  return { pairs: parsePairs(raw, group, left.length, right.length), info: next };
}

export interface SummaryClaim {
  text: string;
  missing: string[];
  extra: string[];
  changed: string[];
}

export async function aiNarrative(
  rulesSummary: string,
  leftoverHint: string,
  info: CompareModelInfo,
): Promise<{ claim: SummaryClaim | null; info: CompareModelInfo }> {
  const prompt = [
    'Write a short reviewer note for this invoice comparison.',
    'Return ONLY JSON: {"summary":"two sentences","missing":["name"],"extra":["name"],"changed":["name"]}',
    'Use only names that appear in the facts. Do not invent line items or totals.',
    `Facts: ${rulesSummary}`,
    leftoverHint,
  ].join('\n');
  const { text, info: next } = await askCompareModel(prompt, info);
  if (!text) return { claim: null, info: next };
  try {
    const obj = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as {
      summary?: string;
      missing?: string[];
      extra?: string[];
      changed?: string[];
    };
    return {
      claim: {
        text: obj.summary?.trim() || text.trim(),
        missing: Array.isArray(obj.missing) ? obj.missing : [],
        extra: Array.isArray(obj.extra) ? obj.extra : [],
        changed: Array.isArray(obj.changed) ? obj.changed : [],
      },
      info: next,
    };
  } catch {
    return { claim: { text: text.trim(), missing: [], extra: [], changed: [] }, info: next };
  }
}
