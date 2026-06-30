import { it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/config/db.js';
import { getSetting, setCredentials } from '../../src/settings/store.js';
import { normalizeGeminiModel, migrateDeprecatedSettings } from '../../src/settings/migrate.js';

beforeEach(async () => {
  await prisma.setting.deleteMany();
  await prisma.providerConfig.deleteMany();
});

it('normalizes retired Gemini model IDs', () => {
  expect(normalizeGeminiModel('gemini-2.0-flash')).toBe('gemini-2.5-flash');
  expect(normalizeGeminiModel('gemini-2.5-flash')).toBe('gemini-2.5-flash');
});

it('migrates deprecated structuring and extraction models in the DB', async () => {
  await prisma.setting.createMany({
    data: [
      { key: 'structuring_model', value: 'gemini-2.0-flash' },
      { key: 'extraction_model', value: 'gemini-2.0-flash' },
    ],
  });
  await setCredentials('gemini', { apiKey: 'k', model: 'gemini-2.0-flash' });
  await migrateDeprecatedSettings();
  expect(await getSetting('structuring_model', '')).toBe('gemini-2.5-flash');
  expect(await getSetting('extraction_model', '')).toBe('gemini-2.5-flash');
});
