import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // singleFork: all test files share one process, hence one Postgres connection pool —
    // required since repository contract tests share the same real database (no per-file
    // isolation like the old in-memory devStore gave for free).
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    env: {
      DATABASE_URL: process.env.DATABASE_URL
        ?? 'postgresql://billparser_app_dev:local_dev_password@localhost:5432/billparser_dev',
    },
  },
});
