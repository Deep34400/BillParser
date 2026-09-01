/**
 * Settings storage — Postgres: single-row `app_settings` + `provider_credentials`.
 */
import { eq } from 'drizzle-orm';
import { db } from '../config/db.js';
import { appSettings, providerCredentials } from '../db/schema.js';
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
  /** @deprecated Use fallbackChain instead */
  pipelineMode: 'split' | 'single';
  /** @deprecated Use fallbackChain instead */
  extractionProvider: string;
  /** @deprecated Use fallbackChain instead */
  structuringProvider: string;
  /** @deprecated Use fallbackChain instead */
  structuringModel: string;
  /** @deprecated */
  extractionModel?: string;
  /** @deprecated Use fallbackChain instead */
  singleProvider?: string;
  /** @deprecated Use fallbackChain instead */
  singleModel?: string;
  /** Ordered fallback chain — all model config lives here. Managed from Settings UI. */
  fallbackChain?: FallbackLevel[];
  /**
   * USD→INR rate for rupee display. Stored rather than hardcoded — it sat at 83
   * long enough to understate every rupee figure by ~13%. The rate in force at
   * processing time is copied onto each bill (fx_rate_usd_inr), so changing it
   * never rewrites historical figures.
   */
  usdToInr?: number;
  /**
   * Cap on Gemini reasoning tokens per call. A ceiling, not an allocation.
   * Floored above zero deliberately: with thinking disabled the model got invoice
   * arithmetic wrong every time, and the failure is silent.
   */
  thinkingBudget?: number;
  /**
   * Mistral OCR price per 1,000 pages — billed per page, not per token, so it
   * cannot live in the $/1M-token table. $4 is the standard OCR 4.1 rate; 2 is
   * the /v1/batch price and this client calls the synchronous endpoint.
   */
  mistralOcrPricePer1kPages?: number;
  /** Email intake — stored in DB so admin can toggle from UI */
  emailIntakeEnabled?: boolean;
  /** Mailbox address to poll (IMAP user) — set from Admin UI */
  emailIntakeUser?: string;
  /** Poll interval in seconds (Admin UI) */
  emailIntakePollIntervalSec?: number;
  /** Allowed sender emails/domains for email intake (legacy; prefer user intake_email) */
  emailIntakeAllowedSenders?: string[];
  /** Per-model pricing overrides ($/1M tokens). When set, overrides default pricing. */
  modelPricing?: Record<string, ModelPrice> | null;
}

function rowToSettings(row: typeof appSettings.$inferSelect): AppSettings {
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
  // ~95.7 as of Aug 2026; override in Settings when it drifts.
  usdToInr: 96,
  thinkingBudget: 2048,
  // Standard OCR 4.1 rate. 2 is the /v1/batch price; this client is synchronous.
  mistralOcrPricePer1kPages: 4,
};

export async function getSettings(): Promise<AppSettings> {
  const [row] = await db().select().from(appSettings).where(eq(appSettings.id, SETTINGS_ID)).limit(1);
  if (!row) return { ...DEFAULTS };
  return { ...DEFAULTS, ...rowToSettings(row) };
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  await db().insert(appSettings).values({ id: SETTINGS_ID, ...merged }).onConflictDoUpdate({
    target: appSettings.id,
    set: merged,
  });
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
  const [row] = await db().select().from(providerCredentials)
    .where(eq(providerCredentials.provider, provider)).limit(1);
  return (row?.credentials as Record<string, string>) ?? {};
}

export async function saveProviderCredentials(provider: string, creds: Record<string, string>): Promise<void> {
  const current = await getProviderCredentials(provider);
  const merged = { ...current, ...creds };
  await db().insert(providerCredentials).values({ provider, credentials: merged }).onConflictDoUpdate({
    target: providerCredentials.provider,
    set: { credentials: merged },
  });
}

export async function clearProviderCredentials(provider: string): Promise<void> {
  await db().delete(providerCredentials).where(eq(providerCredentials.provider, provider));
}

export async function getAllCredentials(): Promise<Record<string, Record<string, string>>> {
  const rows = await db().select().from(providerCredentials);
  const result: Record<string, Record<string, string>> = {};
  for (const row of rows) result[row.provider] = row.credentials as Record<string, string>;
  return result;
}
