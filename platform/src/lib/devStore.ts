/**
 * In-memory store for local development (no GCP credentials required).
 * Enable with LOCAL_DEV=true in platform/.env
 */
import type { BillDoc } from '../models/types.js';
import type { AppSettings } from '../models/settings.js';

const bills = new Map<string, BillDoc>();
const parts = new Map<string, import('../models/types.js').BillPartDoc>();
const files = new Map<string, { buf: Buffer; contentType: string }>();
const users = new Map<string, import('../models/users.js').UserDoc>();
const tokenTransactions: import('../models/users.js').TokenTransactionDoc[] = [];
const apiKeys: import('../models/users.js').ApiKeyDoc[] = [];
let settings: AppSettings = {
  extractionProvider: 'mistral',
  structuringProvider: 'gemini',
  structuringModel: 'gemini-2.5-flash',
};
const credentials = new Map<string, Record<string, string>>();

export const devStore = {
  bills,
  parts,
  files,
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
