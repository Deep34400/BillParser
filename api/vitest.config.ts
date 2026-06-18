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

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'], hookTimeout: 30000, testTimeout: 30000, env: loadEnv() },
});
