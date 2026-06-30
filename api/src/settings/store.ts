import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import type { ExtractionProvider } from '../providers/types.js';

export async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}
export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
export async function getCredentials(provider: string): Promise<Record<string, string> | null> {
  const row = await prisma.providerConfig.findUnique({ where: { provider } });
  if (!row || !row.enabled) return null;
  try { return JSON.parse(decrypt(row.credentialsEnc, env.appSecret)); } catch { return null; }
}
export async function setCredentials(provider: string, creds: Record<string, string>): Promise<void> {
  const credentialsEnc = encrypt(JSON.stringify(creds), env.appSecret);
  await prisma.providerConfig.upsert({
    where: { provider }, update: { credentialsEnc, enabled: true }, create: { provider, credentialsEnc },
  });
}
export async function clearCredentials(provider: string): Promise<void> {
  await prisma.providerConfig.deleteMany({ where: { provider } });
}
export async function getProviderCredsOrThrow(provider: string, impl: ExtractionProvider): Promise<Record<string, string>> {
  const creds = await getCredentials(provider);
  if (!impl.isConfigured(creds)) throw new Error(`No credentials configured for provider "${provider}". Add them in Settings.`);
  return creds!;
}
