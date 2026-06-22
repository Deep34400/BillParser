import type { FastifyInstance } from 'fastify';
import { allProviders } from '../providers/registry.js';
import { getCredentials, getSetting } from '../settings/store.js';
import { DEFAULTS } from '../settings/defaults.js';

export async function configRoutes(app: FastifyInstance) {
  app.get('/api/config', async () => {
    const providers = await Promise.all(allProviders().map(async (p) => ({
      name: p.name, displayName: p.displayName, kind: p.kind,
      configured: p.isConfigured(await getCredentials(p.name)),
    })));
    return {
      providers,
      activeProvider: await getSetting('extraction_provider', DEFAULTS.extraction_provider),
      structuringProvider: await getSetting('structuring_provider', DEFAULTS.structuring_provider),
      structuringModel: await getSetting('structuring_model', DEFAULTS.structuring_model),
    };
  });
}
