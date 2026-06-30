import { defineConfig } from 'vitest/config';

// Pure-logic schema tests only — no DB, no globalSetup (avoids Prisma createdb perms locally).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/billing/**/*.test.ts', 'tests/parsing/**/*.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
