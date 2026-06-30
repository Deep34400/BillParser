import type { FastifyInstance } from 'fastify';
import { allProviders } from '../providers/registry.js';
import { getSetting, setSetting, getCredentials, setCredentials, clearCredentials } from '../settings/store.js';
import { maskValue } from '../lib/crypto.js';
import { DEFAULTS, DEFAULT_GEMINI } from '../settings/defaults.js';
import { normalizeGeminiModel } from '../settings/migrate.js';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => {
    const providers = await Promise.all(allProviders().map(async (p) => {
      const creds = await getCredentials(p.name);
      const masked: Record<string, string> = {};
      if (creds) for (const k of p.requiredCredentials) if (creds[k]) masked[k] = maskValue(creds[k]);
      return { name: p.name, displayName: p.displayName, kind: p.kind, requiredCredentials: p.requiredCredentials, configured: p.isConfigured(creds), masked };
    }));
    return {
      extractionProvider: await getSetting('extraction_provider', DEFAULTS.extraction_provider),
      structuringProvider: await getSetting('structuring_provider', DEFAULTS.structuring_provider),
      structuringModel: normalizeGeminiModel(await getSetting('structuring_model', DEFAULTS.structuring_model)),
      extractionModel: normalizeGeminiModel(await getSetting('extraction_model', DEFAULT_GEMINI.model)),
      providers,
    };
  });
  // Returns DECRYPTED credentials so the Settings UI can repopulate fields across
  // reloads. This intentionally sends secrets to the client — acceptable for the
  // trusted, single-tenant, no-auth self-hosted deployment this tool targets.
  // (The default GET /api/settings stays masked; only this endpoint reveals.)
  app.get('/api/settings/reveal', async () => {
    const names = new Set<string>([...allProviders().map((p) => p.name), 'anthropic', 'openai', 'mistral', 'gemini']);
    const credentials: Record<string, Record<string, string>> = {};
    for (const name of names) {
      const creds = await getCredentials(name);
      if (creds) credentials[name] = creds;
    }
    return { credentials };
  });
  app.put('/api/settings', async (req) => {
    const b = req.body as any;
    if (b.extractionProvider) await setSetting('extraction_provider', b.extractionProvider);
    if (b.structuringProvider) await setSetting('structuring_provider', b.structuringProvider);
    if (b.structuringModel) await setSetting('structuring_model', normalizeGeminiModel(b.structuringModel));
    if (b.extractionModel) await setSetting('extraction_model', normalizeGeminiModel(b.extractionModel));
    // When both layers use Gemini, one model picker drives OCR + structuring.
    if (b.extractionProvider === 'gemini' && b.structuringProvider === 'gemini' && b.structuringModel) {
      const model = normalizeGeminiModel(b.structuringModel);
      await setSetting('extraction_model', model);
      await setSetting('structuring_model', model);
    }
    return { ok: true };
  });
  app.put('/api/settings/providers/:provider', async (req) => {
    const { provider } = req.params as { provider: string };
    const incoming = (req.body ?? {}) as Record<string, string>;
    // Ignore blank fields and merge over any existing credentials so a partial
    // save (e.g. updating only the endpoint) never clobbers the other fields.
    const clean = Object.fromEntries(
      Object.entries(incoming).filter(([, v]) => v !== '' && v != null),
    );
    const existing = (await getCredentials(provider)) ?? {};
    await setCredentials(provider, { ...existing, ...clean });
    return { ok: true };
  });
  app.delete('/api/settings/providers/:provider', async (req) => {
    await clearCredentials((req.params as { provider: string }).provider);
    return { ok: true };
  });
}
