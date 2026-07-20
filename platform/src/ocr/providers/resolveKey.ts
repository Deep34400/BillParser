/**
 * Resolve API key + model for a provider.
 * Priority: DB-stored credentials → env var fallback.
 *
 * Gemini: ALWAYS Vertex AI + ADC (never API key), even if a key exists in Settings/env.
 */
import { getProviderCredentials } from '../../shared/settings.js';
import { env } from '../../config/env.js';

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
  /** For Gemini: always true — Vertex + ADC */
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

  // Gemini never uses API keys — model from Settings/override, auth via ADC only.
  if (provider === 'gemini') {
    const model = modelOverride
      || creds.model
      || env.geminiModel
      || DEFAULT_MODELS.gemini;
    return { apiKey: '', model, useAdc: true };
  }

  const apiKey = creds.apiKey || envKey(provider);
  const model = modelOverride
    || creds.model
    || (provider === 'mistral' ? env.mistralModel : '')
    || DEFAULT_MODELS[provider]
    || '';

  if (!apiKey) {
    const varName = ENV_KEY_MAP[provider] ?? `${provider.toUpperCase()}_API_KEY`;
    throw new Error(`No API key for ${provider} — set it in Settings UI or ${varName} env var`);
  }

  return { apiKey, model, useAdc: false };
}
