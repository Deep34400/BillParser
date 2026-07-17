/**
 * Resolve API key + model for a provider.
 * Priority: DB-stored credentials → env var fallback.
 *
 * Gemini special case: API key is optional. If missing, callers use Vertex AI + ADC.
 */
import { getProviderCredentials } from '../models/settings.js';
import { env } from '../config/env.js';

const ENV_KEY_MAP: Record<string, string> = {
  mistral: 'MISTRAL_API_KEY',
  gemini: 'GEMINI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

const DEFAULT_MODELS: Record<string, string> = {
  mistral: 'mistral-small-latest',
  gemini: 'gemini-2.5-flash',
  claude: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
};

const ENV_TO_PROP: Record<string, keyof typeof env> = {
  mistral: 'mistralApiKey',
  gemini: 'geminiApiKey',
};

export interface ResolvedProvider {
  apiKey: string;
  model: string;
  /** For Gemini: true when no API key — use Vertex + ADC */
  useAdc: boolean;
}

function envKey(provider: string): string {
  const prop = ENV_TO_PROP[provider];
  if (prop) return (env as any)[prop] ?? '';
  const varName = ENV_KEY_MAP[provider];
  if (varName) return process.env[varName] ?? '';
  return '';
}

export async function resolveProviderKey(provider: string, modelOverride?: string): Promise<ResolvedProvider> {
  const creds = await getProviderCredentials(provider);

  const apiKey = creds.apiKey || envKey(provider);
  const model = modelOverride
    || creds.model
    || (provider === 'gemini' ? env.geminiModel : '')
    || (provider === 'mistral' ? env.mistralModel : '')
    || DEFAULT_MODELS[provider]
    || '';

  // Gemini may authenticate via ADC (Vertex) when no API key is configured.
  if (!apiKey && provider !== 'gemini') {
    const varName = ENV_KEY_MAP[provider] ?? `${provider.toUpperCase()}_API_KEY`;
    throw new Error(`No API key for ${provider} — set it in Settings UI or ${varName} env var`);
  }

  return { apiKey, model, useAdc: provider === 'gemini' && !apiKey };
}
