import { mkdir } from 'node:fs/promises';
import { env } from './env.js';
import { buildApp } from './app.js';
import { seedFromEnv } from './settings/seed.js';

async function main() {
  await mkdir(env.uploadDir, { recursive: true });
  await seedFromEnv();
  const app = await buildApp();
  await app.listen({ port: env.port, host: '0.0.0.0' });
}

main().catch((e) => { console.error(e); process.exit(1); });
