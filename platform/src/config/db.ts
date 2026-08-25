/**
 * Postgres connection — pool + Drizzle instance.
 *
 * NUMERIC (oid 1700) is parsed to a JS number globally. This must happen before
 * any query runs, because raw `db.execute(sql\`...\`)` calls (used for analytics
 * aggregates) bypass Drizzle's own column-type mapping and would otherwise
 * return numeric columns as strings — silently turning `total += amount` into
 * string concatenation.
 */
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from './env.js';
import * as schema from '../db/schema.js';

pg.types.setTypeParser(1700, (v: string) => (v === null ? null : parseFloat(v)));

let _pool: pg.Pool | undefined;

function pool(): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: env.databaseUrl,
      max: 2,
      idleTimeoutMillis: 10_000,
    });
  }
  return _pool;
}

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function db() {
  if (!_db) _db = drizzle(pool(), { schema });
  return _db;
}

export async function closeDb(): Promise<void> {
  if (_pool) await _pool.end();
}
