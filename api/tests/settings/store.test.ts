import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/db.js';
import { getSetting, setSetting, getCredentials, setCredentials, clearCredentials } from '../../src/settings/store.js';

beforeEach(async () => { await prisma.providerConfig.deleteMany(); await prisma.setting.deleteMany(); });

it('reads default when setting absent', async () => {
  expect(await getSetting('extraction_provider', 'mistral')).toBe('mistral');
});
it('persists and overrides a setting', async () => {
  await setSetting('extraction_provider', 'azure');
  expect(await getSetting('extraction_provider', 'mistral')).toBe('azure');
});
it('encrypts credentials and decrypts on read', async () => {
  await setCredentials('azure', { endpoint: 'https://x', apiKey: 'secret123' });
  const row = await prisma.providerConfig.findUnique({ where: { provider: 'azure' } });
  expect(row!.credentialsEnc).not.toContain('secret123');
  expect(await getCredentials('azure')).toEqual({ endpoint: 'https://x', apiKey: 'secret123' });
});
it('clears credentials', async () => {
  await setCredentials('azure', { apiKey: 'x' });
  await clearCredentials('azure');
  expect(await getCredentials('azure')).toBeNull();
});
