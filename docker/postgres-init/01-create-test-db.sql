-- The vitest suite truncates tables, including users. Pointing it at billparser_dev
-- deletes the seeded admin and logs you out of local dev until the backend restarts.
-- This gives the tests their own database (see platform/vitest.config.ts).
--
-- Runs only on first container start, when the data volume is empty. If the volume
-- already exists, create it by hand:
--   docker compose -f docker-compose.dev.yml exec postgres \
--     psql -U billparser_app_dev -d postgres -c 'CREATE DATABASE billparser_test'
--   cd platform && DATABASE_URL=...billparser_test npm run db:migrate
CREATE DATABASE billparser_test OWNER billparser_app_dev;
