/**
 * Explicit migration runner — never auto-run on server boot (Cloud Run starts
 * many instances concurrently; auto-migrate risks concurrent DDL races).
 * Invoke via `npm run db:migrate`.
 */
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, closeDb } from '../config/db.js';

async function main() {
  console.log('Running migrations...');
  await migrate(db(), { migrationsFolder: './drizzle' });
  console.log('Migrations complete.');
  await closeDb();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
