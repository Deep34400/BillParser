/**
 * Run Sequelize sync — creates tables if not present.
 * Drops retired org / plan schema (organizations, org_members, org_id).
 */
import { sequelize } from '../config/db.js';
import { initModels } from './schema.js';

export async function runMigrations(): Promise<void> {
  const seq = sequelize();
  initModels(seq);

  await seq.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

  await seq.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bills') THEN
        ALTER TABLE bills DROP CONSTRAINT IF EXISTS bills_org_id_fkey;
        DROP INDEX IF EXISTS bills_org_updated_idx;
        ALTER TABLE bills DROP COLUMN IF EXISTS org_id;
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
        DROP INDEX IF EXISTS audit_org_created_idx;
        ALTER TABLE audit_logs DROP COLUMN IF EXISTS org_id;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'webhook_endpoints' AND column_name = 'org_id'
      ) THEN
        ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS user_id TEXT;
        UPDATE webhook_endpoints SET user_id = org_id WHERE user_id IS NULL;
        DROP INDEX IF EXISTS webhooks_org_idx;
        ALTER TABLE webhook_endpoints DROP COLUMN IF EXISTS org_id;
      END IF;

      DROP TABLE IF EXISTS org_members;
      DROP TABLE IF EXISTS organizations;
    END $$;
  `);

  await seq.sync({ alter: true });
  console.log('[migrate] Sequelize sync complete');
}
