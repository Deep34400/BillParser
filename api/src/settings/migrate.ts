import { getSetting, setSetting, getCredentials, setCredentials } from './store.js';
import { DEFAULTS, DEFAULT_GEMINI } from './defaults.js';

const DEPRECATED_GEMINI_MODELS = new Set([
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-1.5-flash-8b',
]);

export function normalizeGeminiModel(model: string): string {
  return DEPRECATED_GEMINI_MODELS.has(model) ? DEFAULT_GEMINI.model : model;
}

/** Upgrade retired Gemini model IDs stored in the DB so extractions don't 404. */
export async function migrateDeprecatedSettings(): Promise<void> {
  const structuring = await getSetting('structuring_model', DEFAULTS.structuring_model);
  if (DEPRECATED_GEMINI_MODELS.has(structuring)) {
    await setSetting('structuring_model', DEFAULT_GEMINI.model);
  }

  const extraction = await getSetting('extraction_model', DEFAULT_GEMINI.model);
  if (DEPRECATED_GEMINI_MODELS.has(extraction)) {
    await setSetting('extraction_model', DEFAULT_GEMINI.model);
  }

  const gemini = await getCredentials('gemini');
  if (gemini?.model && DEPRECATED_GEMINI_MODELS.has(gemini.model)) {
    await setCredentials('gemini', { ...gemini, model: DEFAULT_GEMINI.model });
  }
}
