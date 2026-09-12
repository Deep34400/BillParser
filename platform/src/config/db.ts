/**
 * Postgres connection — Sequelize instance.
 *
 * Pool settings tuned for Cloud Run (max 2 per instance × 8 instances = 16 connections).
 * NUMERIC columns returned as JS numbers via pg type parser override.
 */
import { Sequelize } from 'sequelize';
import pg from 'pg';
import { env } from './env.js';

// pg returns NUMERIC (oid 1700) as strings by default.
// Bind the same `pg` instance Sequelize uses so the parser actually applies.
const NUMERIC_OID = 1700;
pg.types.setTypeParser(NUMERIC_OID, (val: string) => {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : null;
});

let _sequelize: Sequelize | undefined;

export function sequelize(): Sequelize {
  if (!_sequelize) {
    _sequelize = new Sequelize(env.databaseUrl, {
      dialect: 'postgres',
      dialectModule: pg,
      logging: false,
      pool: {
        max: 2,
        min: 0,
        idle: 10_000,
        acquire: 30_000,
      },
      define: {
        timestamps: false,
        underscored: true,
        freezeTableName: true,
      },
    });
  }
  return _sequelize;
}

export async function closeDb(): Promise<void> {
  if (_sequelize) await _sequelize.close();
}
