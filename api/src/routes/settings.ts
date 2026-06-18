import type { FastifyInstance } from 'fastify';
import { allProviders } from '../providers/registry.js';
import { getSetting, setSetting, getCredentials, setCredentials, clearCredentials } from '../settings/store.js';
import { maskValue } from '../lib/crypto.js';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => {
    const providers = await Promise.all(allProviders().map(async (p) => {
      const creds = await getCredentials(p.name);
      const masked: Record<string, string> = {};
      if (creds) for (const k of p.requiredCredentials) if (creds[k]) masked[k] = maskValue(creds[k]);
      return { name: p.name, displayName: p.displayName, kind: p.kind, requiredCredentials: p.requiredCredentials, configured: p.isConfigured(creds), masked };
    }));
    return {
      extractionProvider: await getSetting('extraction_provider', 'mistral'),
      structuringProvider: await getSetting('structuring_provider', 'anthropic'),
      structuringModel: await getSetting('structuring_model', 'claude-sonnet-4-6'),
      providers,
    };
  });
  app.put('/api/settings', async (req) => {
    const b = req.body as any;
    if (b.extractionProvider) await setSetting('extraction_provider', b.extractionProvider);
    if (b.structuringProvider) await setSetting('structuring_provider', b.structuringProvider);
    if (b.structuringModel) await setSetting('structuring_model', b.structuringModel);
    return { ok: true };
  });
  app.put('/api/settings/providers/:provider', async (req) => {
    const { provider } = req.params as { provider: string };
    await setCredentials(provider, req.body as Record<string, string>);
    return { ok: true };
  });
  app.delete('/api/settings/providers/:provider', async (req) => {
    await clearCredentials((req.params as { provider: string }).provider);
    return { ok: true };
  });
}
