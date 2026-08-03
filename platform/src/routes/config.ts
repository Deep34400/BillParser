import type { FastifyInstance } from 'fastify';
import { getSettings, saveSettings, getAllCredentials } from '../shared/settings.js';
import { env } from '../config/env.js';

const PROVIDERS = [
  { name: 'mistral', displayName: 'Mistral OCR', kind: 'markdown', requiredCredentials: ['apiKey'] },
  { name: 'gemini', displayName: 'Google Gemini', kind: 'markdown', requiredCredentials: ['apiKey'] },
  { name: 'azure', displayName: 'Azure Document Intelligence', kind: 'structured', requiredCredentials: ['apiKey', 'endpoint'] },
  { name: 'google', displayName: 'Google Document AI', kind: 'structured', requiredCredentials: ['keyJson', 'location', 'processorId', 'projectId'] },
  { name: 'llamaparse', displayName: 'LlamaParse', kind: 'markdown', requiredCredentials: ['apiKey'] },
  { name: 'textract', displayName: 'AWS Textract', kind: 'structured', requiredCredentials: ['accessKeyId', 'secretAccessKey', 'region'] },
  { name: 'ollama', displayName: 'GLM-OCR (Ollama)', kind: 'markdown', requiredCredentials: ['baseUrl', 'model'] },
];

export async function configRoutes(app: FastifyInstance) {
  /**
   * GET /api/config — app config (providers + active selections).
   * Frontend calls this on every page load.
   */
  app.get('/api/config', async () => {
    const settings = await getSettings();
    const allCreds = await getAllCredentials();

    const providers = PROVIDERS.map((p) => ({
      ...p,
      configured: !!allCreds[p.name] && Object.keys(allCreds[p.name]).length > 0,
    }));

    return {
      providers,
      pipelineMode: settings.pipelineMode ?? 'single',
      activeProvider:
        (settings.pipelineMode ?? 'single') === 'single'
          ? (settings.singleProvider ?? 'gemini')
          : settings.extractionProvider,
      structuringProvider: settings.structuringProvider,
      structuringModel: settings.structuringModel,
      singleProvider: settings.singleProvider ?? 'gemini',
      singleModel: settings.singleModel ?? 'gemini-2.5-flash',
      emailIntake: {
        enabled: settings.emailIntakeEnabled ?? env.imapEnabled,
        address: env.imapUser || null,
        pollIntervalSec: env.pollIntervalSec,
        allowedSenders: settings.emailIntakeAllowedSenders ?? [],
        running: (await import('../email-intake/poller.js')).isEmailIntakeRunning(),
      },
    };
  });

  /**
   * PUT /api/config/email-intake — toggle email intake on/off, update allowed senders.
   * Body: { enabled?: boolean, allowedSenders?: string[] }
   * When enabled flips, starts/stops the IMAP poller immediately (no restart needed).
   */
  app.put('/api/config/email-intake', async (req) => {
    const body = req.body as { enabled?: boolean; allowedSenders?: string[] };
    const patch: Record<string, any> = {};
    if (typeof body.enabled === 'boolean') patch.emailIntakeEnabled = body.enabled;
    if (Array.isArray(body.allowedSenders)) {
      patch.emailIntakeAllowedSenders = body.allowedSenders
        .map((s: string) => s.toLowerCase().trim())
        .filter(Boolean);
    }
    const saved = await saveSettings(patch);

    // Live start/stop — don't wait for server restart
    if (typeof body.enabled === 'boolean') {
      try {
        const { startEmailIntake, stopEmailIntake, isEmailIntakeRunning } = await import('../email-intake/poller.js');
        if (body.enabled) {
          if (!isEmailIntakeRunning()) {
            await startEmailIntake({ force: true });
          }
        } else {
          await stopEmailIntake();
        }
      } catch (err) {
        console.error('[email-intake] Failed to apply toggle:', err instanceof Error ? err.message : err);
      }
    }

    const { isEmailIntakeRunning } = await import('../email-intake/poller.js');
    return {
      ok: true,
      emailIntake: {
        enabled: saved.emailIntakeEnabled ?? false,
        running: isEmailIntakeRunning(),
        allowedSenders: saved.emailIntakeAllowedSenders ?? [],
      },
    };
  });
}
