import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/auth.js';
import {
  getSettings,
  saveSettings,
  saveProviderCredentials,
  clearProviderCredentials,
  getAllCredentials,
} from '../shared/settings.js';
import { resolveThinkingBudget, THINKING_BUDGET_MIN, THINKING_BUDGET_MAX } from '../ocr/providers/geminiClient.js';
import { DEFAULT_MODEL_PRICING } from '../shared/modelPricing.js';
import { validateBody, settingsUpdateBodySchema } from '../shared/validation.js';
import { ValidationError } from '../shared/errors.js';

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
  app.get('/api/settings', { preHandler: requireAdmin }, async () => {
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
      compareProvider: settings.compareProvider ?? 'gemini',
      compareModel: settings.compareModel ?? 'gemini-2.5-flash',
      fallbackChain: settings.fallbackChain ?? null,
      providers,
      modelPricing: mergedPricing,
      defaultModelPricing: DEFAULT_MODEL_PRICING,
      usdToInr: settings.usdToInr ?? 96,
      thinkingBudget: resolveThinkingBudget(settings.thinkingBudget),
      mistralOcrPricePer1kPages: settings.mistralOcrPricePer1kPages ?? 4,
      thinkingBudgetRange: { min: THINKING_BUDGET_MIN, max: THINKING_BUDGET_MAX },
    };
  });

  /**
   * PUT /api/settings — save extraction/structuring selections.
   */
  app.put('/api/settings', { preHandler: requireAdmin }, async (req, reply) => {
    let body: Record<string, any>;
    try {
      body = validateBody(settingsUpdateBodySchema, req.body);
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.status(400).send({ success: false, message: err.message });
      }
      throw err;
    }
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
    if (typeof body.compareProvider === 'string') patch.compareProvider = body.compareProvider;
    if (typeof body.compareModel === 'string') patch.compareModel = body.compareModel;
    if (body.modelPricing && typeof body.modelPricing === 'object') {
      patch.modelPricing = body.modelPricing;
    }
    // Reject junk outright: a zero/NaN rate would silently zero every rupee figure.
    if (body.usdToInr !== undefined) {
      const rate = Number(body.usdToInr);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error('usdToInr must be a positive number');
      patch.usdToInr = rate;
    }
    if (body.thinkingBudget !== undefined) {
      const b = Number(body.thinkingBudget);
      if (!Number.isFinite(b)) throw new Error('thinkingBudget must be a number');
      // Clamped rather than rejected: the floor exists because a too-small budget
      // makes the model get invoice arithmetic wrong, and it fails silently.
      patch.thinkingBudget = resolveThinkingBudget(b);
    }
    if (body.mistralOcrPricePer1kPages !== undefined) {
      const r = Number(body.mistralOcrPricePer1kPages);
      if (!Number.isFinite(r) || r < 0) throw new Error('mistralOcrPricePer1kPages must be zero or greater');
      patch.mistralOcrPricePer1kPages = r;
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
      compareProvider: saved.compareProvider,
      compareModel: saved.compareModel,
      fallbackChain: saved.fallbackChain ?? null,
    };
  });

  /**
   * GET /api/settings/reveal — reveal all stored credentials (decrypted).
   */
  app.get('/api/settings/reveal', { preHandler: requireAdmin }, async () => {
    const credentials = await getAllCredentials();
    return { credentials };
  });

  /**
   * PUT /api/settings/providers/:provider — save provider credentials.
   */
  app.put('/api/settings/providers/:provider', { preHandler: requireAdmin }, async (req) => {
    const { provider } = req.params as { provider: string };
    const creds = req.body as Record<string, string>;
    await saveProviderCredentials(provider, creds);
    return { ok: true };
  });

  /**
   * DELETE /api/settings/providers/:provider — clear provider credentials.
   */
  app.delete('/api/settings/providers/:provider', { preHandler: requireAdmin }, async (req) => {
    const { provider } = req.params as { provider: string };
    await clearProviderCredentials(provider);
    return { ok: true };
  });
}
