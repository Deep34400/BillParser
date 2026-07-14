/**
 * Settings storage — Firestore in production, in-memory when LOCAL_DEV=true.
 */
import { env } from '../config/env.js';
import { db, col } from '../config/firebase.js';
import { devStore } from '../lib/devStore.js';

const SETTINGS_DOC = 'app_settings';
const CREDS_COLLECTION = 'provider_credentials';

export interface AppSettings {
  extractionProvider: string;
  structuringProvider: string;
  structuringModel: string;
  extractionModel?: string;
}

const DEFAULTS: AppSettings = {
  extractionProvider: 'mistral',
  structuringProvider: 'gemini',
  structuringModel: 'gemini-2.5-flash',
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
