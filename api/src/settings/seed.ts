import { prisma } from '../db.js';
import { encrypt } from '../lib/crypto.js';
import { env } from '../env.js';
import { DEFAULTS, DEFAULT_OLLAMA } from './defaults.js';

async function seedSetting(key: string, value: string | undefined) {
  if (value && !(await prisma.setting.findUnique({ where: { key } }))) await prisma.setting.create({ data: { key, value } });
}

async function seedCreds(provider: string, creds: Record<string, string | undefined>) {
  const filled = Object.fromEntries(Object.entries(creds).filter(([, v]) => !!v)) as Record<string, string>;
  if (Object.keys(filled).length && !(await prisma.providerConfig.findUnique({ where: { provider } }))) {
    await prisma.providerConfig.create({ data: { provider, credentialsEnc: encrypt(JSON.stringify(filled), env.appSecret) } });
  }
}

export async function seedFromEnv() {
  // Local-first defaults; env vars override per-deployment, the Settings UI overrides at runtime.
  await seedSetting('extraction_provider', process.env.EXTRACTION_PROVIDER ?? DEFAULTS.extraction_provider);
  await seedSetting('structuring_provider', process.env.STRUCTURING_MODEL_PROVIDER ?? DEFAULTS.structuring_provider);
  await seedSetting('structuring_model', process.env.STRUCTURING_MODEL ?? DEFAULTS.structuring_model);
  // Seed the local Ollama connection so the default provider is configured out of the box.
  await seedCreds('ollama', {
    baseUrl: process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA.baseUrl,
    model: process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA.model,
  });
  await seedCreds('mistral', { apiKey: process.env.MISTRAL_API_KEY });
  await seedCreds('azure', { endpoint: process.env.AZURE_DI_ENDPOINT, apiKey: process.env.AZURE_DI_KEY });
  await seedCreds('llamaparse', { apiKey: process.env.LLAMAPARSE_API_KEY });
  await seedCreds('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY });
  await seedCreds('openai', { apiKey: process.env.OPENAI_API_KEY });
}
