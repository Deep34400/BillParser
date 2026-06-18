import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
beforeEach(async () => { await prisma.providerConfig.deleteMany(); await prisma.setting.deleteMany(); });
it('GET settings returns selections + masked provider status', async () => {
  const app = await buildApp();
  const b = (await app.inject({ url: '/api/settings' })).json();
  expect(b).toHaveProperty('extractionProvider');
  expect(b.providers.find((p: any) => p.name === 'azure')).toMatchObject({ configured: false });
  await app.close();
});
it('PUT credentials stores encrypted + masks on read; never returns raw', async () => {
  const app = await buildApp();
  await app.inject({ method: 'PUT', url: '/api/settings/providers/azure', payload: { endpoint: 'https://x', apiKey: 'sk-secret-9999' } });
  const b = (await app.inject({ url: '/api/settings' })).json();
  const azure = b.providers.find((p: any) => p.name === 'azure');
  expect(azure.configured).toBe(true);
  expect(JSON.stringify(b)).not.toContain('sk-secret-9999');
  expect(azure.masked.apiKey).toBe('••••9999');
  await app.close();
});
it('PUT selections persists', async () => {
  const app = await buildApp();
  await app.inject({ method: 'PUT', url: '/api/settings', payload: { extractionProvider: 'azure', structuringProvider: 'openai', structuringModel: 'gpt-4o-mini' } });
  expect((await app.inject({ url: '/api/settings' })).json().extractionProvider).toBe('azure');
  await app.close();
});
