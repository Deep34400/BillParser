/**
 * Settings storage — Sequelize: single-row `app_settings` + `provider_credentials`.
 */
import { AppSettingsModel } from './models/appSettings.js';
import { ProviderCredential } from './models/providerCredential.js';
import { DEFAULT_USD_TO_INR, DEFAULT_THINKING_BUDGET, DEFAULT_MISTRAL_OCR_PRICE_PER_1K } from './constants.js';
import type { ModelPrice } from './modelPricing.js';

const SETTINGS_ID = 1;

export interface FallbackLevel {
  label: string;
  mode: 'single' | 'split';
  provider: string;
  model: string;
  structuringProvider?: string;
  structuringModel?: string;
  enabled: boolean;
}

export interface AppSettings {
  pipelineMode: 'split' | 'single';
  extractionProvider: string;
  structuringProvider: string;
  structuringModel: string;
  extractionModel?: string;
  singleProvider?: string;
  singleModel?: string;
  fallbackChain?: FallbackLevel[];
  usdToInr?: number;
  thinkingBudget?: number;
  mistralOcrPricePer1kPages?: number;
  emailIntakeEnabled?: boolean;
  emailIntakeUser?: string;
  emailIntakePollIntervalSec?: number;
  emailIntakeAllowedSenders?: string[];
  modelPricing?: Record<string, ModelPrice> | null;
}

function rowToSettings(row: AppSettingsModel): AppSettings {
  return {
    pipelineMode: row.pipelineMode as AppSettings['pipelineMode'],
    extractionProvider: row.extractionProvider,
    structuringProvider: row.structuringProvider,
    structuringModel: row.structuringModel,
    extractionModel: row.extractionModel ?? undefined,
    singleProvider: row.singleProvider ?? undefined,
    singleModel: row.singleModel ?? undefined,
    fallbackChain: (row.fallbackChain as FallbackLevel[] | null) ?? undefined,
    emailIntakeEnabled: row.emailIntakeEnabled ?? undefined,
    emailIntakeUser: row.emailIntakeUser ?? undefined,
    emailIntakePollIntervalSec: row.emailIntakePollIntervalSec ?? undefined,
    emailIntakeAllowedSenders: row.emailIntakeAllowedSenders ?? undefined,
    modelPricing: (row.modelPricing as Record<string, ModelPrice> | null) ?? undefined,
    usdToInr: row.usdToInr ?? undefined,
    thinkingBudget: row.thinkingBudget ?? undefined,
    mistralOcrPricePer1kPages: row.mistralOcrPricePer1kPages ?? undefined,
  };
}

const DEFAULTS: AppSettings = {
  pipelineMode: 'single',
  extractionProvider: 'mistral',
  structuringProvider: 'gemini',
  structuringModel: 'gemini-2.5-flash',
  singleProvider: 'gemini',
  singleModel: 'gemini-2.5-flash',
  usdToInr: DEFAULT_USD_TO_INR,
  thinkingBudget: DEFAULT_THINKING_BUDGET,
  mistralOcrPricePer1kPages: DEFAULT_MISTRAL_OCR_PRICE_PER_1K,
};

export async function getSettings(): Promise<AppSettings> {
  const row = await AppSettingsModel.findByPk(SETTINGS_ID);
  if (!row) return { ...DEFAULTS };
  return { ...DEFAULTS, ...rowToSettings(row) };
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const merged = { ...current, ...settings };

  await AppSettingsModel.upsert({
    id: SETTINGS_ID,
    pipelineMode: merged.pipelineMode,
    extractionProvider: merged.extractionProvider,
    structuringProvider: merged.structuringProvider,
    structuringModel: merged.structuringModel,
    extractionModel: merged.extractionModel ?? null,
    singleProvider: merged.singleProvider ?? null,
    singleModel: merged.singleModel ?? null,
    fallbackChain: (merged.fallbackChain as any) ?? null,
    emailIntakeEnabled: merged.emailIntakeEnabled ?? null,
    emailIntakeUser: merged.emailIntakeUser ?? null,
    emailIntakePollIntervalSec: merged.emailIntakePollIntervalSec ?? null,
    emailIntakeAllowedSenders: merged.emailIntakeAllowedSenders ?? null,
    modelPricing: (merged.modelPricing as any) ?? null,
    usdToInr: merged.usdToInr ?? null,
    thinkingBudget: merged.thinkingBudget ?? null,
    mistralOcrPricePer1kPages: merged.mistralOcrPricePer1kPages ?? null,
  } as any);
  return merged;
}

export function buildFallbackChain(settings: AppSettings): FallbackLevel[] {
  if (settings.fallbackChain && settings.fallbackChain.length > 0) {
    const enabled = settings.fallbackChain.filter((l) => l.enabled);
    if (enabled.length > 0) return enabled;
  }
  const mode = settings.pipelineMode ?? 'single';
  if (mode === 'single') {
    return [{
      label: 'Primary',
      mode: 'single',
      provider: settings.singleProvider ?? 'gemini',
      model: settings.singleModel ?? 'gemini-2.5-flash',
      enabled: true,
    }];
  }
  return [{
    label: 'Primary',
    mode: 'split',
    provider: 'mistral',
    model: 'mistral-ocr-latest',
    structuringProvider: settings.structuringProvider ?? 'gemini',
    structuringModel: settings.structuringModel ?? 'gemini-2.5-flash',
    enabled: true,
  }];
}

export async function getProviderCredentials(provider: string): Promise<Record<string, string>> {
  const row = await ProviderCredential.findByPk(provider);
  return (row?.credentials as Record<string, string>) ?? {};
}

export async function saveProviderCredentials(provider: string, creds: Record<string, string>): Promise<void> {
  const current = await getProviderCredentials(provider);
  const merged = { ...current, ...creds };
  await ProviderCredential.upsert({ provider, credentials: merged } as any);
}

export async function clearProviderCredentials(provider: string): Promise<void> {
  await ProviderCredential.destroy({ where: { provider } });
}

export async function getAllCredentials(): Promise<Record<string, Record<string, string>>> {
  const rows = await ProviderCredential.findAll();
  const result: Record<string, Record<string, string>> = {};
  for (const row of rows) result[row.provider] = row.credentials as Record<string, string>;
  return result;
}
