import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

function loadEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync('.env', 'utf8').split('\n')
        .filter((l) => l && !l.startsWith('#') && l.includes('='))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
    );
  } catch { return {}; }
}

function toTestDbUrl(url: string): string {
  try {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\/([^/?]+)$/, '/$1_test');
    return u.toString();
  } catch {
    return url;
  }
}

const env = loadEnv();
// Run tests against a SEPARATE database so they never wipe the running app's data.
const appDbUrl = env.DATABASE_URL ?? 'postgresql://invoice:invoice@localhost:5432/invoice?schema=public';
env.DATABASE_URL = toTestDbUrl(appDbUrl);

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    hookTimeout: 60000,
    testTimeout: 30000,
    env,
    globalSetup: ['./tests/globalSetup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
