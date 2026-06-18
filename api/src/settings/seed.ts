import { prisma } from '../db.js';
import { encrypt } from '../lib/crypto.js';
import { env } from '../env.js';

async function seedSetting(key: string, envVar: string) {
  const v = process.env[envVar];
  if (v && !(await prisma.setting.findUnique({ where: { key } }))) await prisma.setting.create({ data: { key, value: v } });
}

async function seedCreds(provider: string, creds: Record<string, string | undefined>) {
  const filled = Object.fromEntries(Object.entries(creds).filter(([, v]) => !!v)) as Record<string, string>;
  if (Object.keys(filled).length && !(await prisma.providerConfig.findUnique({ where: { provider } }))) {
    await prisma.providerConfig.create({ data: { provider, credentialsEnc: encrypt(JSON.stringify(filled), env.appSecret) } });
  }
}

export async function seedFromEnv() {
  await seedSetting('extraction_provider', 'EXTRACTION_PROVIDER');
  await seedSetting('structuring_provider', 'STRUCTURING_MODEL_PROVIDER');
  await seedSetting('structuring_model', 'STRUCTURING_MODEL');
  await seedCreds('mistral', { apiKey: process.env.MISTRAL_API_KEY });
  await seedCreds('azure', { endpoint: process.env.AZURE_DI_ENDPOINT, apiKey: process.env.AZURE_DI_KEY });
  await seedCreds('llamaparse', { apiKey: process.env.LLAMAPARSE_API_KEY });
  await seedCreds('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY });
  await seedCreds('openai', { apiKey: process.env.OPENAI_API_KEY });
}
