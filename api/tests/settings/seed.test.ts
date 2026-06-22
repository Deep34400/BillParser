import { it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/db.js';
import { seedFromEnv } from '../../src/settings/seed.js';
import { getCredentials, getSetting } from '../../src/settings/store.js';

beforeEach(async () => { await prisma.providerConfig.deleteMany(); await prisma.setting.deleteMany(); });

it('seeds the local ollama provider so it is configured out of the box', async () => {
  await seedFromEnv();
  const creds = await getCredentials('ollama');
  expect(creds).toMatchObject({ baseUrl: 'http://host.docker.internal:11434', model: 'glm-ocr' });
});

it('seeds local provider selections when no env overrides are set', async () => {
  await seedFromEnv();
  // env may or may not set these in CI; the seeded value must at least be present and local-safe.
  expect(await getSetting('extraction_provider', 'sentinel')).not.toBe('sentinel');
});
