import type { FastifyInstance } from 'fastify';
import {
  getSettings,
  saveSettings,
  getAllCredentials,
  getProviderCredentials,
  saveProviderCredentials,
} from '../shared/settings.js';
import { IMAP_CREDS_PROVIDER, IMAP_DEFAULTS, getImapRuntimeConfig } from '../email-intake/imapConfig.js';

const PROVIDERS = [
  { name: 'mistral', displayName: 'Mistral OCR', kind: 'markdown', requiredCredentials: ['apiKey'] },
  { name: 'gemini', displayName: 'Google Gemini', kind: 'markdown', requiredCredentials: ['apiKey'] },
  { name: 'azure', displayName: 'Azure Document Intelligence', kind: 'structured', requiredCredentials: ['apiKey', 'endpoint'] },
  { name: 'google', displayName: 'Google Document AI', kind: 'structured', requiredCredentials: ['keyJson', 'location', 'processorId', 'projectId'] },
  { name: 'llamaparse', displayName: 'LlamaParse', kind: 'markdown', requiredCredentials: ['apiKey'] },
  { name: 'textract', displayName: 'AWS Textract', kind: 'structured', requiredCredentials: ['accessKeyId', 'secretAccessKey', 'region'] },
  { name: 'ollama', displayName: 'GLM-OCR (Ollama)', kind: 'markdown', requiredCredentials: ['baseUrl', 'model'] },
];

function maskSecret(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return '••••';
  return '••••••••' + value.slice(-4);
}

export async function configRoutes(app: FastifyInstance) {
  app.get('/api/config', async () => {
    const settings = await getSettings();
    const allCreds = await getAllCredentials();
    const imap = await getImapRuntimeConfig();
    const imapCreds = await getProviderCredentials(IMAP_CREDS_PROVIDER);

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
        enabled: imap.enabled,
        address: imap.user || null,
        hasPassword: !!imap.password,
        passwordHint: maskSecret(imapCreds.password),
        pollIntervalSec: imap.pollIntervalSec,
        host: imap.host,
        port: imap.port,
        allowedSenders: settings.emailIntakeAllowedSenders ?? [],
        running: (await import('../email-intake/poller.js')).isEmailIntakeRunning(),
      },
    };
  });

  /**
   * PUT /api/config/email-intake
   * Body: { enabled?, user?, password?, pollIntervalSec?, allowedSenders? }
   * All mail config lives in DB — nothing from .env.
   */
  app.put('/api/config/email-intake', async (req) => {
    const body = req.body as {
      enabled?: boolean;
      user?: string;
      password?: string;
      pollIntervalSec?: number;
      allowedSenders?: string[];
    };
    const patch: Record<string, any> = {};
    if (typeof body.enabled === 'boolean') patch.emailIntakeEnabled = body.enabled;
    if (typeof body.user === 'string') {
      patch.emailIntakeUser = body.user.trim().toLowerCase();
    }
    if (typeof body.pollIntervalSec === 'number' && Number.isFinite(body.pollIntervalSec)) {
      patch.emailIntakePollIntervalSec = Math.max(10, Math.min(3600, Math.round(body.pollIntervalSec)));
    }
    if (Array.isArray(body.allowedSenders)) {
      patch.emailIntakeAllowedSenders = body.allowedSenders
        .map((s: string) => s.toLowerCase().trim())
        .filter(Boolean);
    }
    const saved = await saveSettings(patch);

    if (typeof body.user === 'string' || typeof body.password === 'string') {
      const credPatch: Record<string, string> = {};
      if (typeof body.user === 'string') credPatch.user = body.user.trim().toLowerCase();
      if (typeof body.password === 'string' && body.password.trim()) {
        credPatch.password = body.password;
      }
      if (Object.keys(credPatch).length) {
        await saveProviderCredentials(IMAP_CREDS_PROVIDER, credPatch);
      }
    }

    const shouldRestart =
      typeof body.enabled === 'boolean' ||
      typeof body.user === 'string' ||
      typeof body.pollIntervalSec === 'number' ||
      (typeof body.password === 'string' && body.password.trim().length > 0);

    if (shouldRestart) {
      try {
        const { startEmailIntake, stopEmailIntake } = await import('../email-intake/poller.js');
        const wantOn = saved.emailIntakeEnabled === true;
        await stopEmailIntake();
        if (wantOn) {
          await startEmailIntake({ force: true });
        }
      } catch (err) {
        console.error('[email-intake] Failed to apply toggle/creds:', err instanceof Error ? err.message : err);
      }
    }

    const imap = await getImapRuntimeConfig();
    const imapCreds = await getProviderCredentials(IMAP_CREDS_PROVIDER);
    const { isEmailIntakeRunning } = await import('../email-intake/poller.js');
    return {
      ok: true,
      emailIntake: {
        enabled: imap.enabled,
        running: isEmailIntakeRunning(),
        address: imap.user || null,
        hasPassword: !!imap.password,
        passwordHint: maskSecret(imapCreds.password),
        pollIntervalSec: imap.pollIntervalSec,
        host: IMAP_DEFAULTS.host,
        port: IMAP_DEFAULTS.port,
        allowedSenders: saved.emailIntakeAllowedSenders ?? [],
      },
    };
  });
}
