import type { FastifyInstance } from 'fastify';
import {
  getSettings,
  saveSettings,
  getProviderCredentials,
  saveProviderCredentials,
  clearProviderCredentials,
  getAllCredentials,
} from '../shared/settings.js';
import { DEFAULT_MODEL_PRICING } from '../shared/modelPricing.js';

const PROVIDERS = [
  { name: 'mistral', displayName: 'Mistral OCR', kind: 'markdown', requiredCredentials: ['apiKey'] },
  { name: 'gemini', displayName: 'Google Gemini', kind: 'markdown', requiredCredentials: ['apiKey'] },
  { name: 'azure', displayName: 'Azure Document Intelligence', kind: 'structured', requiredCredentials: ['apiKey', 'endpoint'] },
  { name: 'google', displayName: 'Google Document AI', kind: 'structured', requiredCredentials: ['keyJson', 'location', 'processorId', 'projectId'] },
  { name: 'llamaparse', displayName: 'LlamaParse', kind: 'markdown', requiredCredentials: ['apiKey'] },
  { name: 'textract', displayName: 'AWS Textract', kind: 'structured', requiredCredentials: ['accessKeyId', 'secretAccessKey', 'region'] },
  { name: 'ollama', displayName: 'GLM-OCR (Ollama)', kind: 'markdown', requiredCredentials: ['baseUrl', 'model'] },
  { name: 'azapi', displayName: 'AzAPI OCR', kind: 'structured', requiredCredentials: ['apiKey', 'endpoint'] },
];

export async function settingsRoutes(app: FastifyInstance) {
  /**
   * GET /api/settings
   */
  app.get('/api/settings', async () => {
    const settings = await getSettings();
    const allCreds = await getAllCredentials();

    const providers = PROVIDERS.map((p) => ({
      ...p,
      configured: !!allCreds[p.name] && Object.keys(allCreds[p.name]).length > 0,
    }));

    const mergedPricing: Record<string, { inputPer1M: number; outputPer1M: number }> = {};
    for (const [model, price] of Object.entries(DEFAULT_MODEL_PRICING)) {
      mergedPricing[model] = { ...price };
    }
    if (settings.modelPricing) {
      for (const [model, price] of Object.entries(settings.modelPricing)) {
        mergedPricing[model] = { ...price };
      }
    }

    return {
      pipelineMode: settings.pipelineMode ?? 'single',
      extractionProvider: settings.extractionProvider,
      structuringProvider: settings.structuringProvider,
      structuringModel: settings.structuringModel,
      extractionModel: settings.extractionModel ?? settings.structuringModel,
      singleProvider: settings.singleProvider ?? 'gemini',
      singleModel: settings.singleModel ?? 'gemini-2.5-flash',
      fallbackChain: settings.fallbackChain ?? null,
      providers,
      modelPricing: mergedPricing,
      defaultModelPricing: DEFAULT_MODEL_PRICING,
    };
  });

  /**
   * PUT /api/settings — save extraction/structuring selections.
   */
  app.put('/api/settings', async (req) => {
    const body = req.body as Record<string, any>;
    const patch: Record<string, any> = {};
    if (body.pipelineMode === 'split' || body.pipelineMode === 'single') {
      patch.pipelineMode = body.pipelineMode;
    }
    if (body.extractionProvider) patch.extractionProvider = body.extractionProvider;
    if (body.structuringProvider) patch.structuringProvider = body.structuringProvider;
    if (body.structuringModel) patch.structuringModel = body.structuringModel;
    if (body.extractionModel) patch.extractionModel = body.extractionModel;
    if (body.singleProvider) patch.singleProvider = body.singleProvider;
    if (body.singleModel) patch.singleModel = body.singleModel;
    if (body.modelPricing && typeof body.modelPricing === 'object') {
      patch.modelPricing = body.modelPricing;
    }
    if (Array.isArray(body.fallbackChain)) {
      patch.fallbackChain = body.fallbackChain;
    }
    const saved = await saveSettings(patch);
    return {
      ok: true,
      pipelineMode: saved.pipelineMode,
      structuringProvider: saved.structuringProvider,
      structuringModel: saved.structuringModel,
      singleProvider: saved.singleProvider,
      singleModel: saved.singleModel,
      fallbackChain: saved.fallbackChain ?? null,
    };
  });

  /**
   * GET /api/settings/reveal — reveal all stored credentials (decrypted).
   */
  app.get('/api/settings/reveal', async () => {
    const credentials = await getAllCredentials();
    return { credentials };
  });

  /**
   * PUT /api/settings/providers/:provider — save provider credentials.
   */
  app.put('/api/settings/providers/:provider', async (req) => {
    const { provider } = req.params as { provider: string };
    const creds = req.body as Record<string, string>;
    await saveProviderCredentials(provider, creds);
    return { ok: true };
  });

  /**
   * DELETE /api/settings/providers/:provider — clear provider credentials.
   */
  app.delete('/api/settings/providers/:provider', async (req) => {
    const { provider } = req.params as { provider: string };
    await clearProviderCredentials(provider);
    return { ok: true };
  });
}
