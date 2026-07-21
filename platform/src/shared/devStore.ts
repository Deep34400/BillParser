/**
 * In-memory store for local development (no GCP credentials required).
 * Enable with LOCAL_DEV=true in platform/.env
 */
import type { BillDoc } from './types.js';
import type { AppSettings } from './settings.js';

const bills = new Map<string, BillDoc>();
const parts = new Map<string, import('./types.js').BillPartDoc>();
const files = new Map<string, { buf: Buffer; contentType: string }>();
const vendors = new Map<string, import('../vendor/vendorTypes.js').VendorDoc>();
const users = new Map<string, import('../users/repository.js').UserDoc>();
const tokenTransactions: import('../users/repository.js').TokenTransactionDoc[] = [];
const apiKeys: import('../users/repository.js').ApiKeyDoc[] = [];
let settings: AppSettings = {
  pipelineMode: 'single',
  extractionProvider: 'mistral',
  structuringProvider: 'gemini',
  structuringModel: 'gemini-2.5-flash',
  singleProvider: 'gemini',
  singleModel: 'gemini-2.5-flash',
};
const credentials = new Map<string, Record<string, string>>();

export const devStore = {
  bills,
  parts,
  files,
  vendors,
  users,
  tokenTransactions,
  apiKeys,
  getSettings: () => ({ ...settings }),
  saveSettings: (s: Partial<AppSettings>) => {
    settings = { ...settings, ...s };
    return settings;
  },
  getCreds: (provider: string) => credentials.get(provider) ?? {},
  saveCreds: (provider: string, creds: Record<string, string>) => {
    credentials.set(provider, { ...credentials.get(provider), ...creds });
  },
  clearCreds: (provider: string) => credentials.delete(provider),
  getAllCreds: () => Object.fromEntries(credentials.entries()),
};
