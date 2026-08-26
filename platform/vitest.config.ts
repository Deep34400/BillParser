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
      // billparser_test, not billparser_dev. The repository contract tests
      // truncate tables — including users — so running them against the dev
      // database deletes the seeded admin and logs you out of local dev until the
      // backend restarts and re-seeds.
      //
      // Create it once with:
      //   createdb billparser_test   (or psql -c 'CREATE DATABASE billparser_test')
      //   DATABASE_URL=...billparser_test npm run db:migrate
      DATABASE_URL: process.env.TEST_DATABASE_URL
        ?? 'postgresql://billparser_app_dev:local_dev_password@localhost:5432/billparser_test',
    },
  },
});
