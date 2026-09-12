/**
 * Run Sequelize sync — creates tables if not present.
 * In production, use sequelize-cli migrations instead of sync().
 */
import { sequelize } from '../config/db.js';
import { initModels } from './schema.js';

export async function runMigrations(): Promise<void> {
  const seq = sequelize();
  initModels(seq);

  // Ensure pg_trgm extension for GIN trigram indexes
  await seq.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

  // alter: true adds new columns but won't drop existing ones
  await seq.sync({ alter: true });
  console.log('[migrate] Sequelize sync complete');
}
