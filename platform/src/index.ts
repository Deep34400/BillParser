import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '.env') });
loadEnv({ path: resolve(process.cwd(), '../.env') });

const { buildApp } = await import('./app.js');
const { env } = await import('./config/env.js');
const { devStore } = await import('./lib/devStore.js');

if (env.localDev) {
  if (env.mistralApiKey) devStore.saveCreds('mistral', { apiKey: env.mistralApiKey });
  if (env.geminiApiKey) devStore.saveCreds('gemini', { apiKey: env.geminiApiKey, model: env.geminiModel });
}

async function seedAdmin() {
  const { listUsers, createUser, hashPassword } = await import('./models/users.js');
  const users = await listUsers();
  if (users.some((u) => u.role === 'admin')) return;

  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@praya.io';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin123';
  const now = new Date().toISOString();
  await createUser({
    user_id: 'admin-001',
    email: adminEmail,
    name: 'Admin',
    password_hash: hashPassword(adminPassword),
    role: 'admin',
    status: 'active',
    api_key_hash: '',
    api_key_prefix: '',
    token_balance: Infinity,
    total_tokens_used: 0,
    total_ocr_count: 0,
    total_cost_usd: 0,
    created_at: now,
    updated_at: now,
  });
  console.log(`[SEED] Admin account created → email: ${adminEmail} / password: ${adminPassword}`);
  console.log('[SEED] Change ADMIN_EMAIL and ADMIN_PASSWORD in .env for production.');
}

async function main() {
  await seedAdmin();
  const app = await buildApp();
  await app.listen({ port: env.port, host: '0.0.0.0' });
  console.log(`BillParser platform running on port ${env.port}${env.localDev ? ' (LOCAL_DEV mode)' : ''}`);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
