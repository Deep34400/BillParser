import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '.env') });
loadEnv({ path: resolve(process.cwd(), '../.env') });

const { buildApp } = await import('./app.js');
const { env } = await import('./config/env.js');
const { devStore } = await import('./shared/devStore.js');

if (env.localDev) {
  if (env.mistralApiKey) devStore.saveCreds('mistral', { apiKey: env.mistralApiKey });
  // Gemini uses Vertex + ADC only — do not seed API keys into Settings.
}

async function seedAdmin() {
  const { listUsers, createUser, hashPassword } = await import('./users/repository.js');
  const users = await listUsers();
  if (users.some((u) => u.role === 'admin')) return;

  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@praya.io';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin123';
  const intakeEmail = process.env.IMAP_USER || 'techcarrum@gmail.com';
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
    intake_email: intakeEmail,
    created_at: now,
    updated_at: now,
  });
  console.log(`[SEED] Admin account created → email: ${adminEmail} / password: ${adminPassword}`);
  console.log(`[SEED] Invoice intake email: ${intakeEmail} (send invoices here)`);
  console.log('[SEED] Change ADMIN_EMAIL and ADMIN_PASSWORD in .env for production.');
}

async function main() {
  // Prevent IMAP socket timeouts from killing the whole server
  process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    if (err?.code === 'ETIMEOUT' || /Socket timeout/i.test(err?.message ?? '')) {
      console.error('[email-intake] Caught IMAP socket timeout (server stays up):', err.message);
      return;
    }
    console.error('Uncaught exception:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    if (/Socket timeout|ETIMEOUT/i.test(msg)) {
      console.error('[email-intake] Caught IMAP rejection (server stays up):', msg);
      return;
    }
    console.error('Unhandled rejection:', reason);
  });

  await seedAdmin();
  const app = await buildApp();
  await app.listen({ port: env.port, host: '0.0.0.0' });
  console.log(`BillParser platform running on port ${env.port}${env.localDev ? ' (LOCAL_DEV mode)' : ''}`);

  // Start email intake poller (non-blocking, graceful)
  const { startEmailIntake, stopEmailIntake } = await import('./email-intake/poller.js');
  startEmailIntake().catch((err) => console.error('[email-intake] Failed to start:', err));

  const shutdown = async () => {
    console.log('\nShutting down...');
    await stopEmailIntake();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
