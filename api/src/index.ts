import { mkdir } from 'node:fs/promises';
import { env } from './config/env.js';
import { buildApp } from './app.js';
import { seedFromEnv } from './settings/seed.js';
import { migrateDeprecatedSettings } from './settings/migrate.js';

// Last-resort safety net: a stray rejection or error from a background task (e.g. an
// extraction) must not take the whole API down. Log it and keep serving.
process.on('unhandledRejection', (reason) => { console.error('[unhandledRejection]', reason); });
process.on('uncaughtException', (err) => { console.error('[uncaughtException]', err); });

async function main() {
  if (env.appSecret === 'dev-secret-change-me') {
    console.warn(
      '[WARN] APP_SECRET is the insecure default. Set a strong, STABLE value in .env — ' +
        'if it changes between restarts, saved provider credentials become undecryptable ' +
        '("not configured"). See README → Quick start.',
    );
  }
  await mkdir(env.uploadDir, { recursive: true });
  await seedFromEnv();
  await migrateDeprecatedSettings();
  const app = await buildApp();
  await app.listen({ port: env.port, host: '0.0.0.0' });
}

main().catch((e) => { console.error(e); process.exit(1); });
