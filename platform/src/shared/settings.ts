/**
 * Settings storage — Firestore in production, in-memory when LOCAL_DEV=true.
 */
import { env } from '../config/env.js';
import { db, col } from '../config/firebase.js';
import { devStore } from './devStore.js';
import type { ModelPrice } from './modelPricing.js';

const SETTINGS_DOC = 'app_settings';
const CREDS_COLLECTION = 'provider_credentials';

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

const DEFAULTS: AppSettings = {
  pipelineMode: 'single',
  extractionProvider: 'mistral',
  structuringProvider: 'gemini',
  structuringModel: 'gemini-2.5-flash',
  singleProvider: 'gemini',
  singleModel: 'gemini-2.5-flash',
};

export async function getSettings(): Promise<AppSettings> {
  if (env.localDev) return devStore.getSettings();
  const snap = await db().collection(col('settings')).doc(SETTINGS_DOC).get();
  if (!snap.exists) return { ...DEFAULTS };
  return { ...DEFAULTS, ...(snap.data() as Partial<AppSettings>) };
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  if (env.localDev) return devStore.saveSettings(settings);
  const current = await getSettings();
  const merged = { ...current, ...settings };
  await db().collection(col('settings')).doc(SETTINGS_DOC).set(merged);
  return merged;
}

/**
 * Build fallback chain from settings. If fallbackChain exists and has enabled levels, use it.
 * Otherwise construct a 1-level chain from legacy pipelineMode/singleProvider/singleModel fields.
 */
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
  if (env.localDev) return devStore.getCreds(provider);
  const snap = await db().collection(col(CREDS_COLLECTION)).doc(provider).get();
  if (!snap.exists) return {};
  return snap.data() as Record<string, string>;
}

export async function saveProviderCredentials(provider: string, creds: Record<string, string>): Promise<void> {
  if (env.localDev) {
    devStore.saveCreds(provider, creds);
    return;
  }
  const current = await getProviderCredentials(provider);
  await db().collection(col(CREDS_COLLECTION)).doc(provider).set({ ...current, ...creds });
}

export async function clearProviderCredentials(provider: string): Promise<void> {
  if (env.localDev) {
    devStore.clearCreds(provider);
    return;
  }
  await db().collection(col(CREDS_COLLECTION)).doc(provider).delete();
}

export async function getAllCredentials(): Promise<Record<string, Record<string, string>>> {
  if (env.localDev) return devStore.getAllCreds();
  const snap = await db().collection(col(CREDS_COLLECTION)).get();
  const result: Record<string, Record<string, string>> = {};
  for (const doc of snap.docs) {
    result[doc.id] = doc.data() as Record<string, string>;
  }
  return result;
}
