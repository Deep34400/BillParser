/**
 * Settings storage — Postgres, single-row `app_settings` table + `provider_credentials`.
 */
import { eq } from 'drizzle-orm';
import { db } from '../config/db.js';
import { appSettings, providerCredentials } from '../db/schema.js';
import type { ModelPrice } from './modelPricing.js';

export interface AppSettings {
  /** 'split' = separate extraction + structuring, 'single' = one provider does both */
  pipelineMode: 'split' | 'single';
  extractionProvider: string;
  structuringProvider: string;
  structuringModel: string;
  extractionModel?: string;
  /** For single mode: which provider handles both extraction + structuring */
  singleProvider?: string;
  singleModel?: string;
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
  /**
   * USD→INR rate used to display costs in rupees. Stored here rather than
   * hardcoded so it can be corrected without a deploy — it was pinned at 83 for
   * long enough to understate every rupee figure by ~13%.
   *
   * The rate in force at processing time is copied onto each bill
   * (`fx_rate_usd_inr`), so changing it never rewrites historical figures.
   */
  usdToInr?: number;
  /**
   * Cap on Gemini reasoning tokens per call. A ceiling, not an allocation —
   * models use what they need (typically 150–800) and stop, so raising it costs
   * nothing on ordinary invoices and only affects complex ones.
   *
   * Floored well above zero on purpose: with thinking disabled the model got
   * invoice arithmetic wrong every time (₹8,083 against a correct ₹7,080). That
   * failure is silent — the number still looks plausible — so the range is
   * bounded-to-generous, never off.
   */
  thinkingBudget?: number;
  /**
   * Mistral OCR price per 1,000 pages. Billed per page, not per token, so it
   * cannot live in the $/1M-token table — it was previously a constant in
   * providers/mistralOcr.ts and took a deploy to correct.
   */
  mistralOcrPricePer1kPages?: number;
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
  mistralOcrPricePer1kPages: 2,
};

const SETTINGS_ID = 1;

function rowToSettings(row: typeof appSettings.$inferSelect): AppSettings {
  return {
    pipelineMode: row.pipelineMode as AppSettings['pipelineMode'],
    extractionProvider: row.extractionProvider,
    structuringProvider: row.structuringProvider,
    structuringModel: row.structuringModel,
    extractionModel: row.extractionModel ?? undefined,
    singleProvider: row.singleProvider ?? undefined,
    singleModel: row.singleModel ?? undefined,
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
